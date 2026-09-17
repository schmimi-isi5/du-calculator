import { describe, expect, it } from "vitest";
import {
  BASE_DU_EFFORT_BENCHMARKS,
  COMMERCIAL_DU_GUARDRAIL_MAX_FRACTION,
  COMMERCIAL_DU_GUARDRAIL_MIN_FRACTION,
} from "../domain/commercial.js";
import { computeCommercialCalculation, type EffortBenchmarkTable } from "./commercialEngine.js";
import {
  buildDirectCostEstimate,
  buildEffortEstimate,
  buildEstimatedCostItem,
  buildImplementationNoveltyAssessment,
  buildReusableInnovationAssessment,
} from "./testFixtures.js";

function baseInput(overrides: Partial<Parameters<typeof computeCommercialCalculation>[0]> = {}) {
  return {
    baseDU: 4,
    baseDuClass: "M" as const,
    aiNativeEffort: buildEffortEstimate(20, 24, 30, 0.9),
    directCosts: buildDirectCostEstimate(),
    implementationNovelty: buildImplementationNoveltyAssessment("LOW"),
    ...overrides,
  };
}

describe("computeCommercialCalculation", () => {
  it("returns null suggestedCommercialDU/baseDU when baseDU/baseDuClass is null (XXL)", () => {
    const result = computeCommercialCalculation(baseInput({ baseDU: null, baseDuClass: null }));
    expect(result.baseDU).toBeNull();
    expect(result.suggestedCommercialDU).toBeNull();
    expect(result.effortAnalysis).toBeNull();
    expect(result.calibrationStatus).toBe("INITIAL_HYPOTHESIS");
  });

  describe("Test A - the benchmark is not a Development Unit definition", () => {
    it("never computes commercialDU as hours / 6, even when that would coincidentally look plausible", () => {
      // Base DU = 4 (M), benchmark = 24h. A naive "hours / 6" formula would
      // give 40/6 ≈ 6.67 DU here - the actual engine must NOT match that.
      const result = computeCommercialCalculation(baseInput({ aiNativeEffort: buildEffortEstimate(30, 40, 50, 0.9) }));
      const naiveHoursOverSix = 40 / 6;
      expect(result.suggestedCommercialDU).not.toBeCloseTo(naiveHoursOverSix, 1);
    });

    it("compares effort against the class benchmark, not against baseDU * a fixed constant computed inline", () => {
      // Confirm the benchmark value used is exactly BASE_DU_EFFORT_BENCHMARKS.M,
      // not some other hardcoded per-DU rate.
      const result = computeCommercialCalculation(baseInput({ aiNativeEffort: buildEffortEstimate(20, 24, 30, 0.9) }));
      expect(result.effortAnalysis!.benchmark.expectedLikelyHours).toBe(BASE_DU_EFFORT_BENCHMARKS.M.expectedLikelyHours);
      expect(result.effortAnalysis!.benchmark.class).toBe("M");
      expect(result.effortAnalysis!.benchmark.calibrationStatus).toBe("INITIAL_HYPOTHESIS");
    });
  });

  describe("Test B - higher effort than benchmark", () => {
    it("allows a positive effort adjustment when likely effort materially exceeds the benchmark", () => {
      // Base DU = 4 (M), benchmark = 24h, predicted likely = 40h.
      const result = computeCommercialCalculation(baseInput({ aiNativeEffort: buildEffortEstimate(30, 40, 50, 0.9) }));
      const effortAdjustment = result.adjustments.find((a) => a.label === "AI-native Aufwand vs. Effort Benchmark")!;
      expect(effortAdjustment.deltaDU).toBeGreaterThan(0);
      expect(result.effortAnalysis!.positiveEffortOverrun).not.toBeNull();
      expect(result.effortAnalysis!.productivityGain).toBeNull();
      expect(result.suggestedCommercialDU!).toBeGreaterThan(4);
    });
  });

  describe("Test C - productivity gain is surfaced but not automatically applied", () => {
    it("computes productivityGainHours=36 / productivityGainPercent=60% for Base DU=10 (XL, benchmark 60h) at 24h likely, without reducing Commercial DU below Base DU", () => {
      const result = computeCommercialCalculation(
        baseInput({ baseDU: 10, baseDuClass: "XL", aiNativeEffort: buildEffortEstimate(18, 24, 34, 0.9) }),
      );
      expect(result.effortAnalysis!.productivityGain).toEqual({ hours: 36, percent: 0.6 });
      expect(result.effortAnalysis!.positiveEffortOverrun).toBeNull();

      const effortAdjustment = result.adjustments.find((a) => a.label === "AI-native Aufwand vs. Effort Benchmark")!;
      expect(effortAdjustment.deltaDU).toBe(0);
      expect(result.suggestedCommercialDU!).toBeGreaterThanOrEqual(10);
    });
  });

  describe("Test D - non-linear benchmark configuration", () => {
    it("uses an overridden, non-linear benchmark table instead of assuming baseDU * 6", () => {
      const customBenchmarks: EffortBenchmarkTable = {
        ...BASE_DU_EFFORT_BENCHMARKS,
        M: { baseDU: 4, expectedLikelyHours: 15, calibrationStatus: "EMPIRICALLY_CALIBRATED", sampleSize: 12 },
      };
      const result = computeCommercialCalculation(
        baseInput({ aiNativeEffort: buildEffortEstimate(12, 15, 18, 0.9), benchmarks: customBenchmarks }),
      );
      expect(result.effortAnalysis!.benchmark.expectedLikelyHours).toBe(15);
      expect(result.effortAnalysis!.benchmark.expectedLikelyHours).not.toBe(4 * 6);
      expect(result.effortAnalysis!.benchmark.calibrationStatus).toBe("EMPIRICALLY_CALIBRATED");
      expect(result.effortAnalysis!.benchmark.sampleSize).toBe(12);
      // Effort matches the custom benchmark exactly - no adjustment.
      expect(result.adjustments.find((a) => a.label === "AI-native Aufwand vs. Effort Benchmark")!.deltaDU).toBe(0);
    });
  });

  describe("Test E - reusable innovation/IP", () => {
    it("is captured by the caller but produces no automatic Commercial DU adjustment from this engine", () => {
      // reusableInnovationIp deliberately never reaches CommercialEngineInput -
      // see duEngine.ts, which attaches it directly to DuResult instead.
      const withoutIt = computeCommercialCalculation(baseInput());
      const labels = withoutIt.adjustments.map((a) => a.label);
      expect(labels).not.toContain("Reusable Innovation");
      expect(labels).not.toContain("Reusable IP");
      // Sanity: reusable innovation fixture builder exists and is usable by
      // callers (duEngine.test.ts covers the actual passthrough onto DuResult).
      expect(buildReusableInnovationAssessment("HIGH").level).toBe("HIGH");
    });
  });

  describe("Test F - implementation novelty", () => {
    it("applies the configured MEDIUM bonus and reports INITIAL_HYPOTHESIS", () => {
      const low = computeCommercialCalculation(baseInput({ implementationNovelty: buildImplementationNoveltyAssessment("LOW") }));
      const medium = computeCommercialCalculation(baseInput({ implementationNovelty: buildImplementationNoveltyAssessment("MEDIUM") }));
      expect(medium.suggestedCommercialDU!).toBeGreaterThan(low.suggestedCommercialDU!);
      expect(medium.calibrationStatus).toBe("INITIAL_HYPOTHESIS");
    });
  });

  describe("Test G - very low confidence triggers clarification, not a blind markup", () => {
    it("sets estimateStatus to REQUIRES_CLARIFICATION and does not apply a large automatic risk reserve", () => {
      const result = computeCommercialCalculation(baseInput({ aiNativeEffort: buildEffortEstimate(15, 24, 35, 0.42) }));
      expect(result.estimateStatus).toBe("REQUIRES_CLARIFICATION");
      const riskAdjustment = result.adjustments.find((a) => a.label === "Kaufmännische Risikoreserve")!;
      expect(riskAdjustment.deltaDU).toBe(0);
    });

    it("applies a graduated reserve (not REQUIRES_CLARIFICATION) at LOW and MEDIUM confidence tiers, and none at HIGH", () => {
      const high = computeCommercialCalculation(baseInput({ aiNativeEffort: buildEffortEstimate(20, 24, 30, 0.85) }));
      const medium = computeCommercialCalculation(baseInput({ aiNativeEffort: buildEffortEstimate(20, 24, 30, 0.7) }));
      const low = computeCommercialCalculation(baseInput({ aiNativeEffort: buildEffortEstimate(20, 24, 30, 0.55) }));

      expect(high.estimateStatus).toBe("OK");
      expect(high.adjustments.find((a) => a.label === "Kaufmännische Risikoreserve")!.deltaDU).toBe(0);

      expect(medium.estimateStatus).toBe("OK");
      const mediumReserve = medium.adjustments.find((a) => a.label === "Kaufmännische Risikoreserve")!.deltaDU;
      expect(mediumReserve).toBeGreaterThan(0);

      expect(low.estimateStatus).toBe("OK");
      const lowReserve = low.adjustments.find((a) => a.label === "Kaufmännische Risikoreserve")!.deltaDU;
      expect(lowReserve).toBeGreaterThan(mediumReserve);
    });
  });

  describe("Test H - guardrail transparency", () => {
    it("reports commercialDUBeforeGuardrail/AfterGuardrail and guardrailApplied when the technical cap is hit", () => {
      const result = computeCommercialCalculation(
        baseInput({
          aiNativeEffort: buildEffortEstimate(200, 300, 400, 0.9),
          directCosts: buildDirectCostEstimate({ aiApiCost: buildEstimatedCostItem(50000) }),
          implementationNovelty: buildImplementationNoveltyAssessment("HIGH"),
        }),
      );
      expect(result.commercialDUBeforeGuardrail).not.toBeNull();
      expect(result.commercialDUAfterGuardrail).not.toBeNull();
      expect(result.guardrailApplied).toBe(true);
      expect(result.guardrailReason).not.toBeNull();
      expect(result.commercialDUAfterGuardrail!).toBeLessThan(result.commercialDUBeforeGuardrail!);
      expect(result.commercialDUAfterGuardrail!).toBeCloseTo(4 * COMMERCIAL_DU_GUARDRAIL_MAX_FRACTION, 1);
    });

    it("reports guardrailApplied: false and equal before/after values when the cap is not hit", () => {
      const result = computeCommercialCalculation(baseInput());
      expect(result.guardrailApplied).toBe(false);
      expect(result.guardrailReason).toBeNull();
      expect(result.commercialDUBeforeGuardrail).toBe(result.commercialDUAfterGuardrail);
    });
  });

  describe("Test I - existing asset leverage / productivity gains never reduce Commercial DU below Base DU", () => {
    it("floors Commercial DU at Base DU even for an extreme productivity gain", () => {
      // Existing assets reducing AI-native effort is exactly what shows up
      // here as a large productivity gain (effort far below benchmark) -
      // Base DU (scope) is untouched (tested in duEngine.test.ts), and this
      // engine must never let that gain push Commercial DU under Base DU.
      const result = computeCommercialCalculation(baseInput({ aiNativeEffort: buildEffortEstimate(2, 3, 5, 0.9) }));
      expect(result.effortAnalysis!.productivityGain).not.toBeNull();
      expect(result.suggestedCommercialDU!).toBeGreaterThanOrEqual(result.baseDU!);
    });

    it("never lets ANY combination of adjustments push Commercial DU below Base DU under the current (all non-negative) adjustment model", () => {
      for (const confidence of [0.95, 0.8, 0.7, 0.55, 0.3]) {
        for (const likelyHours of [1, 10, 24, 100]) {
          const result = computeCommercialCalculation(
            baseInput({ aiNativeEffort: buildEffortEstimate(likelyHours * 0.8, likelyHours, likelyHours * 1.2, confidence) }),
          );
          expect(result.suggestedCommercialDU!).toBeGreaterThanOrEqual(result.baseDU!);
        }
      }
    });
  });

  it("always reports every adjustment category, even when its deltaDU is 0 - never silently omitted", () => {
    const result = computeCommercialCalculation(baseInput());
    const labels = result.adjustments.map((a) => a.label);
    expect(labels).toEqual([
      "AI-native Aufwand vs. Effort Benchmark",
      "Direkte Entwicklungskosten",
      "Implementation Novelty",
      "Kaufmännische Risikoreserve",
    ]);
  });

  it("ignores RECURRING_RUNTIME-only direct costs - they never inflate Commercial DU", () => {
    const withoutRuntimeCost = computeCommercialCalculation(baseInput());
    const withRuntimeCost = computeCommercialCalculation(
      baseInput({ directCosts: buildDirectCostEstimate({ aiApiCost: buildEstimatedCostItem(10000, "RECURRING_RUNTIME") }) }),
    );
    expect(withRuntimeCost.suggestedCommercialDU).toBe(withoutRuntimeCost.suggestedCommercialDU);
  });
});
