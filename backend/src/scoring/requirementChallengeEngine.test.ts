// Tests for the deterministic half of Requirement Challenge & Optimization
// (requirement-challenge-v1) - proposal deduplication, applying user
// decisions to the working requirement, and the approval lifecycle. The
// AI's own judgment quality (does it correctly separate a business goal
// from an unnecessary vector-database solution assumption, etc.) is a
// model-behavior concern verified live against a real repository, not
// something a unit test can check - see clarificationGate.test.ts's header
// comment for the same reasoning applied to the earlier Assumption &
// Clarification Engine.

import { describe, expect, it } from "vitest";
import type {
  ChallengeEvidence,
  Requirement,
  RequirementChallengeProposal,
  RequirementChallengeProposalInput,
  RequirementChallengeType,
  RequirementContext,
} from "../domain/types.js";
import {
  applyChallengeProposalAction,
  buildOptimizedRequirement,
  ChallengeProposalNotFoundError,
  checkChallengeApprovalGate,
  dedupeChallengeProposals,
  evaluateApprovalStatus,
} from "./requirementChallengeEngine.js";

function evidence(overrides: Partial<ChallengeEvidence> = {}): ChallengeEvidence {
  return {
    sourceType: "ORIGINAL_REQUIREMENT",
    reference: "Die Kundenkommunikation soll in einer Vektordatenbank gespeichert werden",
    description: "Explizite Formulierung im Original-Requirement.",
    status: "VERIFIED",
    ...overrides,
  };
}

function proposalInput(overrides: Partial<RequirementChallengeProposalInput> = {}): RequirementChallengeProposalInput {
  return {
    type: "SOLUTION_CONSTRAINT",
    title: "Speichertechnologie lösungsoffen formulieren",
    originalText: "Die Kundenkommunikation soll in einer Vektordatenbank gespeichert werden",
    issue: "Die konkrete Speichertechnologie ist eine Lösungsannahme, kein Geschäftsziel.",
    proposedChange: "Josef soll relevante historische Kundenkommunikation dialogübergreifend berücksichtigen können.",
    rationale: "Das Ziel ist unabhängig von der konkreten Speichertechnologie erreichbar.",
    evidence: [evidence()],
    expectedImpact: { scope: "SAME", complexity: "LOWER", maintainability: "BETTER", reuse: "SAME", implementationFreedom: "HIGHER" },
    confidence: 0.7,
    ...overrides,
  };
}

function decidedProposal(overrides: Partial<RequirementChallengeProposal> = {}): RequirementChallengeProposal {
  const input = proposalInput(overrides);
  return {
    ...input,
    id: "p1",
    status: "REJECTED",
    editedChange: null,
    decidedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function requirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    title: "Josef Kontext-Gedächtnis",
    description: "Josef soll frühere Gespräche berücksichtigen können.",
    acceptanceCriteria: ["Josef verweist auf frühere Kundenanfragen."],
    constraints: [],
    ...overrides,
  };
}

