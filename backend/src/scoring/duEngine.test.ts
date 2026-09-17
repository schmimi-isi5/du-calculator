import { describe, expect, it } from "vitest";
import { DIMENSION_KEYS } from "../domain/types.js";
import {
  DIMENSION_WEIGHTS,
  calculateOverallConfidence,
  calculateWeightedScore,
  classifyConfidence,
  computeDuResult,
  determineScoringStatus,
  mapScoreToClass,
  type ComputeDuResultInput,
} from "./duEngine.js";
import {
  buildDimensionScores,
  buildDirectCostEstimate,
  buildEffortEstimate,
  buildEstimatedCostItem,
  buildExistingAssetLeverage,
  buildImplementationNoveltyAssessment,
  buildReusableInnovationAssessment,
  buildTechnologyNarratives,
  buildTechnologyProfile,
} from "./testFixtures.js";

const BILLING_RATE_PER_HOUR = 160;
const PRICE_PER_DU = 900;

function buildInput(overrides: Partial<ComputeDuResultInput> = {}): ComputeDuResultInput {
  return {
    scores: buildDimensionScores(Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 3, confidence: 0.9 }])) as never),
    // Matches the L-class effort benchmark (36h) by default, so most tests
    // below get commercialDU == baseDU unless they deliberately vary
    // effort/cost/novelty.
    effortEstimate: buildEffortEstimate(30, 36, 42),
    technologyProfile: buildTechnologyProfile(),
    existingAssetLeverage: buildExistingAssetLeverage(),
    technologyNarratives: buildTechnologyNarratives(),
    directCosts: buildDirectCostEstimate(),
    implementationNovelty: buildImplementationNoveltyAssessment("LOW"),
    reusableInnovationIp: buildReusableInnovationAssessment("NONE"),
    pricingStrategy: "HOURLY",
    pricingConfig: { billingRatePerHour: BILLING_RATE_PER_HOUR, pricePerDU: PRICE_PER_DU },
    ...overrides,
  };
}

describe("DIMENSION_WEIGHTS", () => {
  it("sums to exactly 1.00", () => {
    const total = DIMENSION_KEYS.reduce((sum, key) => sum + DIMENSION_WEIGHTS[key], 0);
    expect(total).toBeCloseTo(1.0, 10);
  });
});

describe("calculateWeightedScore", () => {
  it("returns 1.00 when every dimension scores the minimum (1)", () => {
    const scores = buildDimensionScores(
      Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 1, confidence: 0.9 }])) as never,
    );
    expect(calculateWeightedScore(scores)).toBe(1.0);
  });

  it("returns 5.00 when every dimension scores the maximum (5)", () => {
    const scores = buildDimensionScores(
      Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 5, confidence: 0.9 }])) as never,
    );
    expect(calculateWeightedScore(scores)).toBe(5.0);
  });

  it("weights functionalScope and technicalComplexity most heavily", () => {
    const base = buildDimensionScores();
    const bumpedFunctional = buildDimensionScores({ functionalScope: { score: 5, confidence: 0.9 } });
    const bumpedDeployment = buildDimensionScores({ deploymentOperations: { score: 5, confidence: 0.9 } });

    const baseScore = calculateWeightedScore(base);
    const functionalDelta = calculateWeightedScore(bumpedFunctional) - baseScore;
    const deploymentDelta = calculateWeightedScore(bumpedDeployment) - baseScore;

    expect(functionalDelta).toBeGreaterThan(deploymentDelta);
  });
});

