// Requirement Challenge & Optimization (requirement-challenge-v1) -
// deterministic, fully unit-tested, no LLM calls. Mirrors
// scoring/clarificationGate.ts's split: the AI (see
// ai/prompts.ts buildRequirementChallengePrompt) proposes; this module is
// the only place that decides how proposals are deduplicated across runs,
// how a user decision (ACCEPT/REJECT/EDIT) changes the working requirement,
// and whether the current draft is ready for approval. Never touches DU,
// effort, technology fit, Commercial DU, or price - Requirement Challenge
// is a preparation stage for those five models, not a sixth one.

import { randomUUID } from "node:crypto";
import type {
  Assumption,
  Clarification,
  MissingInformation,
  Requirement,
  RequirementApprovalStatus,
  RequirementChallengeOutput,
  RequirementChallengeProposal,
  RequirementChallengeProposalInput,
  RequirementChallengeType,
  RequirementContext,
} from "../domain/types.js";

/**
 * Two proposals are "the same recommendation" if they share a type and
 * target the same source text - a pragmatic, string-based key (spec
 * section 33: "keine unnötige Embedding-Infrastruktur"), not semantic
 * matching.
 */
function proposalKey(p: { type: RequirementChallengeType; originalText: string }): string {
  return `${p.type}::${p.originalText.trim().toLowerCase()}`;
}

function evidenceKey(e: RequirementChallengeProposalInput["evidence"][number]): string {
  return `${e.sourceType}::${e.reference}`;
}

/** Whether `fresh` cites at least one evidence entry `decided` did not have - the "changed evidence" signal that lets a REJECTED proposal legitimately resurface (spec section 34). */
function hasNewEvidence(decided: RequirementChallengeProposal, fresh: RequirementChallengeProposalInput): boolean {
  const oldKeys = new Set(decided.evidence.map(evidenceKey));
  return fresh.evidence.some((e) => !oldKeys.has(evidenceKey(e)));
}

/**
 * Merges a fresh Challenge run's proposals with whatever this context
 * already has. Rules (spec sections 10/33/34):
 * - A DECIDED proposal (ACCEPTED/REJECTED/EDITED/SUPERSEDED) is never
 *   silently replaced or duplicated - it is kept exactly as decided.
 * - The one exception: a REJECTED proposal may resurface as a brand-new
 *   PENDING proposal if the fresh run cites genuinely new evidence for the
 *   same type+originalText - never for unchanged evidence.
 * - An existing PENDING proposal with the same key is refreshed in place
 *   (same id, updated content) rather than duplicated.
 * - A DECIDED proposal the fresh run no longer emits at all is still kept
 *   (a user decision is never dropped just because a later run stopped
 *   mentioning it) - only un-decided (PENDING) ones may quietly disappear.
 */
export function dedupeChallengeProposals(
  existingProposals: RequirementChallengeProposal[],
  freshProposals: RequirementChallengeProposalInput[],
): RequirementChallengeProposal[] {
  const now = new Date().toISOString();
  const decidedByKey = new Map(existingProposals.filter((p) => p.status !== "PENDING").map((p) => [proposalKey(p), p]));
  const pendingByKey = new Map(existingProposals.filter((p) => p.status === "PENDING").map((p) => [proposalKey(p), p]));

  const result: RequirementChallengeProposal[] = [];
  const seenKeys = new Set<string>();

  for (const fresh of freshProposals) {
    const key = proposalKey(fresh);
    seenKeys.add(key);

    const decided = decidedByKey.get(key);
    if (decided) {
      if (decided.status === "REJECTED" && hasNewEvidence(decided, fresh)) {
        result.push({ ...fresh, id: randomUUID(), status: "PENDING", editedChange: null, decidedAt: null, createdAt: now });
      } else {
        result.push(decided);
      }
      continue;
    }

    const pending = pendingByKey.get(key);
    result.push(
      pending
        ? { ...pending, ...fresh, id: pending.id, status: "PENDING", editedChange: null, decidedAt: null, createdAt: pending.createdAt }
        : { ...fresh, id: randomUUID(), status: "PENDING", editedChange: null, decidedAt: null, createdAt: now },
    );
  }

  for (const existing of existingProposals) {
    if (existing.status !== "PENDING" && !seenKeys.has(proposalKey(existing))) {
      result.push(existing);
    }
  }

  return result;
}

