// Commercial Model (D) - deterministic, fully unit-tested, no LLM calls.
// Answers: "is the technical scope expressed by Base DU still commercially
// plausible once we account for the actual expected production effort
// (compared against a per-class benchmark, not a flat rate), direct costs,
// implementation novelty, and remaining risk?" NOT a time conversion -
// `commercialDU = hours / constant` is explicitly forbidden by the spec
// this implements. Effort/cost/novelty/risk each contribute a small,
// capped, independently-reasoned adjustment on top of Base DU - see
// domain/commercial.ts for every constant used here, all explicitly marked
// CALIBRATION_STATUS = "INITIAL_HYPOTHESIS".
//
// The effort adjustment is deliberately ASYMMETRIC: effort above its
// class's benchmark may raise Commercial DU, but effort below benchmark (an
// AI-native productivity gain) is surfaced transparently
// (effortAnalysis.productivityGain) without automatically lowering
// Commercial DU - see domain/commercial.ts NEGATIVE_EFFORT_ADJUSTMENT_ENABLED.
// Combined with every other adjustment also being >= 0, Commercial DU is
// structurally floored at Base DU by construction, not by an incidental
// guardrail - see the Base-DU floor below.

import {
  BASE_DU_EFFORT_BENCHMARKS,
  CALIBRATION_STATUS,
  COMMERCIAL_DU_GUARDRAIL_MAX_FRACTION,
  COMMERCIAL_DU_GUARDRAIL_MIN_FRACTION,
  COST_ADJUSTMENT_WEIGHT,
  COST_PER_DU_REFERENCE_EUR,
  EFFORT_ADJUSTMENT_WEIGHT,
  EFFORT_BENCHMARK_MODEL_VERSION,
  IMPLEMENTATION_NOVELTY_HIGH_BONUS_FRACTION,
  IMPLEMENTATION_NOVELTY_MEDIUM_BONUS_FRACTION,
  MAX_EFFORT_ADJUSTMENT_FRACTION,
  NEGATIVE_EFFORT_ADJUSTMENT_ENABLED,
  NEGATIVE_EFFORT_ADJUSTMENT_WEIGHT,
  RISK_CONFIDENCE_HIGH_THRESHOLD,
  RISK_CONFIDENCE_LOW_THRESHOLD,
  RISK_CONFIDENCE_MEDIUM_THRESHOLD,
  RISK_RESERVE_LOW_CONFIDENCE_FRACTION,
  RISK_RESERVE_MEDIUM_CONFIDENCE_FRACTION,
  type BaseDuClass,
  type EffortBenchmarkEntry,
} from "../domain/commercial.js";
import type {
  CommercialAdjustment,
  CommercialCalculation,
  CommercialEstimateStatus,
  DirectCostEstimate,
  DirectCostItem,
  EffortAnalysis,
  EffortBenchmarkInfo,
  EffortEstimate,
  EffortVariance,
  ImplementationNoveltyAssessment,
} from "../domain/types.js";

function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
function pct(value: number): number {
  return Math.round(value * 100);
}

/** Only ONE_TIME_DEVELOPMENT (or BOTH) cost items with a real estimate count - RECURRING_RUNTIME cost never inflates Commercial DU, it's disclosed to the customer separately. */
function sumOneTimeDevelopmentCost(directCosts: DirectCostEstimate): number {
  const items: DirectCostItem[] = [
    directCosts.aiApiCost,
    directCosts.infrastructureCost,
    directCosts.thirdPartyCost,
    directCosts.otherDirectCost,
  ];
  return items
    .filter((item) => item.status === "ESTIMATED" && (item.costType === "ONE_TIME_DEVELOPMENT" || item.costType === "BOTH"))
    .reduce((sum, item) => sum + (item.amountEur ?? 0), 0);
}

function hasUnknownCost(directCosts: DirectCostEstimate): boolean {
  return [directCosts.aiApiCost, directCosts.infrastructureCost, directCosts.thirdPartyCost, directCosts.otherDirectCost].some(
    (item) => item.status !== "ESTIMATED",
  );
}