describe("mapScoreToClass - boundary behavior", () => {
  const cases: Array<[number, string, number | null]> = [
    [1.0, "XS", 1],
    [1.5, "XS", 1],
    [1.51, "S", 2],
    [2.0, "S", 2],
    [2.01, "M", 4],
    [2.7, "M", 4],
    [2.71, "L", 6],
    [3.4, "L", 6],
    [3.41, "XL", 10],
    [4.1, "XL", 10],
    [4.11, "XXL", null],
    [4.5, "XXL", null],
    [5.0, "XXL", null],
  ];

  it.each(cases)("maps weighted score %s to class %s (%s DU)", (score, expectedClass, expectedDu) => {
    const result = mapScoreToClass(score);
    expect(result.duClass).toBe(expectedClass);
    expect(result.developmentUnits).toBe(expectedDu);
  });

  it("marks isRoughEstimate true only for XXL, where developmentUnits is null", () => {
    expect(mapScoreToClass(4.1).isRoughEstimate).toBe(false);
    expect(mapScoreToClass(4.11).isRoughEstimate).toBe(true);
    expect(mapScoreToClass(4.11).developmentUnits).toBeNull();
    expect(mapScoreToClass(5.0).isRoughEstimate).toBe(true);
    expect(mapScoreToClass(5.0).developmentUnits).toBeNull();
  });

  it("never produces an artificially precise DU count above the XL ceiling - this was the old exponential-extrapolation behavior, now removed", () => {
    // Regression test: the old estimateXXLDevelopmentUnits function produced
    // numbers like 13/14/17/19 DU for scores past 4.1 - a false-precision
    // extrapolation the technology-fit-v2 spec explicitly requires removing.
    for (const score of [4.11, 4.3, 4.5, 4.8, 5.0]) {
      expect(mapScoreToClass(score).developmentUnits).toBeNull();
    }
  });
});

describe("classifyConfidence", () => {
  it("classifies >= 0.85 as HIGH", () => {
    expect(classifyConfidence(0.85)).toBe("HIGH");
    expect(classifyConfidence(0.95)).toBe("HIGH");
  });

  it("classifies [0.65, 0.85) as MEDIUM", () => {
    expect(classifyConfidence(0.65)).toBe("MEDIUM");
    expect(classifyConfidence(0.84)).toBe("MEDIUM");
  });

  it("classifies < 0.65 as LOW", () => {
    expect(classifyConfidence(0.64)).toBe("LOW");
    expect(classifyConfidence(0)).toBe("LOW");
  });
});

describe("calculateOverallConfidence", () => {
  it("returns the flat confidence when every dimension agrees", () => {
    const scores = buildDimensionScores(
      Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 3, confidence: 0.8 }])) as never,
    );
    expect(calculateOverallConfidence(scores)).toBe(0.8);
  });

  it("weighs a low-confidence, low-weight dimension less than a high-weight one", () => {
    const lowWeightUncertain = buildDimensionScores({ deploymentOperations: { score: 3, confidence: 0.1 } });
    const highWeightUncertain = buildDimensionScores({ functionalScope: { score: 3, confidence: 0.1 } });

    expect(calculateOverallConfidence(lowWeightUncertain)).toBeGreaterThan(
      calculateOverallConfidence(highWeightUncertain),
    );
  });
});

