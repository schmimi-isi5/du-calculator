// Tests for the deterministic half of the Assumption & Clarification Engine
// - everything the application decides once the AI has classified
// information. The AI's classification *quality* (does it correctly spot
// that a vector DB already exists, does it phrase a good question, etc.) is
// a model-behavior concern verified by running the app live against a real
// repository (see the Josef example in the final report), the same way this
// codebase verifies "no fabrication" - not something a unit test can check.
// What IS deterministic, and tested here, is what the app does with a given
// classification: does a CLARIFICATION_REQUIRED item actually turn into a
// question, does it get capped and prioritized, do answers and assumption
// decisions update the record correctly.

import { describe, expect, it } from "vitest";
import type {
  Assumption,
  Clarification,
  ContextResolutionOutput,
  MissingInformation,
  RequirementContext,
} from "../domain/types.js";
import { QUALITY_PROFILES } from "../domain/qualityLevels.js";
import {
  activeAssumptions,
  applyAssumptionAction,
  applyClarificationAnswer,
  AssumptionNotFoundError,
  buildResolvedContextParts,
  ClarificationNotFoundError,
  hasPendingClarifications,
  pendingClarifications,
} from "./clarificationGate.js";

const MAX_CLARIFICATIONS_PER_ROUND = QUALITY_PROFILES.standard.maxClarificationsPerRound;

function missing(overrides: Partial<Omit<MissingInformation, "id">> = {}): Omit<MissingInformation, "id"> {
  return {
    topic: "some-topic",
    question: "Some question?",
    classification: "UNKNOWN_NON_BLOCKING",
    potentialScoreImpact: 0,
    affectedDimensions: [],
    reasoning: "test reasoning",
    ...overrides,
  };
}

function assumption(overrides: Partial<Omit<Assumption, "id" | "status">> = {}): Omit<Assumption, "id" | "status"> {
  return {
    topic: "some-topic",
    assumption: "Some assumption.",
    reason: "test reason",
    basis: ["Requirement"],
    confidence: 0.8,
    affectedDimensions: [],
    potentialScoreImpact: 1,
    criticality: "LOW",
    ...overrides,
  };
}

function output(overrides: Partial<ContextResolutionOutput> = {}): ContextResolutionOutput {
  return {
    normalization: {
      suggestedTitle: "",
      objective: "",
      businessGoal: "",
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      acceptanceCriteria: [],
      technicalConstraints: [],
      mentionedSystems: [],
      mentionedDataSources: [],
      mentionedIntegrations: [],
      mentionedExistingComponents: [],
      assumptionsAlreadyContainedInRequirement: [],
      unresolvedInformation: [],
    },
    knownFacts: [],
    assumptions: [],
    missingInformation: [],
    ...overrides,
  };
}

