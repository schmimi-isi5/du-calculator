// Commercial Model (D) - deterministic, fully unit-tested, no LLM calls.
// Answers: "is the technical scope expressed by Base DU still commercially
// plausible once we account for the actual expected production effort,
// direct costs, innovation content, and remaining risk?" NOT a time
// conversion - `commercialDU = hours / constant` is explicitly forbidden by
// the spec this implements, because it would silently reintroduce a fixed
// DU-to-hours rate through the back door. Instead, effort/cost/innovation/
// risk each contribute a small, capped, independently-reasoned adjustment
// on top of Base DU - see domain/commercial.ts for every constant used
// here, all explicitly marked CALIBRATION_STATUS = "INITIAL_HYPOTHESIS".

import {
  COMMERCIAL_DU_GUARDRAIL_MAX_FRACTION,
  COMMERCIAL_DU_GUARDRAIL_MIN_FRACTION,
  COMMERCIAL_REFERENCE_HOURS_PER_DU,
  COMMERCIAL_RISK_RESERVE_FRACTION,
  COST_ADJUSTMENT_WEIGHT,
  COST_PER_DU_REFERENCE_EUR,
  EFFORT_ADJUSTMENT_WEIGHT,
  INNOVATION_HIGH_BONUS_FRACTION,
  INNOVATION_MEDIUM_BONUS_FRACTION,
  MAX_EFFORT_ADJUSTMENT_FRACTION,
  RISK_RESERVE_CONFIDENCE_THRESHOLD,
  CALIBRATION_STATUS,
} from "../domain/commercial.js";
import type {
  CommercialAdjustment,
  CommercialCalculation,
  DirectCostEstimate,
  DirectCostItem,
  EffortEstimate,
  InnovationAssessment,
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

function innovationBonusFraction(level: InnovationAssessment["level"]): number {
  if (level === "HIGH") return INNOVATION_HIGH_BONUS_FRACTION;
  if (level === "MEDIUM") return INNOVATION_MEDIUM_BONUS_FRACTION;
  return 0;
}

export interface CommercialEngineInput {
  baseDU: number | null;
  aiNativeEffort: EffortEstimate;
  directCosts: DirectCostEstimate;
  innovation: InnovationAssessment;
}

/**
 * Base DU adjusted for effort deviation, direct development costs,
 * innovation content, and a risk reserve gated on effort confidence (never
 * a blanket markup, to avoid double-counting the technical risk already
 * inside Base DU's own uncertaintyRisk dimension - spec section 19). Every
 * adjustment is dampened and guardrail-clamped; none of them alone can move
 * Commercial DU arbitrarily far from Base DU.
 */
export function computeCommercialCalculation(input: CommercialEngineInput): CommercialCalculation {
  const { baseDU, aiNativeEffort, directCosts, innovation } = input;

  if (baseDU === null) {
    return {
      baseDU: null,
      suggestedCommercialDU: null,
      commercialDUConfidence: 0,
      targetCommercialValue: null,
      rationale: "Base DU ist bei XXL nicht gesetzt (Zerlegung erforderlich) - Commercial DU kann daraus nicht abgeleitet werden.",
      adjustments: [],
      calibrationStatus: CALIBRATION_STATUS,
    };
  }

  const adjustments: CommercialAdjustment[] = [];

  // 1) Effort-consistency adjustment - a SIGNAL, not a conversion: how far
  // does the AI-native likely-hours estimate deviate from what Base DU
  // would "typically" imply at a reference hours-per-DU rate, dampened by
  // EFFORT_ADJUSTMENT_WEIGHT and capped at ±MAX_EFFORT_ADJUSTMENT_FRACTION
  // of Base DU either way.
  const expectedHours = baseDU * COMMERCIAL_REFERENCE_HOURS_PER_DU;
  const effortRatio = expectedHours > 0 ? aiNativeEffort.likelyHours / expectedHours : 1;
  const effortAdjustmentFraction = clamp(
    (effortRatio - 1) * EFFORT_ADJUSTMENT_WEIGHT,
    -MAX_EFFORT_ADJUSTMENT_FRACTION,
    MAX_EFFORT_ADJUSTMENT_FRACTION,
  );
  const effortAdjustmentDU = baseDU * effortAdjustmentFraction;
  adjustments.push({
    label: "AI-native Aufwand",
    deltaDU: round2(effortAdjustmentDU),
    reason:
      effortAdjustmentDU === 0
        ? `Geschätzter Aufwand (${aiNativeEffort.likelyHours}h) entspricht etwa der Referenz von ${COMMERCIAL_REFERENCE_HOURS_PER_DU}h/DU - keine Anpassung.`
        : `Geschätzter Aufwand (${aiNativeEffort.likelyHours}h) weicht von der Referenz (${expectedHours.toFixed(0)}h bei ${COMMERCIAL_REFERENCE_HOURS_PER_DU}h/DU) ab - gedämpfte, gedeckelte Anpassung, keine direkte Umrechnung.`,
  });

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

  // 3) Innovation adjustment - proportional bonus, never a proxy for "uses AI = expensive".
  const innovationFraction = innovationBonusFraction(innovation.level);
  const innovationAdjustmentDU = baseDU * innovationFraction;
  adjustments.push({
    label: "Innovationsanteil",
    deltaDU: round2(innovationAdjustmentDU),
    reason: `Innovationsgrad ${innovation.level}: ${innovation.rationale}`,
  });

  // 4) Commercial risk reserve - gated on effort confidence, so it only
  // fires for genuine estimation uncertainty not already reflected in Base
  // DU's uncertaintyRisk dimension or in effort confidence itself.
  const riskReserveApplies = aiNativeEffort.confidence < RISK_RESERVE_CONFIDENCE_THRESHOLD;
  const riskAdjustmentDU = riskReserveApplies ? baseDU * COMMERCIAL_RISK_RESERVE_FRACTION : 0;
  adjustments.push({
    label: "Kaufmännische Risikoreserve",
    deltaDU: round2(riskAdjustmentDU),
    reason: riskReserveApplies
      ? `Effort Confidence (${Math.round(aiNativeEffort.confidence * 100)}%) liegt unter dem Schwellenwert (${Math.round(
          RISK_RESERVE_CONFIDENCE_THRESHOLD * 100,
        )}%) - kaufmännischer Risikoaufschlag für die verbleibende Schätzunsicherheit (kein Doppelzählen des bereits in Base DU enthaltenen technischen Risikos).`
      : "Effort Confidence ausreichend hoch - kein zusätzlicher kommerzieller Risikoaufschlag notwendig.",
  });

  const rawAdjustedDU = baseDU + effortAdjustmentDU + costAdjustmentDU + innovationAdjustmentDU + riskAdjustmentDU;
  const guardrailMin = baseDU * COMMERCIAL_DU_GUARDRAIL_MIN_FRACTION;
  const guardrailMax = baseDU * COMMERCIAL_DU_GUARDRAIL_MAX_FRACTION;
  const suggestedCommercialDU = round1(clamp(rawAdjustedDU, guardrailMin, guardrailMax));

  const commercialDUConfidence = round2(
    aiNativeEffort.confidence * innovation.confidence * (hasUnknownCost(directCosts) ? 0.85 : 1),
  );

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
  };
}