describe("computeDuResult", () => {
  it("computes a full result end to end for a well-understood, medium-complexity requirement", () => {
    const result = computeDuResult(buildInput({ effortEstimate: buildEffortEstimate(30, 36, 45) }));

    expect(result.weightedScore).toBe(3.0);
    expect(result.duClass).toBe("L");
    expect(result.developmentUnits).toBe(6);
    // HOURLY strategy: price = AI_NATIVE's likelyHours * billingRatePerHour
    expect(result.price).toBe(36 * BILLING_RATE_PER_HOUR);
    expect(result.pricingStrategy).toBe("HOURLY");
    expect(result.overallConfidence).toBe(0.9);
    expect(result.confidenceLevel).toBe("HIGH");
    expect(result.isRoughEstimate).toBe(false);
    expect(result.calculationModelVersion).toBe("commercial-du-v2");
  });

  it("gives XXL results a null development unit count and price under DU_FIXED_PRICE, but still a usable effort/price under HOURLY", () => {
    const xxlInput = buildInput({
      scores: buildDimensionScores(Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 5, confidence: 0.9 }])) as never),
      effortEstimate: buildEffortEstimate(80, 100, 140),
    });

    const hourly = computeDuResult(xxlInput);
    expect(hourly.duClass).toBe("XXL");
    expect(hourly.developmentUnits).toBeNull();
    expect(hourly.isRoughEstimate).toBe(true);
    // Effort/price are independent of DU - XXL still gets a real number under HOURLY.
    expect(hourly.price).toBe(100 * BILLING_RATE_PER_HOUR);

    const fixedPrice = computeDuResult({
      ...xxlInput,
      pricingStrategy: "DU_FIXED_PRICE",
    });
    expect(fixedPrice.developmentUnits).toBeNull();
    expect(fixedPrice.price).toBeNull();
  });

  it("surfaces LOW confidence so the caller can withhold the DU estimate", () => {
    const result = computeDuResult(
      buildInput({
        scores: buildDimensionScores(Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 3, confidence: 0.4 }])) as never),
      }),
    );

    expect(result.confidenceLevel).toBe("LOW");
  });

  it("attaches an effortEstimate corridor taken from the AI's own estimate, not derived from DU", () => {
    const result = computeDuResult(buildInput({ effortEstimate: buildEffortEstimate(20, 25, 35) }));

    expect(result.effortEstimate).toEqual({
      minHours: 20,
      likelyHours: 25,
      maxHours: 35,
      confidence: 0.8,
      rationale: { en: "test rationale", de: "Test-Begründung" },
    });
  });

  it("attaches a technology comparison with AI_NATIVE pinned at relativeEffortFactor 1.0 and every technology/combination present", () => {
    const result = computeDuResult(buildInput());

    const technologies = result.technologyComparison!.map((a) => a.technology);
    expect(technologies).toEqual(["AI_NATIVE", "CLASSIC", "N8N", "INTREXX", "N8N_INTREXX"]);
    const aiNative = result.technologyComparison!.find((a) => a.technology === "AI_NATIVE")!;
    expect(aiNative.relativeEffortFactor).toBe(1);
  });

  it("attaches a commercialCalculation with an INITIAL_HYPOTHESIS calibration status and a null Commercial DU for XXL", () => {
    const result = computeDuResult(buildInput());
    expect(result.commercialCalculation!.calibrationStatus).toBe("INITIAL_HYPOTHESIS");
    expect(result.commercialCalculation!.baseDU).toBe(6);
    expect(result.commercialDevelopmentUnits).toBe(result.commercialCalculation!.suggestedCommercialDU);

    const xxlResult = computeDuResult(
      buildInput({
        scores: buildDimensionScores(Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 5, confidence: 0.9 }])) as never),
      }),
    );
    expect(xxlResult.commercialDevelopmentUnits).toBeNull();
    expect(xxlResult.commercialCalculation!.suggestedCommercialDU).toBeNull();
  });

  it("computes DU_FIXED_PRICE as Commercial DU * pricePerDU, NOT Base DU * pricePerDU", () => {
    // High implementation novelty pushes Commercial DU above Base DU (6) - DU_FIXED_PRICE
    // must price against that adjusted figure, not the raw technical scope.
    const result = computeDuResult(
      buildInput({ pricingStrategy: "DU_FIXED_PRICE", implementationNovelty: buildImplementationNoveltyAssessment("HIGH") }),
    );

    expect(result.developmentUnits).toBe(6);
    expect(result.commercialDevelopmentUnits).toBeGreaterThan(6);
    expect(result.price).toBe(result.commercialDevelopmentUnits! * PRICE_PER_DU);
    expect(result.price).not.toBe(6 * PRICE_PER_DU);
  });

  it("still prices via HOURLY using AI-native hours directly, unaffected by Commercial DU adjustments", () => {
    const result = computeDuResult(buildInput({ implementationNovelty: buildImplementationNoveltyAssessment("HIGH") }));
    expect(result.price).toBe(36 * BILLING_RATE_PER_HOUR);
  });

  it("never prices a requirement below the configured billing rate per hour under the HOURLY strategy, regardless of DU class", () => {
    // Regression test: price used to be an independent PRICE_PER_DU value
    // unrelated to the time estimate - at its old default (300) with the
    // old default hoursPerDU (6), that implied only 50 €/h, far under any
    // real billing rate. HOURLY pricing makes the implied rate always
    // exactly equal the configured rate, for every DU class from XS to XXL.
    for (const score of [1.0, 1.8, 2.5, 3.2, 4.0, 4.9]) {
      const result = computeDuResult(
        buildInput({
          scores: buildDimensionScores(
            Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: Math.round(score) as 1 | 2 | 3 | 4 | 5, confidence: 0.9 }])) as never,
          ),
          effortEstimate: buildEffortEstimate(20, 50, 80),
        }),
      );
      const impliedRate = result.price! / result.effortEstimate!.likelyHours;
      expect(impliedRate).toBeCloseTo(BILLING_RATE_PER_HOUR, 5);
    }
  });
});