describe("buildResolvedContextParts - classification scenarios", () => {
  it("scenario 1+2+3: FACT and DERIVED items never become clarifications (info already in requirement/repo, or safely derivable)", () => {
    const result = buildResolvedContextParts(
      output({
        missingInformation: [
          missing({ classification: "FACT", question: "Does a vector DB already exist?" }),
          missing({ classification: "DERIVED", question: "Is ingestion event-driven?" }),
        ],
      }),
    );

    expect(result.clarifications).toHaveLength(0);
  });

  it("scenario 4: a non-score-relevant gap (UNKNOWN_NON_BLOCKING) never becomes a clarification", () => {
    const result = buildResolvedContextParts(
      output({
        missingInformation: [missing({ classification: "UNKNOWN_NON_BLOCKING", potentialScoreImpact: 0 })],
      }),
    );

    expect(result.clarifications).toHaveLength(0);
  });

  it("scenario 5: a plausible ASSUMPTION never becomes a clarification - the assumption is used instead", () => {
    const resolutionOutput = output({
      assumptions: [assumption({ topic: "ingestion" })],
      missingInformation: [missing({ classification: "ASSUMPTION", topic: "ingestion", potentialScoreImpact: 1 })],
    });
    const result = buildResolvedContextParts(resolutionOutput);

    expect(result.clarifications).toHaveLength(0);
    expect(result.assumptions).toHaveLength(1);
    expect(result.assumptions[0]!.status).toBe("ACTIVE");
  });

  it("scenario 6: a gap that could change the DU class becomes an actual clarification", () => {
    const result = buildResolvedContextParts(
      output({
        missingInformation: [
          missing({
            classification: "CLARIFICATION_REQUIRED",
            question: "How is a customer identified across dialogs?",
            potentialScoreImpact: 2,
          }),
        ],
      }),
    );

    expect(result.clarifications).toHaveLength(1);
    expect(result.clarifications[0]!.question).toBe("How is a customer identified across dialogs?");
    expect(result.clarifications[0]!.status).toBe("PENDING");
  });

  it("caps clarifications at MAX_CLARIFICATIONS_PER_ROUND, prioritizing the highest potentialScoreImpact first", () => {
    const gaps = [
      missing({ classification: "CLARIFICATION_REQUIRED", question: "Q-impact-1-a", potentialScoreImpact: 1 }),
      missing({ classification: "CLARIFICATION_REQUIRED", question: "Q-impact-2-a", potentialScoreImpact: 2 }),
      missing({ classification: "CLARIFICATION_REQUIRED", question: "Q-impact-1-b", potentialScoreImpact: 1 }),
      missing({ classification: "CLARIFICATION_REQUIRED", question: "Q-impact-2-b", potentialScoreImpact: 2 }),
      missing({ classification: "CLARIFICATION_REQUIRED", question: "Q-impact-0", potentialScoreImpact: 0 }),
    ];
    const result = buildResolvedContextParts(output({ missingInformation: gaps }));

    expect(result.clarifications).toHaveLength(MAX_CLARIFICATIONS_PER_ROUND);
    // The two impact-2 questions must be asked before any impact-1 question.
    expect(result.clarifications.filter((c) => c.question.includes("impact-2"))).toHaveLength(2);
  });

  it("asks nothing new once maxNewClarifications is 0, regardless of what the AI flagged", () => {
    const result = buildResolvedContextParts(
      output({
        missingInformation: [
          missing({ classification: "CLARIFICATION_REQUIRED", question: "Q1", potentialScoreImpact: 2 }),
          missing({ classification: "CLARIFICATION_REQUIRED", question: "Q2", potentialScoreImpact: 2 }),
        ],
      }),
      [],
      0,
    );

    expect(result.clarifications).toHaveLength(0);
    // The classification itself is untouched - only whether it becomes a question is gated.
    expect(result.missingInformation.some((m) => m.classification === "CLARIFICATION_REQUIRED")).toBe(true);
  });

  it("still carries forward previously answered clarifications when maxNewClarifications is 0", () => {
    const answered: Clarification = {
      id: "answered-1",
      missingInformationId: "m1",
      question: "Already answered?",
      priority: 1,
      status: "ANSWERED",
      answer: "Yes.",
      answeredAt: new Date().toISOString(),
    };

    const result = buildResolvedContextParts(
      output({
        missingInformation: [missing({ classification: "CLARIFICATION_REQUIRED", question: "New question" })],
      }),
      [answered],
      0,
    );

    expect(result.clarifications).toEqual([answered]);
  });

  it("every quality profile's clarification caps are small and finite", () => {
    for (const profile of Object.values(QUALITY_PROFILES)) {
      expect(profile.maxClarificationsPerRound).toBeGreaterThan(0);
      expect(profile.maxResolutionRounds).toBeGreaterThan(0);
      expect(profile.maxResolutionRounds).toBeLessThanOrEqual(3);
    }
  });

  it("does not re-ask a question that was already answered in a prior round", () => {
    const priorAnswered: Clarification = {
      id: "prior-1",
      missingInformationId: "mi-1",
      question: "Already answered?",
      priority: 1,
      status: "ANSWERED",
      answer: "Yes.",
      answeredAt: new Date().toISOString(),
    };

    const result = buildResolvedContextParts(
      output({
        missingInformation: [
          missing({ classification: "CLARIFICATION_REQUIRED", question: "Already answered?", potentialScoreImpact: 2 }),
        ],
      }),
      [priorAnswered],
    );

    expect(result.clarifications).toEqual([priorAnswered]);
  });
});

