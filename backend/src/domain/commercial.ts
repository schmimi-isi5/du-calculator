// Commercial Model (D) - Base DU (domain/duEngine.ts) describes technical
// scope/complexity/risk; Commercial DU is the actual commercial unit
// offered to the customer, informed by Base DU plus everything Base DU
// deliberately does NOT capture: the AI-native effort estimate (compared
// against a per-class benchmark, not a flat "1 DU = X hours" rate), direct
// costs, implementation novelty, and commercial risk. See
// scoring/commercialEngine.ts for the actual calculation.
//
// Every constant here is CALIBRATION_STATUS = "INITIAL_HYPOTHESIS" - a
// documented, reviewable starting point, not an empirically validated
// figure. They live in exactly this one file so they can be recalibrated
// later against real ISIFIVE outcomes (store/ActualEffortStore.ts) without
// hunting through the engine's logic.

export const CALIBRATION_STATUS = "INITIAL_HYPOTHESIS" as const;

// ---------------------------------------------------------------------------
// Effort benchmarks - explicitly NOT a Development Unit definition.
//
// "1 DU = 6 hours" was removed as a modeling concept: it made a fixed
// hours-per-DU rate look like part of what a Development Unit IS, when it
// was only ever meant as a rough comparison point for judging whether a
// requirement's estimated effort is unusually high or low for its Base DU
// class. Each class now has its OWN independently configurable benchmark
// (currently still linear at 6h/DU as a starting point, so behavior doesn't
// change abruptly) - the calculation must never assume linearity between
// classes, so real ISIFIVE data can later replace these with non-linear
// figures (e.g. XS -> 3.2h, S -> 6.8h, M -> 14.5h, ...) without any code
// change, only a data change here.
// ---------------------------------------------------------------------------

export type BaseDuClass = "XS" | "S" | "M" | "L" | "XL";

export interface EffortBenchmarkEntry {
  baseDU: number;
  /** A provisional comparison point for typically observed AI-native human effort at this Base DU class - NOT a Development Unit definition. */
  expectedLikelyHours: number;
  calibrationStatus: "INITIAL_HYPOTHESIS" | "EXPERT_CALIBRATED" | "EMPIRICALLY_CALIBRATED" | "DATA_DRIVEN";
  /** How many real, recorded ActualEffortRecord observations this benchmark is based on - 0 until real data exists. */
  sampleSize: number;
}

/** Bumped whenever the benchmark VALUES change in a way that affects reproducibility of past calculations - independent of calculationModelVersion, which tracks the overall DuResult shape. */
export const EFFORT_BENCHMARK_MODEL_VERSION = "effort-benchmark-v1";

export const BASE_DU_EFFORT_BENCHMARKS: Record<BaseDuClass, EffortBenchmarkEntry> = {
  XS: { baseDU: 1, expectedLikelyHours: 6, calibrationStatus: "INITIAL_HYPOTHESIS", sampleSize: 0 },
  S: { baseDU: 2, expectedLikelyHours: 12, calibrationStatus: "INITIAL_HYPOTHESIS", sampleSize: 0 },
  M: { baseDU: 4, expectedLikelyHours: 24, calibrationStatus: "INITIAL_HYPOTHESIS", sampleSize: 0 },
  L: { baseDU: 6, expectedLikelyHours: 36, calibrationStatus: "INITIAL_HYPOTHESIS", sampleSize: 0 },
  XL: { baseDU: 10, expectedLikelyHours: 60, calibrationStatus: "INITIAL_HYPOTHESIS", sampleSize: 0 },
};

// ---------------------------------------------------------------------------
// Effort adjustment - deliberately ASYMMETRIC.
//
// Higher-than-benchmark effort MAY raise Commercial DU (dampened, capped).
// Lower-than-benchmark effort (an AI-native productivity gain - from Claude
// Code, coding agents, Konturos, reuse, good architecture, experience, ...)
// is surfaced transparently (productivityGain) but does NOT automatically
// lower Commercial DU - Commercial DU is not a smoothed hourly invoice, and
// ISIFIVE should not be structurally forced to pass its entire productivity
// advantage straight through to the customer. The switch below exists so
// this can be revisited later without a redesign - it defaults to off.
// ---------------------------------------------------------------------------

