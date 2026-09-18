// Glue between the AIProvider (classifies information, proposes
// assumptions/clarifications) and the deterministic clarification gate
// (decides how many of those actually become a question). Every entry point
// that needs a fresh or updated RequirementContext goes through here, so
// "run resolution, then persist" only happens in one place.

import { getAIProviderForModel } from "../ai/getAIProvider.js";
import { currentModelRegistry, currentProviderCredentials } from "../ai/providerAvailability.js";
import { config } from "../config.js";
import {
  getModelById,
  resolveAutoModel,
  resolveDefaultModel,
  type AutoRoutingCriteria,
} from "../domain/models.js";
import { DEFAULT_QUALITY_LEVEL, QUALITY_PROFILES } from "../domain/qualityLevels.js";
import { REQUIREMENT_PREPARATION_VERSION } from "../domain/requirementChallenge.js";
import type {
  QualityLevel,
  RepositorySnapshot,
  Requirement,
  RequirementContext,
  RequirementNormalization,
} from "../domain/types.js";
import { buildResolvedContextParts, hasPendingClarifications } from "../scoring/clarificationGate.js";
import {
  appendChallengeKnowledge,
  buildOptimizedRequirement,
  dedupeChallengeProposals,
  evaluateApprovalStatus,
} from "../scoring/requirementChallengeEngine.js";
import { getSetting, SETTINGS_KEYS } from "../store/AppSettingsStore.js";
import { store } from "../store/PostgresScoringStore.js";

export class RequirementContextError extends Error {}

/**
 * What the client asked for regarding model choice - resolved to a concrete
 * registry id inside runContextResolution, which is the one place that has
 * the repository context Auto-routing needs (see domain/models.ts
 * AutoRoutingCriteria.isLargeContext). "explicit"/"auto" are only ever
 * constructed by requirementContextRoutes.ts after validating against the
 * registry, so runContextResolution can trust modelId is real.
 */
export type ModelSelection =
  | { kind: "explicit"; modelId: string }
  | { kind: "auto" }
  | { kind: "default" };

/**
 * The model a request falls back to when it doesn't choose one at all (spec
 * section 7) - not the same as an explicit "auto" pick (section 8), which
 * runs the routing rule table instead. An operator-set default (Einstellungen
 * tab, persisted via AppSettingsStore) takes precedence over the
 * DEFAULT_LLM_MODEL env var, which in turn seeds it if no override exists
 * yet - either way, resolveDefaultModel still falls through its own chain if
 * the configured id turns out to be unavailable.
 */
export async function defaultModelId(): Promise<string> {
  const override = await getSetting(SETTINGS_KEYS.defaultModelId);
  return resolveDefaultModel(
    currentProviderCredentials(),
    override ?? config.defaultLlmModel,
    config.allowPremiumAutoFallback,
    currentModelRegistry(),
  );
}

/**
 * Runs one round of context resolution: calls the AI to (re-)classify
 * information given everything answered so far, applies the deterministic
 * clarification gate, and persists the result. Reused for the initial
 * resolution, after a clarification answer, and after an assumption is
 * rejected (all three can surface a fresh or updated set of questions).
 *
 * `qualityLevel`/`modelSelection` only matter on the very first call
 * (existing === null) - the resolved model is fixed on the
 * RequirementContext from then on and every later round reuses it, so a run
 * never drifts partway through (see domain/types.ts QualityLevel).
 */