export class ChallengeProposalNotFoundError extends Error {}

export type ChallengeProposalAction = "ACCEPT" | "REJECT" | "EDIT";

/** The text a decided proposal actually contributes - the user's own edit takes precedence over the AI's original suggestion. */
function resolvedChangeText(proposal: RequirementChallengeProposal): string {
  return proposal.status === "EDITED" && proposal.editedChange ? proposal.editedChange : proposal.proposedChange;
}

const CHALLENGE_TYPE_NOTE_LABELS: Record<RequirementChallengeType, string> = {
  UNCLEAR: "Klarstellung",
  ASSUMPTION: "Angenommen",
  SOLUTION_CONSTRAINT: "Lösungsoffen formuliert",
  OPTIMIZATION: "Optimiert",
  CONFLICT: "Konflikt aufgelöst",
  SCOPE_REDUCTION: "Umfang eingegrenzt",
  REUSE_OPPORTUNITY: "Wiederverwendung",
  ACCEPTANCE_IMPROVEMENT: "Akzeptanzkriterium",
};

/**
 * Locates the list entry a proposal's `originalText` refers to. Exact match
 * (trimmed, case-insensitive) first; a substring-containment fallback
 * second, for when the AI's copy differs by trivial punctuation/whitespace
 * from the list entry it was told to copy verbatim - deliberately NOT
 * semantic/embedding matching (kept pragmatic per spec section 33), and only
 * ever used to locate one of a requirement's own short, discrete list
 * entries, where a false positive is very unlikely.
 */
function findMatchingIndex(list: string[], originalText: string): number {
  const needle = originalText.trim().toLowerCase();
  if (needle.length === 0) return -1;

  const exactIdx = list.findIndex((entry) => entry.trim().toLowerCase() === needle);
  if (exactIdx >= 0) return exactIdx;

  return list.findIndex((entry) => {
    const haystack = entry.trim().toLowerCase();
    return haystack.length > 0 && (haystack.includes(needle) || needle.includes(haystack));
  });
}

/**
 * Deterministically rebuilds the working Requirement from the normalized
 * base plus every currently ACCEPTED/EDITED proposal - recomputed from
 * scratch every time a decision changes (never incrementally mutated), so
 * toggling a decision back and forth can never accumulate duplicate notes.
 *
 * `targetField` (set by every AI-produced proposal, see
 * ai/prompts.ts CHALLENGE_TARGET_FIELD_RULE) is the authoritative signal for
 * which part of the requirement actually gets rewritten: ACCEPTANCE_CRITERION/
 * CONSTRAINT replace (or add) the matching discrete list entry - safe
 * because those arrays are already lists of separate items, not continuous
 * prose - so an accepted "the requirement text doesn't have to mandate the
 * existing vector database" proposal actually rewrites the Randbedingung
 * that says so, not just the free-text description (a real gap found via
 * live use: a proposal's originalText was a paraphrase from the description
 * rather than the constraint's own wording, so it silently missed the
 * constraint and only left a note - findMatchingIndex's substring fallback
 * and the stronger prompt instruction both address this). Only DESCRIPTION
 * (or a legacy proposal persisted before targetField existed, matched via
 * the old ACCEPTANCE_IMPROVEMENT-type / exact-constraint-match heuristic) is
 * appended as an explicitly labeled note rather than spliced into the
 * free-text description - the original customer wording must never be
 * silently rewritten (spec section 5: "Original Requirement ist
 * unveränderliche Quelle").
 */
