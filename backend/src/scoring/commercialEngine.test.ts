import { describe, expect, it } from "vitest";
import { COMMERCIAL_DU_GUARDRAIL_MAX_FRACTION, COMMERCIAL_DU_GUARDRAIL_MIN_FRACTION } from "../domain/commercial.js";
import { computeCommercialCalculation } from "./commercialEngine.js";
import { buildDirectCostEstimate, buildEffortEstimate, buildEstimatedCostItem, buildInnovationAssessment } from "./testFixtures.js";

const BASE_DU = 6;

describe("computeCommercialCalculation", () => {
  it("returns null suggestedCommercialDU/baseDU when baseDU is null (XXL)", () => {
    const result = computeCommercialCalculation({
      baseDU: null,
      aiNativeEffort: buildEffortEstimate(30, 36, 42),
      directCosts: buildDirectCostEstimate(),
      innovation: buildInnovationAssessment("LOW"),
    });
    expect(result.baseDU).toBeNull();
    expect(result.suggestedCommercialDU).toBeNull();
    expect(result.targetCommercialValue).toBeNull();
    expect(result.calibrationStatus).toBe("INITIAL_HYPOTHESIS");
  });

  it("keeps Commercial DU close to Base DU when effort matches the reference and cost/innovation/risk are all low", () => {
    const result = computeCommercialCalculation({
      baseDU: BASE_DU,
      aiNativeEffort: buildEffortEstimate(30, 36, 42, 0.9), // 36h == 6 DU * 6h/DU reference, exactly
      directCosts: buildDirectCostEstimate(),
      innovation: buildInnovationAssessment("LOW"),
    });
    expect(result.suggestedCommercialDU).toBeCloseTo(BASE_DU, 1);
  });

  describe("Test F - two requirements with the same Base DU but different effort/cost/innovation get different Commercial DU", () => {
    it("suggests a higher Commercial DU for the case with higher effort, higher direct costs, and higher innovation", () => {
      const low = computeCommercialCalculation({
        baseDU: BASE_DU,
        aiNativeEffort: buildEffortEstimate(28, 34, 40, 0.9),
        directCosts: buildDirectCostEstimate(),
        innovation: buildInnovationAssessment("LOW", 0.9),
      });

      const high = computeCommercialCalculation({
        baseDU: BASE_DU,
        aiNativeEffort: buildEffortEstimate(60, 80, 100, 0.9),
        directCosts: buildDirectCostEstimate({
          aiApiCost: buildEstimatedCostItem(400),
          infrastructureCost: buildEstimatedCostItem(300),
        }),
        innovation: buildInnovationAssessment("HIGH", 0.8),
      });

      expect(high.suggestedCommercialDU!).toBeGreaterThan(low.suggestedCommercialDU!);
    });
  });

  describe("Test G - no time conversion", () => {
    it("never computes Commercial DU as a direct hours / constant division", () => {
      // If Commercial DU were simply hours / 6 (the old, forbidden formula),
      // doubling the hours would exactly double Commercial DU. The dampened,
      // capped adjustment must NOT do that.
      const baseline = computeCommercialCalculation({
        baseDU: BASE_DU,
        aiNativeEffort: buildEffortEstimate(30, 36, 42, 0.9),
        directCosts: buildDirectCostEstimate(),
        innovation: buildInnovationAssessment("LOW"),
      });
      const doubledHours = computeCommercialCalculation({
        baseDU: BASE_DU,
        aiNativeEffort: buildEffortEstimate(60, 72, 84, 0.9),
        directCosts: buildDirectCostEstimate(),
        innovation: buildInnovationAssessment("LOW"),
      });

      const naiveDoubled = (baseline.suggestedCommercialDU! / BASE_DU) * 2 * BASE_DU;
      expect(doubledHours.suggestedCommercialDU!).toBeLessThan(naiveDoubled);
    });

    it("caps the effort-driven adjustment - two sufficiently large deviations produce the SAME Commercial DU instead of scaling proportionally with hours", () => {
      // Both ratios (80/36 ≈ 2.2x and 1000/36 ≈ 27.8x reference) already
      // exceed where EFFORT_ADJUSTMENT_WEIGHT * (ratio - 1) hits the
      // MAX_EFFORT_ADJUSTMENT_FRACTION cap - a naive hours/constant formula
      // would give these two wildly different Commercial DU values.
      const large = computeCommercialCalculation({
        baseDU: BASE_DU,
        aiNativeEffort: buildEffortEstimate(65, 80, 95, 0.9),
        directCosts: buildDirectCostEstimate(),
        innovation: buildInnovationAssessment("LOW"),
      });
      const extreme = computeCommercialCalculation({
        baseDU: BASE_DU,
        aiNativeEffort: buildEffortEstimate(800, 1000, 1200, 0.9),
        directCosts: buildDirectCostEstimate(),
        innovation: buildInnovationAssessment("LOW"),
      });

      expect(extreme.suggestedCommercialDU).toBe(large.suggestedCommercialDU);
    });

    it("stays within the technical guardrail range around Base DU", () => {
      const result = computeCommercialCalculation({
        baseDU: BASE_DU,
        aiNativeEffort: buildEffortEstimate(2000, 3000, 4000, 0.3),
        directCosts: buildDirectCostEstimate({
          aiApiCost: buildEstimatedCostItem(50000),
        }),
        innovation: buildInnovationAssessment("HIGH", 0.3),
      });
      expect(result.suggestedCommercialDU!).toBeGreaterThanOrEqual(BASE_DU * COMMERCIAL_DU_GUARDRAIL_MIN_FRACTION);
      expect(result.suggestedCommercialDU!).toBeLessThanOrEqual(BASE_DU * COMMERCIAL_DU_GUARDRAIL_MAX_FRACTION);
    });
  });

  describe("risk reserve - avoiding double counting (spec section 19)", () => {
    it("applies a risk reserve only when effort confidence is below the threshold", () => {
      const confident = computeCommercialCalculation({
        baseDU: BASE_DU,
        aiNativeEffort: buildEffortEstimate(30, 36, 42, 0.9),
        directCosts: buildDirectCostEstimate(),
        innovation: buildInnovationAssessment("LOW"),
      });
      const uncertain = computeCommercialCalculation({
        baseDU: BASE_DU,
        aiNativeEffort: buildEffortEstimate(30, 36, 42, 0.4),
        directCosts: buildDirectCostEstimate(),
        innovation: buildInnovationAssessment("LOW"),
      });

      const confidentRisk = confident.adjustments.find((a) => a.label === "Kaufmännische Risikoreserve")!;
      const uncertainRisk = uncertain.adjustments.find((a) => a.label === "Kaufmännische Risikoreserve")!;
      expect(confidentRisk.deltaDU).toBe(0);
      expect(uncertainRisk.deltaDU).toBeGreaterThan(0);
    });
  });

  it("always reports every adjustment category, even when its deltaDU is 0 - never silently omitted", () => {
    const result = computeCommercialCalculation({
      baseDU: BASE_DU,
      aiNativeEffort: buildEffortEstimate(30, 36, 42, 0.9),
      directCosts: buildDirectCostEstimate(),
      innovation: buildInnovationAssessment("LOW"),
    });
    const labels = result.adjustments.map((a) => a.label);
    expect(labels).toEqual([
      "AI-native Aufwand",
      "Direkte Entwicklungskosten",
      "Innovationsanteil",
      "Kaufmännische Risikoreserve",
    ]);
  });

  it("ignores RECURRING_RUNTIME-only direct costs - they never inflate Commercial DU", () => {
    const withoutRuntimeCost = computeCommercialCalculation({
      baseDU: BASE_DU,
      aiNativeEffort: buildEffortEstimate(30, 36, 42, 0.9),
      directCosts: buildDirectCostEstimate(),
      innovation: buildInnovationAssessment("LOW"),
    });
    const withRuntimeCost = computeCommercialCalculation({
      baseDU: BASE_DU,
      aiNativeEffort: buildEffortEstimate(30, 36, 42, 0.9),
      directCosts: buildDirectCostEstimate({
        aiApiCost: buildEstimatedCostItem(10000, "RECURRING_RUNTIME"),
      }),
      innovation: buildInnovationAssessment("LOW"),
    });
    expect(withRuntimeCost.suggestedCommercialDU).toBe(withoutRuntimeCost.suggestedCommercialDU);
  });
});