export async function runContextResolution(
  snapshotId: string,
  requirement: Requirement,
  existing: RequirementContext | null,
  qualityLevel: QualityLevel = DEFAULT_QUALITY_LEVEL,
  modelSelection: ModelSelection = { kind: "default" },
  privacyMode?: "local-only",
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
  const effectiveModel =
    existing?.model ??
    (await resolveModelSelection(modelSelection, effectiveQualityLevel, repositoryContext.omittedFileCount > 0, privacyMode));
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

  const modelEntry = getModelById(effectiveModel, currentModelRegistry());
  if (!modelEntry) {
    throw new RequirementContextError(`Unknown model "${effectiveModel}".`);
  }
  const aiProvider = getAIProviderForModel(modelEntry);
  const output = await aiProvider.resolveRequirementContext(
    requirement,
    snapshot.profile as NonNullable<RepositorySnapshot["profile"]>,
    repositoryContext,
    answered,
    effectiveQualityLevel,
    effectiveModel,
    { snapshotId, requirementContextId: contextId },
    snapshot.mode,
  );

  const parts = buildResolvedContextParts(output, priorClarifications, maxNewClarifications);

  // The user now types one free-text description, with no separate title/
  // acceptance-criteria fields (see api/requirementInput.ts). On the FIRST
  // round only, adopt the AI's own normalization as the actual Requirement -
  // its suggestedTitle becomes Requirement.title, and its derived
  // acceptanceCriteria/technicalConstraints are merged into
  // Requirement.acceptanceCriteria/constraints (deduplicated, alongside
  // anything the user optionally typed into the constraints field
  // themselves). A later round (answering a clarification) never overwrites
  // this again, so it never silently discards an edit made via the
  // requirement-review endpoint in between.
  const effectiveRequirement = existing === null ? applyNormalizationToRequirement(requirement, output.normalization) : requirement;
  const isFirstRound = existing === null;

  const context: RequirementContext = {
    id: contextId,
    snapshotId,
    requirement: effectiveRequirement,
    // Immutable once set - see domain/types.ts RequirementContext. The
    // FIRST round's inputs are the true "as submitted"/"as normalized"
    // snapshots; every later round (answering a clarification) reuses them
    // unchanged, since re-resolving doesn't change what was originally
    // written or how it was first normalized, only what's known about it.
    originalRequirement: existing?.originalRequirement ?? requirement,
    normalizedRequirement: existing?.normalizedRequirement ?? effectiveRequirement,
    approvedRequirement: existing?.approvedRequirement ?? null,
    approvalStatus: existing?.approvalStatus ?? "DRAFT",
    challengeAnalysis: existing?.challengeAnalysis ?? null,
    challengeProposals: existing?.challengeProposals ?? [],
    requirementPreparationVersion: existing?.requirementPreparationVersion ?? (isFirstRound ? REQUIREMENT_PREPARATION_VERSION : null),
    qualityLevel: effectiveQualityLevel,
    model: effectiveModel,
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
 * Runs (or re-runs) Requirement Challenge & Optimization - a distinct AI
 * call from context resolution, since it produces a genuinely different
 * shape (proposals + analysis, never facts/DU-relevant classification) and
 * only makes sense once resolution itself has no open clarifications left
 * (spec: Challenge reads the settled normalized draft, not one still
 * shifting round to round). Never mutates originalRequirement/
 * normalizedRequirement - only challengeAnalysis/challengeProposals/
 * assumptions/missingInformation/clarifications/requirement/approvalStatus.
 */
export async function runRequirementChallenge(context: RequirementContext): Promise<RequirementContext> {
  if (context.status !== "RESOLVED") {
    throw new RequirementContextError("Requirement context must be fully resolved (no open clarifications) before running Requirement Challenge.");
  }

  const snapshot = await store.getSnapshot(context.snapshotId);
  if (!snapshot || snapshot.status !== "SNAPSHOT_CREATED" || !snapshot.profile) {
    throw new RequirementContextError("Repository has not been successfully analyzed yet.");
  }
  const repositoryContext = await store.getRepositoryContext(context.snapshotId);
  if (!repositoryContext) {
    throw new RequirementContextError("Repository context is not available for this snapshot. Re-analyze the repository.");
  }

  const modelEntry = getModelById(context.model, currentModelRegistry());
  if (!modelEntry) {
    throw new RequirementContextError(`Unknown model "${context.model}".`);
  }
  const aiProvider = getAIProviderForModel(modelEntry);
  const normalizedRequirement = context.normalizedRequirement ?? context.requirement;
  const knowledge = { knownFacts: context.knownFacts, assumptions: context.assumptions };

  const output = await aiProvider.challengeRequirement(
    context.originalRequirement,
    normalizedRequirement,
    snapshot.profile as NonNullable<RepositorySnapshot["profile"]>,
    repositoryContext,
    knowledge,
    context.challengeProposals,
    context.qualityLevel,
    context.model,
    { snapshotId: context.snapshotId, requirementContextId: context.id },
    snapshot.mode,
  );

  const challengeProposals = dedupeChallengeProposals(context.challengeProposals, output.proposals);
  const maxNewClarifications = QUALITY_PROFILES[context.qualityLevel].maxClarificationsPerRound;
  const knowledgeUpdate = appendChallengeKnowledge(context, output, maxNewClarifications);

  const requirement = normalizedRequirement;
  const now = new Date().toISOString();
  const nextContext: RequirementContext = {
    ...context,
    challengeAnalysis: output.analysis,
    challengeProposals,
    assumptions: knowledgeUpdate.assumptions,
    missingInformation: knowledgeUpdate.missingInformation,
    clarifications: knowledgeUpdate.clarifications,
    // Re-running Challenge always restarts from the untouched normalized
    // draft, then re-applies every currently decided proposal - so a
    // second Challenge run never doubles up notes from the first one.
    requirement: buildOptimizedRequirement(requirement, challengeProposals),
    updatedAt: now,
  };
  nextContext.approvalStatus = evaluateApprovalStatus(nextContext);

  await store.saveRequirementContext(nextContext);
  return nextContext;
}

/**
 * Turns a client's model choice into a concrete registry id. "auto" and
 * "default" (spec sections 7/8) are genuinely different mechanisms - auto
 * runs the deterministic routing rule table against this run's actual
 * signals, default just walks a fixed fallback chain - so they are kept
 * distinct rather than collapsing "nothing chosen" into "auto".
 * `privacyMode: "local-only"` always routes through the rule table (forcing
 * the local model, no cloud fallback), even for an otherwise-"default"
 * selection, so a privacy-constrained request can never end up on a
 * zero-config cloud default.
 */
export async function resolveModelSelection(
  selection: ModelSelection,
  qualityLevel: QualityLevel,
  isLargeContext: boolean,
  privacyMode: "local-only" | undefined,
): Promise<string> {
  if (selection.kind === "explicit") return selection.modelId;

  if (selection.kind === "auto" || privacyMode === "local-only") {
    const credentials = currentProviderCredentials();
    const registry = currentModelRegistry();
    const criteria: AutoRoutingCriteria = { qualityLevel, isLargeContext, localOnly: privacyMode === "local-only" };
    return resolveAutoModel(criteria, credentials, config.allowPremiumAutoFallback, registry);
  }
  return defaultModelId();
}

function dedupeTrimmed(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (value.length === 0) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/**
 * Turns the AI's own normalization into the actual Requirement, used only on
 * the first resolution round (see call site above) - suggestedTitle replaces
 * the placeholder title from requirementInput.ts, and the AI's derived
 * acceptanceCriteria/technicalConstraints are merged with anything the user
 * already typed (currently only constraints has a manual input field - see
 * RequirementPanel.tsx) rather than replacing it, so a manual addition is
 * never silently dropped.
 */
export function applyNormalizationToRequirement(requirement: Requirement, normalization: RequirementNormalization): Requirement {
  return {
    title: normalization.suggestedTitle.trim() || requirement.title,
    description: requirement.description,
    acceptanceCriteria: dedupeTrimmed([...requirement.acceptanceCriteria, ...normalization.acceptanceCriteria]),
    constraints: dedupeTrimmed([...requirement.constraints, ...normalization.technicalConstraints]),
  };
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