export function buildOptimizedRequirement(base: Requirement, proposals: RequirementChallengeProposal[]): Requirement {
  let acceptanceCriteria = [...base.acceptanceCriteria];
  let constraints = [...base.constraints];
  const notes: string[] = [];

  for (const proposal of proposals) {
    if (proposal.status !== "ACCEPTED" && proposal.status !== "EDITED") continue;
    const changeText = resolvedChangeText(proposal);
    const originalText = proposal.originalText.trim();
    const targetField = proposal.targetField;

    if (targetField === "ACCEPTANCE_CRITERION" || (!targetField && proposal.type === "ACCEPTANCE_IMPROVEMENT")) {
      const idx = findMatchingIndex(acceptanceCriteria, originalText);
      acceptanceCriteria = idx >= 0 ? acceptanceCriteria.map((c, i) => (i === idx ? changeText : c)) : [...acceptanceCriteria, changeText];
      continue;
    }

    if (targetField === "CONSTRAINT") {
      const idx = findMatchingIndex(constraints, originalText);
      constraints = idx >= 0 ? constraints.map((c, i) => (i === idx ? changeText : c)) : [...constraints, changeText];
      continue;
    }

    if (!targetField) {
      // Legacy proposals predating targetField: only ever replace an exact
      // constraint match (never add) - narrower than the new CONSTRAINT
      // path above, since we can't be sure of a legacy proposal's intent.
      const legacyIdx = constraints.findIndex((c) => c.trim() === originalText);
      if (legacyIdx >= 0) {
        constraints = constraints.map((c, i) => (i === legacyIdx ? changeText : c));
        continue;
      }
    }

    notes.push(`[${CHALLENGE_TYPE_NOTE_LABELS[proposal.type]}] ${changeText}`);
  }

  return {
    title: base.title,
    description: notes.length > 0 ? `${base.description}\n\n${notes.join("\n")}` : base.description,
    acceptanceCriteria,
    constraints,
  };
}

export interface ChallengeApprovalGateResult {
  canApprove: boolean;
  /** In German - shown to the user as-is when approval is blocked. */
  reasons: string[];
}

/** spec section 38: what must hold before APPROVED is allowed - deliberately does NOT require every proposal to be decided (a PENDING proposal the user chooses to ignore for now is not a blocker). */
export function checkChallengeApprovalGate(context: Pick<RequirementContext, "clarifications" | "requirement">): ChallengeApprovalGateResult {
  const reasons: string[] = [];
  if (context.clarifications.some((c) => c.status === "PENDING")) {
    reasons.push("Es gibt noch offene Klärungsfragen.");
  }
  if (context.requirement.title.trim().length === 0) {
    reasons.push("Es fehlt ein Titel.");
  }
  if (context.requirement.description.trim().length === 0) {
    reasons.push("Es fehlt eine Beschreibung.");
  }
  if (context.requirement.acceptanceCriteria.length === 0) {
    reasons.push("Es sind keine Akzeptanzkriterien vorhanden.");
  }
  return { canApprove: reasons.length === 0, reasons };
}

/**
 * Recomputes the approval lifecycle status from the context's current
 * content - called after every event that could change it (a Challenge run,
 * a proposal decision, a manual requirement edit). Deliberately does NOT
 * special-case an existing "APPROVED" status - the caller (routes) decides
 * whether a change should revert an already-approved context back to
 * READY_FOR_APPROVAL, since that also involves deciding whether to leave
 * approvedRequirement untouched (see api/requirementContextRoutes.ts).
 */
export function evaluateApprovalStatus(context: Pick<RequirementContext, "clarifications" | "requirement" | "challengeAnalysis" | "challengeProposals">): RequirementApprovalStatus {
  const hasRunChallenge = context.challengeAnalysis !== null || context.challengeProposals.length > 0;
  if (!hasRunChallenge) return "DRAFT";

  const hasPendingProposals = context.challengeProposals.some((p) => p.status === "PENDING");
  const hasPendingClarifications = context.clarifications.some((c) => c.status === "PENDING");
  if (hasPendingProposals || hasPendingClarifications) return "CHALLENGE_IN_PROGRESS";

  return checkChallengeApprovalGate(context).canApprove ? "READY_FOR_APPROVAL" : "CHALLENGE_IN_PROGRESS";
}

/**
 * Pure update: applies a user decision to one Challenge proposal (mirrors
 * scoring/clarificationGate.ts applyAssumptionAction), then deterministically
 * rebuilds `requirement` and the approval status from the new proposal set.
 */