/** How strongly a positive effort deviation (above benchmark) moves Commercial DU, and how far it may ever move it. */
export const EFFORT_ADJUSTMENT_WEIGHT = 0.5;
export const MAX_EFFORT_ADJUSTMENT_FRACTION = 0.5;

/** Whether a productivity gain (effort below benchmark) may reduce Commercial DU at all. Off by default - see the module comment above. */
export const NEGATIVE_EFFORT_ADJUSTMENT_ENABLED = false;
/** Only meaningful once NEGATIVE_EFFORT_ADJUSTMENT_ENABLED is true - how much of a productivity gain would be passed through as a Commercial DU reduction. Kept at 0 while disabled, so enabling the switch without also setting this has no silent effect. */
export const NEGATIVE_EFFORT_ADJUSTMENT_WEIGHT = 0;

// ---------------------------------------------------------------------------
// Direct costs
// ---------------------------------------------------------------------------

/** How much one-time direct development cost "counts as" one full Base DU of extra commercial value - only ONE_TIME_DEVELOPMENT-type costs feed this; RECURRING_RUNTIME costs are disclosed separately, never folded into Commercial DU. */
export const COST_PER_DU_REFERENCE_EUR = 500;
export const COST_ADJUSTMENT_WEIGHT = 1.0;

// ---------------------------------------------------------------------------
// Implementation novelty (see domain/types.ts ImplementationNoveltyAssessment)
// - the only innovation-related input that may adjust Commercial DU.
// Reusable Innovation/IP (ReusableInnovationAssessment) is captured and
// displayed but deliberately produces NO automatic adjustment - there is no
// validated commercial rule yet for pricing reusable IP, and inventing one
// here would just be a new arbitrary formula.
// ---------------------------------------------------------------------------

/** Proportional Commercial DU bonus for MEDIUM/HIGH implementation novelty - LOW adds nothing. */
export const IMPLEMENTATION_NOVELTY_MEDIUM_BONUS_FRACTION = 0.1;
export const IMPLEMENTATION_NOVELTY_HIGH_BONUS_FRACTION = 0.25;

// ---------------------------------------------------------------------------
// Commercial risk reserve - graduated by effort confidence, not a single
// binary threshold. Guards against double-counting the technical risk
// already inside Base DU's own uncertaintyRisk dimension, and against
// papering over genuine uncertainty with a markup (see
// CommercialEstimateStatus below).
// ---------------------------------------------------------------------------

export const RISK_CONFIDENCE_HIGH_THRESHOLD = 0.8;
export const RISK_CONFIDENCE_MEDIUM_THRESHOLD = 0.65;
export const RISK_CONFIDENCE_LOW_THRESHOLD = 0.5;

/** MEDIUM confidence (0.65-0.79): a small reserve. LOW confidence (0.50-0.64): a moderate reserve. Below LOW, no reserve is added at all - see COMMERCIAL_ESTIMATE_REQUIRES_CLARIFICATION instead. */
export const RISK_RESERVE_MEDIUM_CONFIDENCE_FRACTION = 0.05;
export const RISK_RESERVE_LOW_CONFIDENCE_FRACTION = 0.15;

// ---------------------------------------------------------------------------
// Commercial DU guardrail - a TECHNICAL bound only (like
// RELATIVE_EFFORT_FACTOR_GUARDRAIL_* in domain/technology.ts), never a
// claimed real-world range. With the asymmetric effort model above, every
// adjustment this engine computes is >= 0, so Commercial DU is structurally
// floored at Base DU (see scoring/commercialEngine.ts) BEFORE this
// guardrail is even considered - COMMERCIAL_DU_GUARDRAIL_MIN_FRACTION is
// kept only as a defensive absolute bound for a future adjustment source
// that might legitimately reduce it.
// ---------------------------------------------------------------------------

export const COMMERCIAL_DU_GUARDRAIL_MIN_FRACTION = 0.7;
export const COMMERCIAL_DU_GUARDRAIL_MAX_FRACTION = 2.5;
