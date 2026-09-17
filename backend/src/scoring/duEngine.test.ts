import { describe, expect, it } from "vitest";
import type { DimensionKey, DimensionScores, ImplementationEstimate } from "../domain/types.js";
import { DIMENSION_KEYS } from "../domain/types.js";
import {
  DIMENSION_WEIGHTS,
  calculateOverallConfidence,
  calculatePrice,
  calculateWeightedScore,
  classifyConfidence,
  computeDuResult,
  determineScoringStatus,
  estimateXXLDevelopmentUnits,
  mapScoreToClass,
} from "./duEngine.js";

const HOURS_PER_DU = 6;
const BILLING_RATE_PER_HOUR = 160;

/**
 * computeDuResult's 4th argument is the AI's independent implementation-hour
 * estimate (domain/schemas.ts ImplementationEstimateSchema) - deliberately
 * NOT derived from developmentUnits/HOURS_PER_DU. Most tests below pass the
 * same hours the old DU * HOURS_PER_DU formula would have produced, purely
 * so their price/time assertions stay meaningful fixed numbers; the
 * "AI-based time estimate independence" describe block below verifies the
 * estimate is genuinely authoritative even when it diverges from that figure.
 */
function buildImplementationEstimate(hours: number): ImplementationEstimate {
  return {
    estimatedHours: hours,
    rationale: { en: "test rationale", de: "Test-Begründung" },
  };
}

function buildScores(
  overrides: Partial<Record<DimensionKey, { score: 1 | 2 | 3 | 4 | 5; confidence: number }>> = {},
): DimensionScores {
  const scores = {} as DimensionScores;
  for (const key of DIMENSION_KEYS) {
    const override = overrides[key];
    scores[key] = {
      score: override?.score ?? 3,
      confidence: override?.confidence ?? 0.9,
      summary: { en: "test summary", de: "Test-Zusammenfassung" },
      rationale: { en: "test rationale", de: "Test-Begründung" },
      evidence: [],
      missingInformation: [],
      factsUsed: [],
      assumptionsUsed: [],
      unresolvedRisks: [],
    };
  }
  return scores;
}

describe("DIMENSION_WEIGHTS", () => {
  it("sums to exactly 1.00", () => {
    const total = DIMENSION_KEYS.reduce((sum, key) => sum + DIMENSION_WEIGHTS[key], 0);
    expect(total).toBeCloseTo(1.0, 10);
  });
});

describe("calculateWeightedScore", () => {
  it("returns 1.00 when every dimension scores the minimum (1)", () => {
    const scores = buildScores(
      Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 1, confidence: 0.9 }])) as never,
    );
    expect(calculateWeightedScore(scores)).toBe(1.0);
  });

  it("returns 5.00 when every dimension scores the maximum (5)", () => {
    const scores = buildScores(
      Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 5, confidence: 0.9 }])) as never,
    );
    expect(calculateWeightedScore(scores)).toBe(5.0);
  });

  it("weights functionalScope and technicalComplexity most heavily", () => {
    const base = buildScores();
    const bumpedFunctional = buildScores({ functionalScope: { score: 5, confidence: 0.9 } });
    const bumpedDeployment = buildScores({ deploymentOperations: { score: 5, confidence: 0.9 } });

    const baseScore = calculateWeightedScore(base);
    const functionalDelta = calculateWeightedScore(bumpedFunctional) - baseScore;
    const deploymentDelta = calculateWeightedScore(bumpedDeployment) - baseScore;

    expect(functionalDelta).toBeGreaterThan(deploymentDelta);
  });
});