export function applyChallengeProposalAction(
  context: RequirementContext,
  proposalId: string,
  action: ChallengeProposalAction,
  editedText?: string,
): RequirementContext {
  const target = context.challengeProposals.find((p) => p.id === proposalId);
  if (!target) {
    throw new ChallengeProposalNotFoundError(`Challenge proposal ${proposalId} not found on this context.`);
  }
  if (action === "EDIT" && (!editedText || editedText.trim().length === 0)) {
    throw new Error("editedText is required for the EDIT action.");
  }

  const now = new Date().toISOString();
  const challengeProposals = context.challengeProposals.map((p) => {
    if (p.id !== proposalId) return p;
    if (action === "ACCEPT") return { ...p, status: "ACCEPTED" as const, decidedAt: now };
    if (action === "REJECT") return { ...p, status: "REJECTED" as const, decidedAt: now, editedChange: null };
    return { ...p, status: "EDITED" as const, editedChange: editedText!.trim(), decidedAt: now };
  });

  const base = context.normalizedRequirement ?? context.requirement;
  const requirement = buildOptimizedRequirement(base, challengeProposals);
  const nextContext = { ...context, challengeProposals, requirement };

  // Deciding a proposal after APPROVED changes the draft - it must not
  // silently stay "APPROVED" (spec section 40), so this always recomputes
  // rather than special-casing that prior status.
  return {
    ...nextContext,
    approvalStatus: evaluateApprovalStatus(nextContext),
    updatedAt: now,
  };
}

/**
 * Merges a Challenge run's own assumptions/missingInformation into the
 * context - ADDITIVE (appended alongside whatever normalization already
 * established), unlike scoring/clarificationGate.ts buildResolvedContextParts
 * which REPLACES the current round's set wholesale. Challenge assumptions
 * are a distinct layer (solution/optimization-related, spec section 22),
 * not a refinement of normalization's own requirement-understanding
 * assumptions, so the two must not clobber each other.
 */
export function appendChallengeKnowledge(
  context: Pick<RequirementContext, "assumptions" | "missingInformation" | "clarifications">,
  output: Pick<RequirementChallengeOutput, "assumptions" | "missingInformation">,
  maxNewClarifications: number,
): { assumptions: Assumption[]; missingInformation: MissingInformation[]; clarifications: Clarification[] } {
  const freshAssumptions: Assumption[] = output.assumptions.map((a) => ({ ...a, id: randomUUID(), status: "ACTIVE" }));
  const freshMissingInformation: MissingInformation[] = output.missingInformation.map((m) => ({ ...m, id: randomUUID() }));

  // Same "preserve a prior CONFIRM/REJECT decision by topic" rule as
  // scoring/clarificationGate.ts-adjacent assumption merging - a Challenge
  // assumption can in principle share a topic with one the user already
  // decided on (e.g. re-running Challenge after editing the requirement).
  const decidedByTopic = new Map(
    context.assumptions.filter((a) => a.status === "CONFIRMED" || a.status === "REJECTED").map((a) => [a.topic, a]),
  );
  const decidedFreshAssumptions = freshAssumptions.map((a) => {
    const decided = decidedByTopic.get(a.topic);
    return decided ? { ...a, status: decided.status, assumption: decided.assumption } : a;
  });

  const answeredQuestions = new Set(context.clarifications.filter((c) => c.status === "ANSWERED").map((c) => c.question));
  const candidates = freshMissingInformation.filter(
    (info) => info.classification === "CLARIFICATION_REQUIRED" && !answeredQuestions.has(info.question),
  );
  const prioritized = [...candidates].sort((a, b) => b.potentialScoreImpact - a.potentialScoreImpact);
  const priorityOffset = context.clarifications.reduce((max, c) => Math.max(max, c.priority), 0);
  const newClarifications: Clarification[] = prioritized.slice(0, maxNewClarifications).map((info, index) => ({
    id: randomUUID(),
    missingInformationId: info.id,
    question: info.question,
    priority: priorityOffset + index + 1,
    status: "PENDING" as const,
    answer: null,
    answeredAt: null,
  }));

  return {
    assumptions: [...context.assumptions, ...decidedFreshAssumptions],
    missingInformation: [...context.missingInformation, ...freshMissingInformation],
    clarifications: [...context.clarifications, ...newClarifications],
  };
}