describe("computeDuResult - DU/effort independence", () => {
  // These tests exist because time/effort used to be computed purely as
  // developmentUnits * HOURS_PER_DU. The technology-fit-v2 redesign requires
  // the AI's own effort corridor to be completely independent of - and
  // allowed to diverge sharply from - the DU class/count, which stays a
  // pure function of the eight dimension scores.
  it("never changes the DU class or development unit count based on the AI's effort estimate", () => {
    const lowEstimate = computeDuResult(buildInput({ effortEstimate: buildEffortEstimate(2, 4, 6) }));
    const highEstimate = computeDuResult(buildInput({ effortEstimate: buildEffortEstimate(300, 400, 500) }));

    expect(lowEstimate.duClass).toBe("L");
    expect(lowEstimate.developmentUnits).toBe(6);
    expect(highEstimate.duClass).toBe("L");
    expect(highEstimate.developmentUnits).toBe(6);
    expect(lowEstimate.weightedScore).toBe(highEstimate.weightedScore);
  });

  it("never lets existingAssetLeverage change the DU class or development unit count", () => {
    const noReuse = computeDuResult(buildInput({ existingAssetLeverage: buildExistingAssetLeverage() }));
    const heavyReuse = computeDuResult(
      buildInput({ existingAssetLeverage: buildExistingAssetLeverage({ AI_NATIVE: { assetLeverage: 0.95 } }) }),
    );

    expect(noReuse.duClass).toBe(heavyReuse.duClass);
    expect(noReuse.developmentUnits).toBe(heavyReuse.developmentUnits);
    expect(noReuse.weightedScore).toBe(heavyReuse.weightedScore);
  });
});

describe("determineScoringStatus", () => {
  const highConfidenceInput = buildInput();
  const xxlInput = buildInput({
    scores: buildDimensionScores(Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 5, confidence: 0.9 }])) as never),
  });
  const lowConfidenceInput = buildInput({
    scores: buildDimensionScores(Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 3, confidence: 0.4 }])) as never),
  });

  it("returns SCORED when confident, in-range, and no assumptions were used", () => {
    const result = computeDuResult(highConfidenceInput);
    expect(determineScoringStatus(result, 0)).toBe("SCORED");
  });

  it("returns ASSESSMENT_WITH_ASSUMPTIONS when confident and in-range but assumptions were relied on", () => {
    const result = computeDuResult(highConfidenceInput);
    expect(determineScoringStatus(result, 3)).toBe("ASSESSMENT_WITH_ASSUMPTIONS");
  });

  it("returns DECOMPOSITION_REQUIRED for XXL regardless of assumptions used", () => {
    const result = computeDuResult(xxlInput);
    expect(determineScoringStatus(result, 0)).toBe("DECOMPOSITION_REQUIRED");
    expect(determineScoringStatus(result, 2)).toBe("DECOMPOSITION_REQUIRED");
  });

  it("returns NEEDS_CLARIFICATION for LOW confidence even when assumptions were used - assumptions never mask low confidence", () => {
    const result = computeDuResult(lowConfidenceInput);
    expect(determineScoringStatus(result, 0)).toBe("NEEDS_CLARIFICATION");
    expect(determineScoringStatus(result, 5)).toBe("NEEDS_CLARIFICATION");
  });
});