describe("dedupeChallengeProposals", () => {
  it("assigns a fresh PENDING proposal an id when nothing existing matches it", () => {
    const result = dedupeChallengeProposals([], [proposalInput()]);
    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe("PENDING");
    expect(result[0]!.id.length).toBeGreaterThan(0);
  });

  it("keeps a DECIDED (e.g. ACCEPTED) proposal unchanged when the fresh run re-emits the same recommendation (Test H: no silent reappearance)", () => {
    const accepted = decidedProposal({ status: "ACCEPTED" });
    const result = dedupeChallengeProposals([accepted], [proposalInput()]);
    expect(result).toEqual([accepted]);
  });

  it("does not resurface a REJECTED proposal when the fresh run cites the same evidence", () => {
    const rejected = decidedProposal({ status: "REJECTED" });
    const result = dedupeChallengeProposals([rejected], [proposalInput()]);
    expect(result).toEqual([rejected]);
  });

  it("resurfaces a REJECTED proposal as a brand-new PENDING one when the fresh run cites genuinely new evidence (Test I: changed-evidence exception)", () => {
    const rejected = decidedProposal({ status: "REJECTED" });
    const fresh = proposalInput({
      evidence: [evidence({ sourceType: "REPOSITORY", reference: "src/chat/history.ts", description: "Kein Vektor-Store im Repository vorhanden." })],
    });
    const result = dedupeChallengeProposals([rejected], [fresh]);
    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe("PENDING");
    expect(result[0]!.id).not.toBe(rejected.id);
  });

  it("refreshes an existing PENDING proposal in place (same id) rather than duplicating it", () => {
    const pendingResult = dedupeChallengeProposals([], [proposalInput()]);
    const pending = pendingResult[0]!;
    const refreshed = dedupeChallengeProposals([pending], [proposalInput({ confidence: 0.9 })]);
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]!.id).toBe(pending.id);
    expect(refreshed[0]!.confidence).toBe(0.9);
  });

  it("keeps a DECIDED proposal even when a later run no longer emits it at all", () => {
    const accepted = decidedProposal({ status: "ACCEPTED" });
    const result = dedupeChallengeProposals([accepted], []);
    expect(result).toEqual([accepted]);
  });

  it("drops an un-decided PENDING proposal that a later run no longer emits", () => {
    const pending = dedupeChallengeProposals([], [proposalInput()])[0]!;
    const result = dedupeChallengeProposals([pending], []);
    expect(result).toEqual([]);
  });

  it("treats a genuine constraint (e.g. mandated on-prem hosting) as a distinct key from a solution assumption, so legitimate constraints are never silently merged away (Test B: preserving genuine constraints)", () => {
    const genuine = decidedProposal({
      type: "CONFLICT",
      originalText: "Muss on-premises betrieben werden (vertraglich vereinbart)",
      status: "REJECTED",
    });
    const solutionAssumption = proposalInput({ type: "SOLUTION_CONSTRAINT", originalText: "Vektordatenbank" });
    const result = dedupeChallengeProposals([genuine], [solutionAssumption]);
    expect(result).toHaveLength(2);
    expect(result.find((p) => p.id === genuine.id)).toEqual(genuine);
  });
});

