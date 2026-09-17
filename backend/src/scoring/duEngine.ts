// Deterministic DU Engine.
//
// This module NEVER calls an LLM. It takes the eight AI-provided dimension
// scores (1-5 each) and turns them into a weighted score, a DU class, a
// Development Unit count, and - optionally - a price. The AI analyzes and
// scores; this module is the only place that decides what those scores mean
// in DU terms.

import type {
  DimensionKey,
  DimensionScores,
  DuClass,
  DuResult,
  ImplementationEstimate,
  ScoringStatus,
} from "../domain/types.js";
import { DIMENSION_KEYS } from "../domain/types.js";
import { estimateAlternativeApproaches, estimateTime } from "./effortEstimator.js";

/** Fixed dimension weights from the spec. Must sum to 1.00. */
export const DIMENSION_WEIGHTS: Record<DimensionKey, number> = {
  functionalScope: 0.2,
  technicalComplexity: 0.2,
  dataIntegration: 0.15,
  aiComplexity: 0.15,
  automation: 0.1,
  testingQA: 0.1,
  deploymentOperations: 0.05,
  uncertaintyRisk: 0.05,
};

/**
 * Ordered class boundaries: a weighted score qualifies for the first entry
 * whose `maxScore` it does not exceed. `minScore` is informational only -
 * the lower bound is implied by the previous entry's `maxScore`.
 */
interface ClassBoundary {
  duClass: DuClass;
  minScore: number;
  maxScore: number; // inclusive; Infinity for the open-ended top bucket
  developmentUnits: number | null;
}

export const CLASS_BOUNDARIES: ClassBoundary[] = [
  { duClass: "XS", minScore: 1.0, maxScore: 1.5, developmentUnits: 1 },
  { duClass: "S", minScore: 1.5, maxScore: 2.0, developmentUnits: 2 },
  { duClass: "M", minScore: 2.0, maxScore: 2.7, developmentUnits: 4 },
  { duClass: "L", minScore: 2.7, maxScore: 3.4, developmentUnits: 6 },
  { duClass: "XL", minScore: 3.4, maxScore: 4.1, developmentUnits: 10 },
  // XXL has no fixed table value - see estimateXXLDevelopmentUnits below,
  // which extrapolates a number instead of leaving this null. The class
  // boundaries above were never a single clean formula (the per-point
  // growth rate between steps varies: XS->S is steeper than M->L), so
  // rather than overfit a curve through all five points, XXL continues the
  // one most recent, most relevant growth rate - the L->XL step - forward
  // past the XL ceiling. This is always a rough, order-of-magnitude number:
  // decomposition is still recommended regardless (determineScoringStatus).
  { duClass: "XXL", minScore: 4.1, maxScore: Infinity, developmentUnits: null },
];

// The last real transition (L -> XL: 6 -> 10 DU over a 0.7-point score
// range) is the closest available precedent for "what comes after XL" -
// continuing it is a defensible extrapolation, not an arbitrary multiplier.
const XL_BOUNDARY = CLASS_BOUNDARIES[4]!;
const L_BOUNDARY = CLASS_BOUNDARIES[3]!;
const XXL_GROWTH_RATE_PER_SCORE_POINT = Math.pow(
  XL_BOUNDARY.developmentUnits! / L_BOUNDARY.developmentUnits!,
  1 / (XL_BOUNDARY.maxScore - L_BOUNDARY.maxScore),
);

/** A weighted score can theoretically reach 5.0 (every dimension scored 5) - the ceiling this extrapolation is ever evaluated up to. */
export const MAX_WEIGHTED_SCORE = 5.0;

/** Extrapolated DU estimate for a weighted score past the XL ceiling - always rounded, never exact, and always paired with isRoughEstimate: true by computeDuResult. */
export function estimateXXLDevelopmentUnits(weightedScore: number): number {
  const scoreAboveCeiling = Math.min(weightedScore, MAX_WEIGHTED_SCORE) - XL_BOUNDARY.maxScore;
  const raw = XL_BOUNDARY.developmentUnits! * Math.pow(XXL_GROWTH_RATE_PER_SCORE_POINT, scoreAboveCeiling);
  return Math.round(raw);
}

export const CONFIDENCE_THRESHOLDS = {
  high: 0.85,
  medium: 0.65,
} as const;

/** Round to 2 decimal places without floating-point drift (e.g. 2.0000000000004). */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateWeightedScore(scores: DimensionScores): number {
  const total = DIMENSION_KEYS.reduce(
    (sum, key) => sum + scores[key].score * DIMENSION_WEIGHTS[key],
    0,
  );
  return round2(total);
}

