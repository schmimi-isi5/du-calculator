// Effort Model (C) - bottom-up human-effort estimation (effort-bottom-up-v1).
//
// Replaces the old single, independent AI-native "guess the total" corridor
// with a repository-grounded, explainable Work Breakdown: the AI identifies
// concrete Work Packages and estimates HUMAN effort per package; this
// application aggregates the totals and the overall confidence
// deterministically (scoring/effortEstimator.ts). See domain/types.ts for
// the actual shapes (EffortWorkPackage, EffortWorkBreakdown, ...) - this
// file only holds the fixed category/action vocabularies and the small set
// of tuning constants, mirroring the domain/commercial.ts and
// domain/technology.ts split (vocabulary + constants here, shapes in
// domain/types.ts).
//
// Base DU, Technology Fit, Commercial DU, and Pricing are explicitly NOT
// touched by this change - see domain/types.ts DuResult.calculationModelVersion,
// which stays "commercial-du-v2". Only the Effort Model's own internals
// change; everything downstream keeps consuming the same EffortEstimate
// shape (minHours/likelyHours/maxHours/confidence/rationale), now populated
// by aggregation instead of an independent AI judgment, plus an optional
// `workBreakdown` for full explainability.

export const EFFORT_CALCULATION_METHOD = "BOTTOM_UP_WORK_PACKAGE_AGGREGATION" as const;
export const EFFORT_CALCULATION_MODEL_VERSION = "effort-bottom-up-v1" as const;

/**
 * A Work Package broadly larger than this (spec heuristic, not a hard
 * limit) gets flagged LARGE_WORK_PACKAGE - not wrong by itself, but a
 * candidate for further decomposition since smaller packages are easier to
 * explain, review, and later calibrate against actuals.
 */
export const LARGE_WORK_PACKAGE_THRESHOLD_HOURS = 16;

/**
 * "Hohe Zahl UNKNOWN Evidences" (spec section 45) - a heuristic count, not a
 * precise statistical threshold. Counts UNKNOWN repositoryEvidence entries
 * across all Work Packages; at or above this many, the LOW_EVIDENCE sanity
 * flag fires so a human can double-check before trusting the estimate.
 */
export const LOW_EVIDENCE_UNKNOWN_COUNT_THRESHOLD = 3;

export const EFFORT_WORK_PACKAGE_CATEGORIES = [
  "ANALYSIS",
  "ARCHITECTURE",
  "DATA_MODEL",
  "BACKEND",
  "FRONTEND",
  "INTEGRATION",
  "AI_RAG_AGENT",
  "AUTOMATION",
  "MIGRATION",
  "TESTING_QA",
  "DEPLOYMENT",
  "DOCUMENTATION",
  "OTHER",
] as const;
export type EffortWorkPackageCategory = (typeof EFFORT_WORK_PACKAGE_CATEGORIES)[number];

export const EFFORT_WORK_PACKAGE_ACTIONS = [
  "CREATE",
  "MODIFY",
  "CONFIGURE",
  "INTEGRATE",
  "MIGRATE",
  "TEST",
  "DEPLOY",
  "REVIEW",
  "OTHER",
] as const;
export type EffortWorkPackageAction = (typeof EFFORT_WORK_PACKAGE_ACTIONS)[number];

/** How much a Work Package can lean on an existing component - input/explanation/calibration signal only, never a second discount applied on top of the AI's own humanEffort estimate (spec: "Reuse nicht doppelt verrechnen"). */
export const WORK_PACKAGE_REUSE_LEVELS = ["NONE", "LOW", "MEDIUM", "HIGH"] as const;
export type WorkPackageReuseLevel = (typeof WORK_PACKAGE_REUSE_LEVELS)[number];

export const EFFORT_DRIVER_IMPACTS = ["INCREASE", "DECREASE"] as const;
export type EffortDriverImpact = (typeof EFFORT_DRIVER_IMPACTS)[number];

/**
 * Deterministic, app-computed flags from the Sanity Check (spec section 45)
 * - explainability signals only, never a hidden hour adjustment. Categories
 * whose Work Packages are missing entirely (e.g. no TESTING_QA package at
 * all) are deliberately not flagged as "missing" here - most requirements
 * legitimately don't need every category (spec section 22: "Keine Kategorie
 * muss zwangsläufig ein Work Package erzeugen").
 */
export const EFFORT_SANITY_FLAGS = [
  "EFFORT_REVIEW_RECOMMENDED",
  "LARGE_WORK_PACKAGE",
  "LOW_EVIDENCE",
  "POSSIBLE_MISSING_TESTING",
  "POSSIBLE_OVERLAP",
] as const;
export type EffortSanityFlag = (typeof EFFORT_SANITY_FLAGS)[number];