describe("mapScoreToClass - boundary behavior", () => {
  const cases: Array<[number, string, number]> = [
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
    [4.11, "XXL", 10],
    [4.5, "XXL", 13],
    [5.0, "XXL", 19],
  ];

  it.each(cases)("maps weighted score %s to class %s (%s DU)", (score, expectedClass, expectedDu) => {
    const result = mapScoreToClass(score);
    expect(result.duClass).toBe(expectedClass);
    expect(result.developmentUnits).toBe(expectedDu);
  });

  it("marks isRoughEstimate true only for XXL", () => {
    expect(mapScoreToClass(4.1).isRoughEstimate).toBe(false);
    expect(mapScoreToClass(4.11).isRoughEstimate).toBe(true);
    expect(mapScoreToClass(5.0).isRoughEstimate).toBe(true);
  });
});

describe("estimateXXLDevelopmentUnits", () => {
  it("continues just above the XL ceiling at essentially the XL value", () => {
    expect(estimateXXLDevelopmentUnits(4.11)).toBe(10);
  });

  it("grows monotonically as the weighted score increases", () => {
    const values = [4.2, 4.5, 4.8, 5.0].map(estimateXXLDevelopmentUnits);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]!);
    }
  });

  it("clamps at the theoretical maximum weighted score (5.0) - a higher input never produces a higher estimate", () => {
    expect(estimateXXLDevelopmentUnits(6.0)).toBe(estimateXXLDevelopmentUnits(5.0));
  });
});

describe("calculatePrice", () => {
  it("multiplies total estimated hours by the billing rate per hour", () => {
    expect(calculatePrice(36, 160)).toBe(5760);
  });

  it("returns null when total hours is null", () => {
    expect(calculatePrice(null, 160)).toBeNull();
  });

  it("returns null when no billing rate is configured", () => {
    expect(calculatePrice(36, null)).toBeNull();
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
    const scores = buildScores(
      Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 3, confidence: 0.8 }])) as never,
    );
    expect(calculateOverallConfidence(scores)).toBe(0.8);
  });

  it("weighs a low-confidence, low-weight dimension less than a high-weight one", () => {
    const lowWeightUncertain = buildScores({ deploymentOperations: { score: 3, confidence: 0.1 } });
    const highWeightUncertain = buildScores({ functionalScope: { score: 3, confidence: 0.1 } });

    expect(calculateOverallConfidence(lowWeightUncertain)).toBeGreaterThan(
      calculateOverallConfidence(highWeightUncertain),
    );
  });
});

