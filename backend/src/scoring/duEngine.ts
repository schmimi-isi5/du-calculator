// Deterministic DU Engine.
//
// This module NEVER calls an LLM. It takes the eight AI-provided dimension
// scores (1-5 each) and turns them into a weighted score, a DU class, a
// Development Unit count, and - optionally - a price. The AI analyzes and
// scores; this module is the only place that decides what those scores mean
// in DU terms.

import type { DimensionKey, DimensionScores, DuClass, DuResult, ScoringStatus } from "../domain/types.js";
import { DIMENSION_KEYS } from "../domain/types.js";

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
  { duClass: "XXL", minScore: 4.1, maxScore: Infinity, developmentUnits: null },
];

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
): { duClass: DuClass; developmentUnits: number | null } {
  for (const boundary of CLASS_BOUNDARIES) {
    if (weightedScore <= boundary.maxScore) {
      return { duClass: boundary.duClass, developmentUnits: boundary.developmentUnits };
    }
  }
  // Unreachable: the last boundary's maxScore is Infinity.
  const xxl = CLASS_BOUNDARIES[CLASS_BOUNDARIES.length - 1]!;
  return { duClass: xxl.duClass, developmentUnits: xxl.developmentUnits };
}

export function calculatePrice(
  developmentUnits: number | null,
  pricePerDU: number | null,
): number | null {
  if (developmentUnits === null || pricePerDU === null) return null;
  return round2(developmentUnits * pricePerDU);
}

/**
 * Combines the pure calculations above into the final DuResult. This does
 * NOT decide the ScoringResult.status (NEEDS_CLARIFICATION vs SCORED vs
 * DECOMPOSITION_REQUIRED) - that is an application-level concern based on
 * confidenceLevel and duClass, handled by the caller (see api/requirementRoutes.ts).
 */
export function computeDuResult(scores: DimensionScores, pricePerDU: number | null): DuResult {
  const weightedScore = calculateWeightedScore(scores);
  const { duClass, developmentUnits } = mapScoreToClass(weightedScore);
  const overallConfidence = calculateOverallConfidence(scores);
  const confidenceLevel = classifyConfidence(overallConfidence);
  const price = calculatePrice(developmentUnits, pricePerDU);

  return {
    weightedScore,
    duClass,
    developmentUnits,
    price,
    overallConfidence,
    confidenceLevel,
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