describe("hasPendingClarifications / pendingClarifications", () => {
  const base: Pick<RequirementContext, "clarifications"> = {
    clarifications: [
      { id: "a", missingInformationId: "m1", question: "Q1", priority: 2, status: "PENDING", answer: null, answeredAt: null },
      { id: "b", missingInformationId: "m2", question: "Q2", priority: 1, status: "PENDING", answer: null, answeredAt: null },
      {
        id: "c",
        missingInformationId: "m3",
        question: "Q3",
        priority: 3,
        status: "ANSWERED",
        answer: "answered",
        answeredAt: new Date().toISOString(),
      },
    ],
  };

  it("reports pending clarifications exist", () => {
    expect(hasPendingClarifications(base)).toBe(true);
  });

  it("reports false once nothing is PENDING", () => {
    expect(hasPendingClarifications({ clarifications: base.clarifications.filter((c) => c.status !== "PENDING") })).toBe(
      false,
    );
  });

  it("returns only PENDING clarifications, sorted by priority", () => {
    const pending = pendingClarifications(base);
    expect(pending.map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("activeAssumptions", () => {
  it("includes ACTIVE and CONFIRMED, excludes REJECTED and SUPERSEDED", () => {
    const assumptions: Assumption[] = [
      { ...assumption(), id: "1", status: "ACTIVE" },
      { ...assumption(), id: "2", status: "CONFIRMED" },
      { ...assumption(), id: "3", status: "REJECTED" },
      { ...assumption(), id: "4", status: "SUPERSEDED" },
    ];

    expect(activeAssumptions(assumptions).map((a) => a.id)).toEqual(["1", "2"]);
  });
});

function buildContext(overrides: Partial<RequirementContext> = {}): RequirementContext {
  const now = new Date().toISOString();
  const requirement = { title: "t", description: "d", acceptanceCriteria: [], constraints: [] };
  return {
    id: "ctx-1",
    snapshotId: "snap-1",
    requirement,
    originalRequirement: requirement,
    normalizedRequirement: null,
    approvedRequirement: null,
    approvalStatus: "APPROVED",
    challengeAnalysis: null,
    challengeProposals: [],
    requirementPreparationVersion: null,
    qualityLevel: "standard",
    model: "claude-opus-5",
    normalization: null,
    knownFacts: [],
    assumptions: [],
    missingInformation: [],
    clarifications: [],
    status: "AWAITING_CLARIFICATION",
    resolutionRounds: 1,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("applyClarificationAnswer (scenario 7: user answers a clarification)", () => {
  it("marks the clarification ANSWERED with the given answer and a timestamp", () => {
    const context = buildContext({
      clarifications: [
        { id: "c1", missingInformationId: "m1", question: "Q?", priority: 1, status: "PENDING", answer: null, answeredAt: null },
      ],
    });

    const updated = applyClarificationAnswer(context, "c1", "Via a stable customer id.");

    const clarification = updated.clarifications[0]!;
    expect(clarification.status).toBe("ANSWERED");
    expect(clarification.answer).toBe("Via a stable customer id.");
    expect(clarification.answeredAt).not.toBeNull();
    expect(hasPendingClarifications(updated)).toBe(false);
  });

  it("throws ClarificationNotFoundError for an unknown id", () => {
    const context = buildContext();
    expect(() => applyClarificationAnswer(context, "does-not-exist", "answer")).toThrow(
      ClarificationNotFoundError,
    );
  });

  it("leaves other clarifications untouched", () => {
    const context = buildContext({
      clarifications: [
        { id: "c1", missingInformationId: "m1", question: "Q1", priority: 1, status: "PENDING", answer: null, answeredAt: null },
        { id: "c2", missingInformationId: "m2", question: "Q2", priority: 2, status: "PENDING", answer: null, answeredAt: null },
      ],
    });

    const updated = applyClarificationAnswer(context, "c1", "answer");
    expect(updated.clarifications.find((c) => c.id === "c2")!.status).toBe("PENDING");
  });
});

describe("applyAssumptionAction (scenario 8: user rejects an assumption)", () => {
  it("CONFIRM sets status to CONFIRMED", () => {
    const context = buildContext({ assumptions: [{ ...assumption(), id: "a1", status: "ACTIVE" }] });
    const updated = applyAssumptionAction(context, "a1", "CONFIRM");
    expect(updated.assumptions[0]!.status).toBe("CONFIRMED");
  });

  it("REJECT sets status to REJECTED, removing it from what scoring may use", () => {
    const context = buildContext({ assumptions: [{ ...assumption(), id: "a1", status: "ACTIVE" }] });
    const updated = applyAssumptionAction(context, "a1", "REJECT");

    expect(updated.assumptions[0]!.status).toBe("REJECTED");
    expect(activeAssumptions(updated.assumptions)).toHaveLength(0);
  });

  it("EDIT replaces the assumption text and confirms it", () => {
    const context = buildContext({ assumptions: [{ ...assumption(), id: "a1", status: "ACTIVE" }] });
    const updated = applyAssumptionAction(context, "a1", "EDIT", "A corrected assumption text.");

    expect(updated.assumptions[0]!.status).toBe("CONFIRMED");
    expect(updated.assumptions[0]!.assumption).toBe("A corrected assumption text.");
  });

  it("EDIT without editedText throws", () => {
    const context = buildContext({ assumptions: [{ ...assumption(), id: "a1", status: "ACTIVE" }] });
    expect(() => applyAssumptionAction(context, "a1", "EDIT")).toThrow();
  });

  it("throws AssumptionNotFoundError for an unknown id", () => {
    const context = buildContext();
    expect(() => applyAssumptionAction(context, "does-not-exist", "CONFIRM")).toThrow(AssumptionNotFoundError);
  });
});

// Scenario 9 (repository evidence contradicts a proposed assumption) and the
// quality of the AI's own classification decisions are prompt-encoded model
// behavior (see ai/prompts.ts buildContextResolutionPrompt's ASSUMPTION_CRITERIA_RULE
// and EVIDENCE_RULES) verified by live testing against a real repository,
// not by a unit test - there is no deterministic code path here to assert
// against without reimplementing the AI's judgment.

// Scenario 10 (LOW confidence from a critical gap withholds a final DU
// result even when assumptions were used) is covered in duEngine.test.ts's
// "determineScoringStatus" suite, since that is where the final status is
// decided.