function implementationNoveltyBonusFraction(level: ImplementationNoveltyAssessment["level"]): number {
  if (level === "HIGH") return IMPLEMENTATION_NOVELTY_HIGH_BONUS_FRACTION;
  if (level === "MEDIUM") return IMPLEMENTATION_NOVELTY_MEDIUM_BONUS_FRACTION;
  return 0;
}

/**
 * Compares AI-native likely-hours against this Base DU class's effort
 * benchmark and produces both the (signed) adjustment and the full
 * transparency breakdown (variance, productivity gain OR overrun - never
 * both). Positive variance may raise Commercial DU; negative variance
 * (a productivity gain) is reported but not automatically applied unless
 * NEGATIVE_EFFORT_ADJUSTMENT_ENABLED is turned on later.
 */
function analyzeEffort(
  baseDU: number,
  baseDuClass: BaseDuClass,
  aiNativeEffort: EffortEstimate,
  benchmarks: EffortBenchmarkTable,
): { adjustment: CommercialAdjustment; adjustmentDU: number; analysis: EffortAnalysis } {
  const entry = benchmarks[baseDuClass];
  const benchmark: EffortBenchmarkInfo = {
    class: baseDuClass,
    expectedLikelyHours: entry.expectedLikelyHours,
    calibrationStatus: entry.calibrationStatus,
    sampleSize: entry.sampleSize,
    modelVersion: EFFORT_BENCHMARK_MODEL_VERSION,
  };

  const varianceHours = aiNativeEffort.likelyHours - entry.expectedLikelyHours;
  const variancePercent = entry.expectedLikelyHours > 0 ? varianceHours / entry.expectedLikelyHours : 0;

  let adjustmentDU = 0;
  let productivityGain: EffortVariance | null = null;
  let positiveEffortOverrun: EffortVariance | null = null;
  let reason: string;

  if (varianceHours > 0) {
    const fraction = clamp(variancePercent * EFFORT_ADJUSTMENT_WEIGHT, 0, MAX_EFFORT_ADJUSTMENT_FRACTION);
    adjustmentDU = baseDU * fraction;
    positiveEffortOverrun = { hours: round1(varianceHours), percent: round2(variancePercent) };
    reason = `Predicted human effort (${aiNativeEffort.likelyHours}h) materially exceeds the current Base-DU-Klasse-${baseDuClass}-Benchmark (${entry.expectedLikelyHours}h) - gedämpfte, gedeckelte Anpassung, keine direkte Stunden-Umrechnung.`;
  } else if (varianceHours < 0) {
    productivityGain = { hours: round1(-varianceHours), percent: round2(-variancePercent) };
    if (NEGATIVE_EFFORT_ADJUSTMENT_ENABLED && NEGATIVE_EFFORT_ADJUSTMENT_WEIGHT > 0) {
      const fraction = -clamp(-variancePercent * NEGATIVE_EFFORT_ADJUSTMENT_WEIGHT, 0, MAX_EFFORT_ADJUSTMENT_FRACTION);
      adjustmentDU = baseDU * fraction;
      reason = `AI-native productivity gain (${productivityGain.hours}h, ${pct(productivityGain.percent)}%) is partially passed through as a Commercial DU reduction (configurable rate, currently enabled).`;
    } else {
      reason = `AI-native productivity gain is retained and does not automatically reduce Commercial DU (Gain: ${productivityGain.hours}h, ${pct(productivityGain.percent)}%).`;
    }
  } else {
    reason = `Predicted human effort matches the current Base-DU-Klasse-${baseDuClass}-Benchmark (${entry.expectedLikelyHours}h) - keine Anpassung.`;
  }

  return {
    adjustment: { label: "AI-native Aufwand vs. Effort Benchmark", deltaDU: round2(adjustmentDU), reason },
    adjustmentDU,
    analysis: {
      benchmark,
      predictedLikelyHours: aiNativeEffort.likelyHours,
      variance: { hours: round1(varianceHours), percent: round2(variancePercent) },
      productivityGain,
      positiveEffortOverrun,
    },
  };
}

