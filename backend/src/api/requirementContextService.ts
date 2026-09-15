// Glue between the AIProvider (classifies information, proposes
// assumptions/clarifications) and the deterministic clarification gate
// (decides how many of those actually become a question). Every entry point
// that needs a fresh or updated RequirementContext goes through here, so
// "run resolution, then persist" only happens in one place.

import { getAIProvider } from "../ai/getAIProvider.js";
import { DEFAULT_QUALITY_LEVEL, QUALITY_PROFILES } from "../domain/qualityLevels.js";
import type { QualityLevel, RepositorySnapshot, Requirement, RequirementContext } from "../domain/types.js";
import { buildResolvedContextParts, hasPendingClarifications } from "../scoring/clarificationGate.js";
import { store } from "../store/PostgresScoringStore.js";

export class RequirementContextError extends Error {}

/**
 * Runs one round of context resolution: calls the AI to (re-)classify
 * information given everything answered so far, applies the deterministic
 * clarification gate, and persists the result. Reused for the initial
 * resolution, after a clarification answer, and after an assumption is
 * rejected (all three can surface a fresh or updated set of questions).
 *
 * `qualityLevel` only matters on the very first call (existing === null) -
 * it is fixed on the RequirementContext from then on and every later round
 * reuses it, so a run never drifts between depths partway through (see
 * domain/types.ts QualityLevel).
 */
export async function runContextResolution(
  snapshotId: string,
  requirement: Requirement,
  existing: RequirementContext | null,
  qualityLevel: QualityLevel = DEFAULT_QUALITY_LEVEL,
): Promise<RequirementContext> {
  const snapshot = await store.getSnapshot(snapshotId);
  if (!snapshot || snapshot.status !== "SNAPSHOT_CREATED" || !snapshot.profile) {
    throw new RequirementContextError("Repository has not been successfully analyzed yet.");
  }

  const repositoryContext = await store.getRepositoryContext(snapshotId);
  if (!repositoryContext) {
    throw new RequirementContextError(
      "Repository context is not available for this snapshot. Re-analyze the repository.",
    );
  }

  const effectiveQualityLevel = existing?.qualityLevel ?? qualityLevel;
  const profile = QUALITY_PROFILES[effectiveQualityLevel];

  const now = new Date().toISOString();
  const priorClarifications = existing?.clarifications ?? [];
  const answered = priorClarifications.filter((c) => c.status === "ANSWERED");
  // Computed before the AI call (not after, as the returned context used to)
  // so it can be attached to the usage log entry for this call - the app's
  // own id, not something derived from the AI's response.
  const contextId = existing?.id ?? store.createRequirementContextId();
  const priorRounds = existing?.resolutionRounds ?? 0;
  // Past the chosen quality level's maxResolutionRounds, this round's AI
  // call still runs (it may resolve everything itself), but no new
  // clarification question is ever surfaced from it - see
  // clarificationGate.ts buildResolvedContextParts.
  const maxNewClarifications = priorRounds < profile.maxResolutionRounds ? profile.maxClarificationsPerRound : 0;

  const aiProvider = getAIProvider();
  const output = await aiProvider.resolveRequirementContext(
    requirement,
    snapshot.profile as NonNullable<RepositorySnapshot["profile"]>,
    repositoryContext,
    answered,
    effectiveQualityLevel,
    { snapshotId, requirementContextId: contextId },
  );

  const parts = buildResolvedContextParts(output, priorClarifications, maxNewClarifications);

  const context: RequirementContext = {
    id: contextId,
    snapshotId,
    requirement,
    qualityLevel: effectiveQualityLevel,
    normalization: output.normalization,
    knownFacts: parts.knownFacts,
    assumptions: mergeAssumptionDecisions(parts.assumptions, existing?.assumptions ?? []),
    missingInformation: parts.missingInformation,
    clarifications: parts.clarifications,
    status: hasPendingClarifications(parts) ? "AWAITING_CLARIFICATION" : "RESOLVED",
    resolutionRounds: priorRounds + 1,
    errorMessage: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await store.saveRequirementContext(context);
  return context;
}

/**
 * A fresh resolution round proposes brand-new assumption objects (new ids)
 * even for topics the user already confirmed/rejected. Carry the user's
 * decision over by topic so re-resolving doesn't silently discard it.
 */
function mergeAssumptionDecisions(
  freshAssumptions: RequirementContext["assumptions"],
  priorAssumptions: RequirementContext["assumptions"],
): RequirementContext["assumptions"] {
  if (priorAssumptions.length === 0) return freshAssumptions;

  const decidedByTopic = new Map(
    priorAssumptions.filter((a) => a.status === "CONFIRMED" || a.status === "REJECTED").map((a) => [a.topic, a]),
  );

  return freshAssumptions.map((assumption) => {
    const decided = decidedByTopic.get(assumption.topic);
    if (!decided) return assumption;
    return { ...assumption, status: decided.status, assumption: decided.assumption };
  });
}