describe("computeDuResult", () => {
  it("computes a full result end to end for a well-understood, medium-complexity requirement", () => {
    const scores = buildScores(
      Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 3, confidence: 0.9 }])) as never,
    );
    const result = computeDuResult(scores, BILLING_RATE_PER_HOUR, HOURS_PER_DU, buildImplementationEstimate(36));

    expect(result.weightedScore).toBe(3.0);
    expect(result.duClass).toBe("L");
    expect(result.developmentUnits).toBe(6);
    // price = totalHours (the AI's estimate, 36h here) * billing rate (160/h)
    expect(result.price).toBe(36 * BILLING_RATE_PER_HOUR);
    expect(result.overallConfidence).toBe(0.9);
    expect(result.confidenceLevel).toBe("HIGH");
    expect(result.isRoughEstimate).toBe(false);
  });

  it("gives XXL results a positive, rough-estimate development unit count and price instead of null", () => {
    const scores = buildScores(
      Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 5, confidence: 0.9 }])) as never,
    );
    const result = computeDuResult(scores, BILLING_RATE_PER_HOUR, HOURS_PER_DU, buildImplementationEstimate(114));

    expect(result.duClass).toBe("XXL");
    expect(result.developmentUnits).toBe(19);
    // price = totalHours (the AI's estimate, 114h here) * billing rate (160/h)
    expect(result.price).toBe(114 * BILLING_RATE_PER_HOUR);
    expect(result.isRoughEstimate).toBe(true);
  });

  it("surfaces LOW confidence so the caller can withhold the DU estimate", () => {
    const scores = buildScores(
      Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 3, confidence: 0.4 }])) as never,
    );
    const result = computeDuResult(scores, BILLING_RATE_PER_HOUR, HOURS_PER_DU, buildImplementationEstimate(36));

    expect(result.confidenceLevel).toBe("LOW");
  });

  it("attaches a time estimate driven by the AI's implementation estimate, with the DU-based figure kept only as a reference", () => {
    const scores = buildScores(
      Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 3, confidence: 0.9 }])) as never,
    );
    const result = computeDuResult(scores, BILLING_RATE_PER_HOUR, HOURS_PER_DU, buildImplementationEstimate(36));

    expect(result.timeEstimate.hoursPerDU).toBe(HOURS_PER_DU);
    expect(result.timeEstimate.totalHours).toBe(36);
    expect(result.timeEstimate.referenceHoursFromDU).toBe(result.developmentUnits! * HOURS_PER_DU);
    expect(result.timeEstimate.developmentHours + result.timeEstimate.promptingHours).toBeCloseTo(
      result.timeEstimate.totalHours,
      5,
    );
  });

  it("attaches all four alternative approach estimates, classical development at relativeEffort 1.0", () => {
    const scores = buildScores(
      Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 3, confidence: 0.9 }])) as never,
    );
    const result = computeDuResult(scores, BILLING_RATE_PER_HOUR, HOURS_PER_DU, buildImplementationEstimate(36));

    expect(result.alternativeApproaches.map((a) => a.id)).toEqual([
      "classicalDevelopment",
      "n8n",
      "intrexx",
      "n8nIntrexxCombined",
    ]);
    const classical = result.alternativeApproaches[0]!;
    expect(classical.relativeEffort).toBe(1);
    expect(classical.estimatedHours).toBe(result.timeEstimate.totalHours);
  });

  it("never prices a requirement below the configured billing rate per hour, regardless of DU class", () => {
    // Regression test: price used to be an independent PRICE_PER_DU value
    // unrelated to the time estimate - at its old default (300) with the
    // old default hoursPerDU (6), that implied only 50 €/h, far under any
    // real billing rate. Deriving price from hours * billingRatePerHour
    // makes the implied rate always exactly equal to the configured rate,
    // for every DU class from XS to XXL, regardless of what the AI estimates.
    for (const score of [1.0, 1.8, 2.5, 3.2, 4.0, 4.9]) {
      const scores = buildScores(
        Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: Math.round(score) as 1 | 2 | 3 | 4 | 5, confidence: 0.9 }])) as never,
      );
      const result = computeDuResult(scores, BILLING_RATE_PER_HOUR, HOURS_PER_DU, buildImplementationEstimate(50));
      const impliedRate = result.price! / result.timeEstimate.totalHours;
      expect(impliedRate).toBeCloseTo(BILLING_RATE_PER_HOUR, 5);
    }
  });
});