/**
 * Overall confidence is the same weighted combination as the score itself,
 * applied to each dimension's confidence. A dimension that carries more
 * weight in the DU outcome also carries more weight in how confident we are
 * overall - a low-confidence, low-weight dimension (e.g. deployment) should
 * not by itself drag a well-understood requirement into clarification.
 */
export function calculateOverallConfidence(scores: DimensionScores): number {
  const total = DIMENSION_KEYS.reduce(
    (sum, key) => sum + scores[key].confidence * DIMENSION_WEIGHTS[key],
    0,
  );
  return round2(total);
}

export function classifyConfidence(overallConfidence: number): "HIGH" | "MEDIUM" | "LOW" {
  if (overallConfidence >= CONFIDENCE_THRESHOLDS.high) return "HIGH";
  if (overallConfidence >= CONFIDENCE_THRESHOLDS.medium) return "MEDIUM";
  return "LOW";
}

export function mapScoreToClass(
  weightedScore: number,
): { duClass: DuClass; developmentUnits: number; isRoughEstimate: boolean } {
  for (const boundary of CLASS_BOUNDARIES) {
    if (weightedScore <= boundary.maxScore) {
      if (boundary.developmentUnits !== null) {
        return { duClass: boundary.duClass, developmentUnits: boundary.developmentUnits, isRoughEstimate: false };
      }
      return {
        duClass: boundary.duClass,
        developmentUnits: estimateXXLDevelopmentUnits(weightedScore),
        isRoughEstimate: true,
      };
    }
  }
  // Unreachable: the last boundary's maxScore is Infinity.
  return { duClass: "XXL", developmentUnits: estimateXXLDevelopmentUnits(weightedScore), isRoughEstimate: true };
}

/**
 * Price is derived from the time estimate, not set independently - DU price
 * = total estimated hours × the operator's billing rate per hour
 * (config.ts BILLING_RATE_PER_HOUR). This is a deliberate consistency
 * guarantee: a price set independently of the hours it takes to deliver
 * can silently drift below cost (this app's own PRICE_PER_DU default of
 * 300 for a 6-hour estimate implied ~50 €/h, far under a real billing
 * rate) - deriving it removes that possibility by construction.
 */
export function calculatePrice(totalHours: number | null, billingRatePerHour: number | null): number | null {
  if (totalHours === null || billingRatePerHour === null) return null;
  return round2(totalHours * billingRatePerHour);
}

/**
 * Combines the pure calculations above into the final DuResult. This does
 * NOT decide the ScoringResult.status (NEEDS_CLARIFICATION vs SCORED vs
 * DECOMPOSITION_REQUIRED) - that is an application-level concern based on
 * confidenceLevel and duClass, handled by the caller (see api/requirementRoutes.ts).
 */
export function computeDuResult(
  scores: DimensionScores,
  billingRatePerHour: number | null,
  hoursPerDU: number,
  implementationEstimate: ImplementationEstimate,
): DuResult {
  const weightedScore = calculateWeightedScore(scores);
  const { duClass, developmentUnits, isRoughEstimate } = mapScoreToClass(weightedScore);
  const overallConfidence = calculateOverallConfidence(scores);
  const confidenceLevel = classifyConfidence(overallConfidence);
  const timeEstimate = estimateTime(implementationEstimate, scores, developmentUnits, hoursPerDU);
  const price = calculatePrice(timeEstimate.totalHours, billingRatePerHour);
  const alternativeApproaches = estimateAlternativeApproaches(scores, timeEstimate);

  return {
    weightedScore,
    duClass,
    developmentUnits,
    price,
    overallConfidence,
    confidenceLevel,
    isRoughEstimate,
    timeEstimate,
    alternativeApproaches,
  };
}

/**
 * Decides the final ScoringStatus from the deterministic DuResult plus how
 * many assumptions the assessment relied on. Order matters: a LOW-confidence
 * result always needs clarification regardless of assumption count (a low
 * confidence must never be "fixed" by ignoring it), XXL always needs
 * decomposition, and otherwise the assessment is flagged
 * ASSESSMENT_WITH_ASSUMPTIONS whenever it leaned on at least one assumption
 * so the user can see - and challenge - what it rests on (spec section 15).
 * Assumptions are never allowed to change which of these buckets a result
 * falls into - only how it is labeled once the bucket is decided.
 */
export function determineScoringStatus(engineResult: DuResult, assumptionsUsedCount: number): ScoringStatus {
  if (engineResult.confidenceLevel === "LOW") return "NEEDS_CLARIFICATION";
  if (engineResult.duClass === "XXL") return "DECOMPOSITION_REQUIRED";
  return assumptionsUsedCount > 0 ? "ASSESSMENT_WITH_ASSUMPTIONS" : "SCORED";
}