export type EffortBenchmarkTable = Record<BaseDuClass, EffortBenchmarkEntry>;

export interface CommercialEngineInput {
  baseDU: number | null;
  /** null exactly when baseDU is null (XXL) - the class whose benchmark this requirement's effort is compared against. */
  baseDuClass: BaseDuClass | null;
  aiNativeEffort: EffortEstimate;
  directCosts: DirectCostEstimate;
  implementationNovelty: ImplementationNoveltyAssessment;
  /**
   * Defaults to the real BASE_DU_EFFORT_BENCHMARKS - overridable so the
   * benchmarks can later be recalibrated (or non-linearly reconfigured, or
   * swapped in tests) without any change to this engine's logic. Never
   * assume linearity between classes when reading this table.
   */
  benchmarks?: EffortBenchmarkTable;
}

/**
 * Base DU adjusted for effort deviation (vs. a per-class benchmark, never a
 * flat hours/DU rate), direct development costs, implementation novelty,
 * and a confidence-graduated risk reserve. Every adjustment is dampened
 * and/or capped; with the asymmetric effort model, none of them can ever be
 * negative, so Commercial DU is floored at Base DU by construction.
 */
export function computeCommercialCalculation(input: CommercialEngineInput): CommercialCalculation {
  const { baseDU, baseDuClass, aiNativeEffort, directCosts, implementationNovelty, benchmarks = BASE_DU_EFFORT_BENCHMARKS } = input;

  if (baseDU === null || baseDuClass === null) {
    return {
      baseDU: null,
      suggestedCommercialDU: null,
      commercialDUConfidence: 0,
      targetCommercialValue: null,
      rationale: "Base DU ist bei XXL nicht gesetzt (Zerlegung erforderlich) - Commercial DU kann daraus nicht abgeleitet werden.",
      adjustments: [],
      calibrationStatus: CALIBRATION_STATUS,
      effortAnalysis: null,
      commercialDUBeforeGuardrail: null,
      commercialDUAfterGuardrail: null,
      guardrailApplied: false,
      guardrailReason: null,
      estimateStatus: "OK",
    };
  }

  const adjustments: CommercialAdjustment[] = [];

  // 1) Effort benchmark comparison (asymmetric) - see analyzeEffort above.
  const effort = analyzeEffort(baseDU, baseDuClass, aiNativeEffort, benchmarks);
  adjustments.push(effort.adjustment);

  // 2) Direct one-time development cost adjustment.
  const oneTimeCost = sumOneTimeDevelopmentCost(directCosts);
  const costAdjustmentDU = (oneTimeCost / COST_PER_DU_REFERENCE_EUR) * COST_ADJUSTMENT_WEIGHT;
  adjustments.push({
    label: "Direkte Entwicklungskosten",
    deltaDU: round2(costAdjustmentDU),
    reason:
      oneTimeCost > 0
        ? `${oneTimeCost.toFixed(0)}€ geschätzte einmalige direkte Entwicklungskosten (AI/API, Infrastruktur, Third-Party).`
        : "Keine wesentlichen einmaligen direkten Entwicklungskosten identifiziert.",
  });

  // 3) Implementation novelty adjustment - proportional bonus, never a proxy
  // for "uses AI = expensive". Reusable Innovation/IP deliberately does NOT
  // feed this engine at all - see domain/types.ts ReusableInnovationAssessment.
  const noveltyFraction = implementationNoveltyBonusFraction(implementationNovelty.level);
  const noveltyAdjustmentDU = baseDU * noveltyFraction;
  adjustments.push({
    label: "Implementation Novelty",
    deltaDU: round2(noveltyAdjustmentDU),
    reason: `Implementation Novelty ${implementationNovelty.level}: ${implementationNovelty.rationale}`,
  });

  // 4) Commercial risk reserve - graduated by effort confidence, not a
  // single binary threshold (spec section 18). Very low confidence does NOT
  // get a markup - it gets flagged for clarification instead (section 19:
  // no false confidence through a risk surcharge).
  const confidence = aiNativeEffort.confidence;
  let riskAdjustmentDU = 0;
  let riskReason: string;
  let estimateStatus: CommercialEstimateStatus = "OK";
  if (confidence >= RISK_CONFIDENCE_HIGH_THRESHOLD) {
    riskReason = `Effort Confidence (${pct(confidence)}%) ist hoch - keine kaufmännische Risikoreserve notwendig.`;
  } else if (confidence >= RISK_CONFIDENCE_MEDIUM_THRESHOLD) {
    riskAdjustmentDU = baseDU * RISK_RESERVE_MEDIUM_CONFIDENCE_FRACTION;
    riskReason = `Effort Confidence (${pct(confidence)}%) ist mittel - geringe kaufmännische Risikoreserve.`;
  } else if (confidence >= RISK_CONFIDENCE_LOW_THRESHOLD) {
    riskAdjustmentDU = baseDU * RISK_RESERVE_LOW_CONFIDENCE_FRACTION;
    riskReason = `Effort Confidence (${pct(confidence)}%) ist niedrig - moderate kaufmännische Risikoreserve.`;
  } else {
    riskReason = `Effort Confidence (${pct(confidence)}%) ist sehr niedrig - kein automatischer Risikoaufschlag. Die Anforderung sollte zunächst besser verstanden oder zerlegt werden (Discovery), statt Unsicherheit mit einem Aufschlag zu überdecken.`;
    estimateStatus = "REQUIRES_CLARIFICATION";
  }
  adjustments.push({ label: "Kaufmännische Risikoreserve", deltaDU: round2(riskAdjustmentDU), reason: riskReason });

  // Floor at Base DU: every adjustment above is currently >= 0 (the
  // effort adjustment is 0 whenever it would otherwise be negative, since
  // NEGATIVE_EFFORT_ADJUSTMENT_ENABLED defaults to false), so this floor
  // makes "Commercial DU never falls below Base DU without a deliberate
  // future adjustment source" an explicit invariant rather than an
  // incidental one.
  const rawAdjustedDU = baseDU + effort.adjustmentDU + costAdjustmentDU + noveltyAdjustmentDU + riskAdjustmentDU;
  const flooredAtBaseDU = Math.max(rawAdjustedDU, baseDU);
  const commercialDUBeforeGuardrail = round1(flooredAtBaseDU);

  const guardrailMin = baseDU * COMMERCIAL_DU_GUARDRAIL_MIN_FRACTION;
  const guardrailMax = baseDU * COMMERCIAL_DU_GUARDRAIL_MAX_FRACTION;
  const commercialDUAfterGuardrail = round1(clamp(flooredAtBaseDU, guardrailMin, guardrailMax));
  const guardrailApplied = commercialDUAfterGuardrail !== commercialDUBeforeGuardrail;
  const guardrailReason = guardrailApplied
    ? `Commercial DU vor der technischen Begrenzung (${commercialDUBeforeGuardrail}) lag außerhalb von [${guardrailMin.toFixed(1)}, ${guardrailMax.toFixed(1)}] - auf ${commercialDUAfterGuardrail} begrenzt. Rein technische Absicherung, kein fachlicher Wertebereich.`
    : null;

  const suggestedCommercialDU = commercialDUAfterGuardrail;
  const commercialDUConfidence = round2(confidence * implementationNovelty.confidence * (hasUnknownCost(directCosts) ? 0.85 : 1));

  return {
    baseDU,
    suggestedCommercialDU,
    commercialDUConfidence,
    // Left null here - the caller (duEngine.ts) fills this in once it knows
    // whether a price-per-DU is actually configured, since this preview
    // figure should only ever be shown when that's the case.
    targetCommercialValue: null,
    rationale: `Base DU (${baseDU}) angepasst um Aufwand-, Kosten-, Innovations- und Risikofaktoren auf ${suggestedCommercialDU} Commercial DU vorgeschlagen.`,
    adjustments,
    calibrationStatus: CALIBRATION_STATUS,
    effortAnalysis: effort.analysis,
    commercialDUBeforeGuardrail,
    commercialDUAfterGuardrail,
    guardrailApplied,
    guardrailReason,
    estimateStatus,
  };
}