describe("computeDuResult - AI-based time estimate independence", () => {
  // These tests exist because time was originally computed purely as
  // developmentUnits * HOURS_PER_DU. That was flagged as fundamentally wrong:
  // the requested design is that the AI's implementation-hour estimate is the
  // authoritative source of time/price, while the DU class/count stays a
  // completely separate, unchanged, dimension-score-based figure - the two
  // are allowed to diverge, and diverging is exactly what should happen when
  // a requirement's real implementation shape differs from its DU-implied
  // "typical" effort.
  const mediumScores = buildScores(
    Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 3, confidence: 0.9 }])) as never,
  );

  it("uses the AI's estimated hours as totalHours even when it diverges sharply from the DU-based reference", () => {
    // weightedScore 3.0 -> L class, 6 DU -> DU-based reference = 36h, but the
    // AI estimates 90h. totalHours must reflect the AI's number, not 36.
    const result = computeDuResult(mediumScores, BILLING_RATE_PER_HOUR, HOURS_PER_DU, buildImplementationEstimate(90));

    expect(result.duClass).toBe("L");
    expect(result.developmentUnits).toBe(6);
    expect(result.timeEstimate.totalHours).toBe(90);
    expect(result.timeEstimate.referenceHoursFromDU).toBe(36);
    expect(result.price).toBe(90 * BILLING_RATE_PER_HOUR);
  });

  it("never changes the DU class or development unit count based on the AI's hour estimate", () => {
    const lowEstimate = computeDuResult(mediumScores, BILLING_RATE_PER_HOUR, HOURS_PER_DU, buildImplementationEstimate(4));
    const highEstimate = computeDuResult(mediumScores, BILLING_RATE_PER_HOUR, HOURS_PER_DU, buildImplementationEstimate(400));

    expect(lowEstimate.duClass).toBe("L");
    expect(lowEstimate.developmentUnits).toBe(6);
    expect(highEstimate.duClass).toBe("L");
    expect(highEstimate.developmentUnits).toBe(6);
    expect(lowEstimate.weightedScore).toBe(highEstimate.weightedScore);
  });

  it("flags hasSignificantDeviationFromDuReference when the AI estimate differs from the DU-based reference by more than 50%", () => {
    // reference = 36h; 90h is +150%
    const result = computeDuResult(mediumScores, BILLING_RATE_PER_HOUR, HOURS_PER_DU, buildImplementationEstimate(90));
    expect(result.timeEstimate.hasSignificantDeviationFromDuReference).toBe(true);
  });

  it("does not flag a deviation when the AI estimate stays close to the DU-based reference", () => {
    // reference = 36h; 38h is within 50%
    const result = computeDuResult(mediumScores, BILLING_RATE_PER_HOUR, HOURS_PER_DU, buildImplementationEstimate(38));
    expect(result.timeEstimate.hasSignificantDeviationFromDuReference).toBe(false);
  });

  it("carries the AI's own rationale for the time estimate through to the result", () => {
    const estimate: ImplementationEstimate = {
      estimatedHours: 42,
      rationale: { en: "Because of X and Y", de: "Wegen X und Y" },
    };
    const result = computeDuResult(mediumScores, BILLING_RATE_PER_HOUR, HOURS_PER_DU, estimate);
    expect(result.timeEstimate.rationale).toEqual(estimate.rationale);
  });
});

describe("determineScoringStatus", () => {
  const highConfidenceScores = buildScores(
    Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 3, confidence: 0.9 }])) as never,
  );
  const xxlScores = buildScores(
    Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 5, confidence: 0.9 }])) as never,
  );
  const lowConfidenceScores = buildScores(
    Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { score: 3, confidence: 0.4 }])) as never,
  );

  it("returns SCORED when confident, in-range, and no assumptions were used", () => {
    const result = computeDuResult(highConfidenceScores, BILLING_RATE_PER_HOUR, HOURS_PER_DU, buildImplementationEstimate(36));
    expect(determineScoringStatus(result, 0)).toBe("SCORED");
  });

  it("returns ASSESSMENT_WITH_ASSUMPTIONS when confident and in-range but assumptions were relied on", () => {
    const result = computeDuResult(highConfidenceScores, BILLING_RATE_PER_HOUR, HOURS_PER_DU, buildImplementationEstimate(36));
    expect(determineScoringStatus(result, 3)).toBe("ASSESSMENT_WITH_ASSUMPTIONS");
  });

  it("returns DECOMPOSITION_REQUIRED for XXL regardless of assumptions used", () => {
    const result = computeDuResult(xxlScores, BILLING_RATE_PER_HOUR, HOURS_PER_DU, buildImplementationEstimate(114));
    expect(determineScoringStatus(result, 0)).toBe("DECOMPOSITION_REQUIRED");
    expect(determineScoringStatus(result, 2)).toBe("DECOMPOSITION_REQUIRED");
  });

  it("returns NEEDS_CLARIFICATION for LOW confidence even when assumptions were used - assumptions never mask low confidence", () => {
    const result = computeDuResult(lowConfidenceScores, BILLING_RATE_PER_HOUR, HOURS_PER_DU, buildImplementationEstimate(36));
    expect(determineScoringStatus(result, 0)).toBe("NEEDS_CLARIFICATION");
    expect(determineScoringStatus(result, 5)).toBe("NEEDS_CLARIFICATION");
  });
});