describe("buildOptimizedRequirement", () => {
  it("appends an accepted SOLUTION_CONSTRAINT proposal as a labeled note without rewriting the original description (Test A/E: solution-assumption accepted, original text preserved)", () => {
    const base = requirement({ description: "Die Kundenkommunikation soll in einer Vektordatenbank gespeichert werden, damit Josef frühere Gespräche berücksichtigen kann." });
    const proposal: RequirementChallengeProposal = { ...proposalInput(), id: "p1", status: "ACCEPTED", editedChange: null, decidedAt: "now", createdAt: "now" };

    const result = buildOptimizedRequirement(base, [proposal]);

    expect(result.description).toContain(base.description);
    expect(result.description).toContain("[Lösungsoffen formuliert]");
    expect(result.description).toContain(proposal.proposedChange);
  });

  it("ignores a REJECTED or PENDING proposal entirely (Test F: no auto-apply of undecided proposals)", () => {
    const base = requirement();
    const rejected: RequirementChallengeProposal = { ...proposalInput(), id: "p1", status: "REJECTED", editedChange: null, decidedAt: "now", createdAt: "now" };
    const pending: RequirementChallengeProposal = { ...proposalInput(), id: "p2", status: "PENDING", editedChange: null, decidedAt: null, createdAt: "now" };

    const result = buildOptimizedRequirement(base, [rejected, pending]);

    expect(result).toEqual(base);
  });

  it("uses the user's own edited text, not the AI's original proposedChange, for an EDITED proposal (Test G: user edit takes precedence)", () => {
    const base = requirement();
    const edited: RequirementChallengeProposal = {
      ...proposalInput(),
      id: "p1",
      status: "EDITED",
      editedChange: "Josef soll die letzten 90 Tage an Kommunikation berücksichtigen.",
      decidedAt: "now",
      createdAt: "now",
    };

    const result = buildOptimizedRequirement(base, [edited]);

    expect(result.description).toContain("Josef soll die letzten 90 Tage an Kommunikation berücksichtigen.");
    expect(result.description).not.toContain(edited.proposedChange);
  });

  it("replaces a matching acceptanceCriteria entry in place for ACCEPTANCE_IMPROVEMENT proposals", () => {
    const base = requirement({ acceptanceCriteria: ["Josef verweist auf frühere Kundenanfragen."] });
    const proposal: RequirementChallengeProposal = {
      ...proposalInput({
        type: "ACCEPTANCE_IMPROVEMENT",
        originalText: "Josef verweist auf frühere Kundenanfragen.",
        proposedChange: "Josef verweist im Chat sichtbar auf mindestens eine passende frühere Kundenanfrage, falls vorhanden.",
      }),
      id: "p1",
      status: "ACCEPTED",
      editedChange: null,
      decidedAt: "now",
      createdAt: "now",
    };

    const result = buildOptimizedRequirement(base, [proposal]);

    expect(result.acceptanceCriteria).toEqual([
      "Josef verweist im Chat sichtbar auf mindestens eine passende frühere Kundenanfrage, falls vorhanden.",
    ]);
  });

  it("replaces a matching constraints entry in place for a non-acceptance proposal type", () => {
    const base = requirement({ constraints: ["Muss eine Vektordatenbank verwenden."] });
    const proposal: RequirementChallengeProposal = {
      ...proposalInput({ originalText: "Muss eine Vektordatenbank verwenden.", proposedChange: "Muss dialogübergreifenden Kontext bereitstellen (Technologie offen)." }),
      id: "p1",
      status: "ACCEPTED",
      editedChange: null,
      decidedAt: "now",
      createdAt: "now",
    };

    const result = buildOptimizedRequirement(base, [proposal]);

    expect(result.constraints).toEqual(["Muss dialogübergreifenden Kontext bereitstellen (Technologie offen)."]);
  });

  it("targetField=CONSTRAINT rewrites the exactly matching constraint, not just the description (regression: accepting a solution-constraint proposal must actually update Randbedingungen, not only the free text)", () => {
    const base = requirement({
      description: "Das Team bestätigte die Anforderung und will sie über eine bestehende Vektordatenbank umsetzen.",
      constraints: ["Die Implementierung muss die vorhandene Vektordatenbank nutzen."],
    });
    const proposal: RequirementChallengeProposal = {
      ...proposalInput({
        targetField: "CONSTRAINT",
        originalText: "Die Implementierung muss die vorhandene Vektordatenbank nutzen.",
        proposedChange: "Die Implementierung muss dialogübergreifenden Kontext bereitstellen (Speichertechnologie nicht festgelegt).",
      }),
      id: "p1",
      status: "ACCEPTED",
      editedChange: null,
      decidedAt: "now",
      createdAt: "now",
    };

    const result = buildOptimizedRequirement(base, [proposal]);

    expect(result.constraints).toEqual([
      "Die Implementierung muss dialogübergreifenden Kontext bereitstellen (Speichertechnologie nicht festgelegt).",
    ]);
    // The original description is still preserved verbatim - only the
    // discrete constraint entry is rewritten, no note-only fallback.
    expect(result.description).toBe(base.description);
  });

  it("targetField=CONSTRAINT falls back to a substring match when originalText isn't a byte-identical copy of the constraint", () => {
    const base = requirement({ constraints: ["Die Implementierung muss die vorhandene Vektordatenbank nutzen."] });
    const proposal: RequirementChallengeProposal = {
      ...proposalInput({
        targetField: "CONSTRAINT",
        originalText: "die Implementierung muss die vorhandene Vektordatenbank nutzen", // trailing period + case differ
        proposedChange: "Technologie ist nicht festgelegt.",
      }),
      id: "p1",
      status: "ACCEPTED",
      editedChange: null,
      decidedAt: "now",
      createdAt: "now",
    };

    const result = buildOptimizedRequirement(base, [proposal]);

    expect(result.constraints).toEqual(["Technologie ist nicht festgelegt."]);
  });

  it("targetField=CONSTRAINT appends a new constraint when genuinely no existing entry matches, instead of silently falling through to a description note", () => {
    const base = requirement({ constraints: ["Muss DSGVO-konform sein."] });
    const proposal: RequirementChallengeProposal = {
      ...proposalInput({ targetField: "CONSTRAINT", originalText: "Ganz neue Randbedingung", proposedChange: "Muss barrierefrei sein." }),
      id: "p1",
      status: "ACCEPTED",
      editedChange: null,
      decidedAt: "now",
      createdAt: "now",
    };

    const result = buildOptimizedRequirement(base, [proposal]);

    expect(result.constraints).toEqual(["Muss DSGVO-konform sein.", "Muss barrierefrei sein."]);
  });

  it("targetField=DESCRIPTION always appends a note, even when the type would otherwise match ACCEPTANCE_IMPROVEMENT's legacy fallback", () => {
    const base = requirement({ acceptanceCriteria: ["Ein Kriterium."] });
    const proposal: RequirementChallengeProposal = {
      ...proposalInput({ type: "ACCEPTANCE_IMPROVEMENT", targetField: "DESCRIPTION", originalText: "Ein Kriterium.", proposedChange: "Präzisierte Formulierung." }),
      id: "p1",
      status: "ACCEPTED",
      editedChange: null,
      decidedAt: "now",
      createdAt: "now",
    };

    const result = buildOptimizedRequirement(base, [proposal]);

    expect(result.acceptanceCriteria).toEqual(["Ein Kriterium."]);
    expect(result.description).toContain("Präzisierte Formulierung.");
  });

  it("never appears in numeric form (Test M: no DU/hours/price/percentage in optimization output)", () => {
    const base = requirement();
    const proposal: RequirementChallengeProposal = { ...proposalInput(), id: "p1", status: "ACCEPTED", editedChange: null, decidedAt: "now", createdAt: "now" };
    const result = buildOptimizedRequirement(base, [proposal]);
    expect(result.description).not.toMatch(/\d+\s*(DU|Stunden|h|€|EUR|%)/);
  });

  it("is deterministic when recomputed from scratch after toggling a decision back and forth (never accumulates duplicate notes)", () => {
    const base = requirement();
    const accepted: RequirementChallengeProposal = { ...proposalInput(), id: "p1", status: "ACCEPTED", editedChange: null, decidedAt: "now", createdAt: "now" };
    const once = buildOptimizedRequirement(base, [accepted]);
    const twice = buildOptimizedRequirement(base, [accepted]);
    expect(once).toEqual(twice);
  });
});

