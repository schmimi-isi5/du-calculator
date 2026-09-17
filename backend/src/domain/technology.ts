// Technology Fit Model - separate from the DU Model (duEngine.ts) and the
// Effort Model (effortEstimator.ts). Answers a different question than DU
// ("how big/risky is the result?"): "how well does each production method
// fit THIS requirement's actual technical shape, and how does that change
// the human effort relative to our own AI-native baseline?"
//
// Anti-bias principle (see also ai/prompts.ts ANTI_BIAS_RULE): AI_NATIVE is
// our current production method - git-based custom development with coding
// agents (Claude Code), not classical unassisted manual coding. It must be
// modeled with a real, symmetric CapabilityProfile like every other
// technology, never treated as a neutral zero-effect baseline while n8n/
// Intrexx get to look better by comparison. A technology may be better than
// another in some respects and worse in others - the model must be able to
// output BOTH >100% and <100% relative effort for every technology,
// depending on the actual requirement.

/**
 * The requirement characteristics that actually determine how well a
 * production method fits it. Deliberately NOT the same as the 8 DU
 * dimensions (DimensionKey) - DU measures scope/complexity/risk of the
 * DELIVERABLE; these measure the requirement's TECHNICAL SHAPE, which is
 * what determines whether a low-code platform or AI-native custom code is
 * the better fit. The two dimension sets partially overlap in spirit but
 * are computed and used independently - never conflate them.
 */
export const TECHNOLOGY_PROFILE_FACTORS = [
  "uiForms",
  "crudDataManagement",
  "workflowOrchestration",
  "standardConnectors",
  "customIntegrations",
  "customBusinessLogic",
  "aiAgentsRag",
  "complexStateManagement",
  "customAlgorithms",
  "testingRequirements",
  "deploymentComplexity",
  "expectedChangeFrequency",
] as const;

export type TechnologyProfileFactor = (typeof TECHNOLOGY_PROFILE_FACTORS)[number];

/**
 * The production methods this comparison currently models. Extensible -
 * adding a new one means adding it here, a CapabilityProfile entry below,
 * and a display label (scoring/technologyFitEngine.ts TECHNOLOGY_LABELS).
 * Nothing else needs to change; the fit math is generic over this list.
 */
export const TECHNOLOGY_IDS = ["AI_NATIVE", "N8N", "INTREXX"] as const;

export type TechnologyId = (typeof TECHNOLOGY_IDS)[number];

/** Currently the only supported combination - a tuple, not a free product, so overhead constants can be looked up per pairing. */
export const SUPPORTED_COMBINATIONS: readonly TechnologyId[][] = [["N8N", "INTREXX"]];

export type CombinationKey = "N8N_INTREXX";

/** Every technology-comparison row this app can ever produce - the base technologies plus their supported combinations. */
export type TechnologyKey = TechnologyId | CombinationKey;

/**
 * Relative productivity effect of a technology on a given requirement
 * characteristic, on a fixed -1.0..+1.0 scale:
 *  -1.0 = considerable extra effort compared to a neutral baseline
 *  -0.5 = clear disadvantage
 *   0.0 = neutral / not particularly relevant
 *  +0.5 = clear advantage
 *  +1.0 = very large advantage
 */
export type CapabilityEffect = number;

export type CapabilityProfile = Record<TechnologyProfileFactor, CapabilityEffect>;

/**
 * START HYPOTHESES, not empirically validated measurements. These must live
 * in exactly this one place - never hard-code a platform "suitability"
 * number anywhere else in the codebase - so they can be reviewed and
 * recalibrated later against real ISIFIVE project outcomes (see
 * store/ActualEffortStore.ts) without hunting through multiple files.
 */
export const CALIBRATION_STATUS = "INITIAL_HYPOTHESIS" as const;

export const TECHNOLOGY_CAPABILITY_PROFILES: Record<TechnologyId, CapabilityProfile> = {
  // AI_NATIVE = our actual production method: git-based custom development
  // with coding agents (Claude Code) generating/assisting the code, a human
  // handling briefing, architecture, review, and correction. NOT classical
  // unassisted manual development - see ai/prompts.ts ANTI_BIAS_RULE.
  AI_NATIVE: {
    uiForms: 0.25,
    crudDataManagement: 0.25,
    workflowOrchestration: 0.2,
    standardConnectors: 0.1,
    customIntegrations: 0.55,
    customBusinessLogic: 0.7,
    aiAgentsRag: 0.75,
    complexStateManagement: 0.55,
    customAlgorithms: 0.75,
    testingRequirements: 0.55,
    deploymentComplexity: 0.2,
    expectedChangeFrequency: 0.55,
  },
  N8N: {
    uiForms: -0.45,
    crudDataManagement: -0.25,
    workflowOrchestration: 0.75,
    standardConnectors: 0.75,
    customIntegrations: 0.3,
    customBusinessLogic: -0.2,
    aiAgentsRag: 0.05,
    complexStateManagement: -0.4,
    customAlgorithms: -0.45,
    testingRequirements: -0.2,
    deploymentComplexity: 0.2,
    expectedChangeFrequency: 0.2,
  },
  INTREXX: {
    uiForms: 0.7,
    crudDataManagement: 0.75,
    workflowOrchestration: 0.45,
    standardConnectors: 0.35,
    customIntegrations: 0.15,
    customBusinessLogic: 0.05,
    aiAgentsRag: -0.3,
    complexStateManagement: 0.1,
    customAlgorithms: -0.3,
    testingRequirements: -0.1,
    deploymentComplexity: 0.4,
    expectedChangeFrequency: 0.35,
  },
};

/**
 * How much a technology's own existing-asset leverage (see
 * ExistingAssetLeverageSchema) discounts its raw effort score - 1.0 = fully
 * reusable assets halve the score at this weight, 0 = no reuse, no
 * adjustment. A separate, equally provisional hypothesis from the
 * capability profiles above.
 */
export const ASSET_LEVERAGE_WEIGHT = 0.5;

/**
 * Combining two production methods is never free - system boundaries, API
 * contracts, auth/credential handling across systems, cross-system error
 * handling, deployment, monitoring, and needing expertise in multiple
 * platforms all add real overhead on top of whatever the best-of-both fit
 * would otherwise suggest. Expressed as additive fractions applied to the
 * combination's raw effort score (see scoring/technologyFitEngine.ts) - a
 * combination is not guaranteed to beat both individual technologies, only
 * allowed to.
 */
export const COMBINATION_INTEGRATION_OVERHEAD = 0.15;
export const COMBINATION_OPERATIONAL_OVERHEAD = 0.1;

/**
 * Technical guardrails only - they exist to catch a runaway or degenerate
 * calculation (e.g. a division by a near-zero score), not to assert that
 * real-world relative productivity is actually bounded this tightly. Do not
 * present these as a fact-based range to a user.
 */
export const RELATIVE_EFFORT_FACTOR_GUARDRAIL_MIN = 0.2;
export const RELATIVE_EFFORT_FACTOR_GUARDRAIL_MAX = 3.0;

/** Floor to avoid dividing by (near) zero when a raw score collapses toward 0 from an extreme capability effect. */
export const RAW_SCORE_EPSILON = 0.01;
