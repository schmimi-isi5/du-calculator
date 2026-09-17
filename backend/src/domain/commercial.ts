// Commercial Model (E) - Base DU (domain/duEngine.ts) describes technical
// scope/complexity/risk; Commercial DU is the actual commercial unit
// offered to the customer, informed by Base DU plus everything Base DU
// deliberately does NOT capture: the AI-native effort estimate, direct
// costs, innovation content, and commercial risk. See
// scoring/commercialEngine.ts for the actual calculation.
//
// Every constant here is CALIBRATION_STATUS = "INITIAL_HYPOTHESIS" - a
// documented, reviewable starting point, not an empirically validated
// figure. They live in exactly this one file so they can be recalibrated
// later against real ISIFIVE outcomes (store/ActualEffortStore.ts) without
// hunting through the engine's logic.

export const CALIBRATION_STATUS = "INITIAL_HYPOTHESIS" as const;

/**
 * Reference only - "if Base DU were priced at this many hours/DU, would the
 * AI-native effort estimate roughly match?" NOT a hard conversion (the
 * commercial-du-v1 spec explicitly forbids commercialDU = hours / constant).
 * Used only to detect and dampen a DEVIATION signal, never to compute
 * Commercial DU directly from hours.
 */
export const COMMERCIAL_REFERENCE_HOURS_PER_DU = 6;

/** How strongly a deviation between actual effort and the hours-per-DU reference moves Commercial DU, and how far it may ever move it. */
export const EFFORT_ADJUSTMENT_WEIGHT = 0.5;
export const MAX_EFFORT_ADJUSTMENT_FRACTION = 0.5;

/** How much one-time direct development cost "counts as" one full Base DU of extra commercial value - only ONE_TIME_DEVELOPMENT-type costs feed this; RECURRING_RUNTIME costs are disclosed separately, never folded into Commercial DU. */
export const COST_PER_DU_REFERENCE_EUR = 500;
export const COST_ADJUSTMENT_WEIGHT = 1.0;

/** Proportional Commercial DU bonus for MEDIUM/HIGH innovation content - LOW adds nothing. */
export const INNOVATION_MEDIUM_BONUS_FRACTION = 0.1;
export const INNOVATION_HIGH_BONUS_FRACTION = 0.25;

/**
 * Commercial risk reserve applies ONLY when effort confidence is below this
 * threshold - i.e. only for genuine estimation uncertainty not already
 * priced into Base DU's own uncertaintyRisk dimension (technical risk) or
 * reflected in effort confidence itself (estimation uncertainty). This is
 * the guard against double-counting risk (spec section 19).
 */
export const RISK_RESERVE_CONFIDENCE_THRESHOLD = 0.65;
export const COMMERCIAL_RISK_RESERVE_FRACTION = 0.15;

/**
 * Technical guardrail only (like RELATIVE_EFFORT_FACTOR_GUARDRAIL_* in
 * domain/technology.ts) - catches a runaway combination of adjustments, not
 * a claimed real-world bound on how far Commercial DU may reasonably differ
 * from Base DU.
 */
export const COMMERCIAL_DU_GUARDRAIL_MIN_FRACTION = 0.7;
export const COMMERCIAL_DU_GUARDRAIL_MAX_FRACTION = 2.5;