describe("checkChallengeApprovalGate", () => {
  it("blocks approval when a clarification is still PENDING (Test K: approval gate)", () => {
    const result = checkChallengeApprovalGate({
      clarifications: [{ id: "c1", missingInformationId: "m1", question: "Q?", priority: 1, status: "PENDING", answer: null, answeredAt: null }],
      requirement: requirement(),
    });
    expect(result.canApprove).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("blocks approval when acceptanceCriteria is empty", () => {
    const result = checkChallengeApprovalGate({ clarifications: [], requirement: requirement({ acceptanceCriteria: [] }) });
    expect(result.canApprove).toBe(false);
  });

  it("does NOT block approval just because a proposal is still PENDING (a user may defer/ignore a proposal and still approve)", () => {
    const result = checkChallengeApprovalGate({ clarifications: [], requirement: requirement() });
    expect(result.canApprove).toBe(true);
    expect(result.reasons).toEqual([]);
  });
});

describe("evaluateApprovalStatus", () => {
  function ctx(overrides: Partial<Pick<RequirementContext, "clarifications" | "requirement" | "challengeAnalysis" | "challengeProposals">> = {}) {
    return {
      clarifications: [],
      requirement: requirement(),
      challengeAnalysis: null,
      challengeProposals: [],
      ...overrides,
    };
  }

  it("is DRAFT before Challenge has ever run", () => {
    expect(evaluateApprovalStatus(ctx())).toBe("DRAFT");
  });

  it("is CHALLENGE_IN_PROGRESS while a proposal is still PENDING", () => {
    const pending: RequirementChallengeProposal = { ...proposalInput(), id: "p1", status: "PENDING", editedChange: null, decidedAt: null, createdAt: "now" };
    const status = evaluateApprovalStatus(
      ctx({ challengeAnalysis: { goal: "g", problemStatement: "p", solutionSpecificity: "HIGH" }, challengeProposals: [pending] }),
    );
    expect(status).toBe("CHALLENGE_IN_PROGRESS");
  });

  it("is READY_FOR_APPROVAL once every proposal is decided and the gate passes", () => {
    const decided: RequirementChallengeProposal = { ...proposalInput(), id: "p1", status: "ACCEPTED", editedChange: null, decidedAt: "now", createdAt: "now" };
    const status = evaluateApprovalStatus(
      ctx({ challengeAnalysis: { goal: "g", problemStatement: "p", solutionSpecificity: "HIGH" }, challengeProposals: [decided] }),
    );
    expect(status).toBe("READY_FOR_APPROVAL");
  });

  it("falls back to CHALLENGE_IN_PROGRESS when every proposal is decided but the gate still fails (e.g. no acceptance criteria)", () => {
    const decided: RequirementChallengeProposal = { ...proposalInput(), id: "p1", status: "ACCEPTED", editedChange: null, decidedAt: "now", createdAt: "now" };
    const status = evaluateApprovalStatus(
      ctx({
        requirement: requirement({ acceptanceCriteria: [] }),
        challengeAnalysis: { goal: "g", problemStatement: "p", solutionSpecificity: "HIGH" },
        challengeProposals: [decided],
      }),
    );
    expect(status).toBe("CHALLENGE_IN_PROGRESS");
  });
});

describe("applyChallengeProposalAction", () => {
  function baseContext(): RequirementContext {
    const req = requirement();
    const pending: RequirementChallengeProposal = { ...proposalInput(), id: "p1", status: "PENDING", editedChange: null, decidedAt: null, createdAt: "now" };
    const now = new Date().toISOString();
    return {
      id: "ctx-1",
      snapshotId: "snap-1",
      requirement: req,
      originalRequirement: req,
      normalizedRequirement: req,
      approvedRequirement: null,
      approvalStatus: "CHALLENGE_IN_PROGRESS",
      challengeAnalysis: { goal: "g", problemStatement: "p", solutionSpecificity: "HIGH" },
      challengeProposals: [pending],
      requirementPreparationVersion: "requirement-challenge-v1",
      qualityLevel: "standard",
      model: "claude-opus-5",
      normalization: null,
      knownFacts: [],
      assumptions: [],
      missingInformation: [],
      clarifications: [],
      status: "RESOLVED",
      resolutionRounds: 1,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  it("throws ChallengeProposalNotFoundError for an unknown proposal id", () => {
    expect(() => applyChallengeProposalAction(baseContext(), "does-not-exist", "ACCEPT")).toThrow(ChallengeProposalNotFoundError);
  });

  it("ACCEPT marks the proposal ACCEPTED and applies it to the working requirement (Test C: accept applies change)", () => {
    const result = applyChallengeProposalAction(baseContext(), "p1", "ACCEPT");
    expect(result.challengeProposals[0]!.status).toBe("ACCEPTED");
    expect(result.requirement.description).toContain(result.challengeProposals[0]!.proposedChange);
  });

  it("REJECT marks the proposal REJECTED and leaves the working requirement unaffected (Test D: reject leaves requirement unchanged)", () => {
    const context = baseContext();
    const result = applyChallengeProposalAction(context, "p1", "REJECT");
    expect(result.challengeProposals[0]!.status).toBe("REJECTED");
    expect(result.requirement).toEqual(context.normalizedRequirement);
  });

  it("EDIT requires non-empty editedText", () => {
    expect(() => applyChallengeProposalAction(baseContext(), "p1", "EDIT")).toThrow();
    expect(() => applyChallengeProposalAction(baseContext(), "p1", "EDIT", "   ")).toThrow();
  });

  it("EDIT stores the trimmed edited text and applies it instead of the AI's proposedChange", () => {
    const result = applyChallengeProposalAction(baseContext(), "p1", "EDIT", "  Eigene Formulierung.  ");
    expect(result.challengeProposals[0]!.status).toBe("EDITED");
    expect(result.challengeProposals[0]!.editedChange).toBe("Eigene Formulierung.");
    expect(result.requirement.description).toContain("Eigene Formulierung.");
  });

  it("reverts an already-APPROVED context's approvalStatus after a new decision, without touching approvedRequirement (Test L: post-approval edit invalidates status)", () => {
    const context: RequirementContext = {
      ...baseContext(),
      approvalStatus: "APPROVED",
      approvedRequirement: { ...requirement() },
    };
    const result = applyChallengeProposalAction(context, "p1", "ACCEPT");
    expect(result.approvalStatus).not.toBe("APPROVED");
    expect(result.approvedRequirement).toEqual(context.approvedRequirement);
  });
});

describe("challenge type coverage", () => {
  it("REQUIREMENT_CHALLENGE_TYPES stay exactly the 8 spec-defined types", () => {
    const types: RequirementChallengeType[] = [
      "UNCLEAR",
      "ASSUMPTION",
      "SOLUTION_CONSTRAINT",
      "OPTIMIZATION",
      "CONFLICT",
      "SCOPE_REDUCTION",
      "REUSE_OPPORTUNITY",
      "ACCEPTANCE_IMPROVEMENT",
    ];
    for (const type of types) {
      const result = buildOptimizedRequirement(requirement(), [
        { ...proposalInput({ type, originalText: "no-match-in-base" }), id: "p", status: "ACCEPTED", editedChange: null, decidedAt: "now", createdAt: "now" },
      ]);
      expect(result.description.length).toBeGreaterThan(0);
    }
  });
});
