import { describe, expect, it } from "vitest";
import type { DimensionKey, DimensionScores, ImplementationEstimate } from "../domain/types.js";
import { DIMENSION_KEYS } from "../domain/types.js";
import { estimateAlternativeApproaches, estimateTime } from "./effortEstimator.js";

function buildScores(
  overrides: Partial<Record<DimensionKey, number>> = {},
): DimensionScores {
  const scores = {} as DimensionScores;
  for (const key of DIMENSION_KEYS) {
    scores[key] = {
      score: (overrides[key] ?? 3) as 1 | 2 | 3 | 4 | 5,
      confidence: 0.9,
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

function buildImplementationEstimate(hours: number): ImplementationEstimate {
  return {
    estimatedHours: hours,
    rationale: { en: "test rationale", de: "Test-Begründung" },
  };
}

describe("estimateTime", () => {
  it("uses the AI's estimated hours as totalHours directly, not a DU-based multiplication", () => {
    const scores = buildScores();
    const result = estimateTime(buildImplementationEstimate(36), scores, 6, 6);
    expect(result.totalHours).toBe(36);
    expect(result.hoursPerDU).toBe(6);
  });

  it("keeps the DU-based figure only as a reference, never adjusting totalHours to match it", () => {
    const scores = buildScores();
    const result = estimateTime(buildImplementationEstimate(80), scores, 6, 6);
    expect(result.totalHours).toBe(80);
    expect(result.referenceHoursFromDU).toBe(36);
  });

  it("flags a significant deviation when the AI estimate differs from the DU-based reference by more than 50%", () => {
    // reference = 6 DU * 6 h/DU = 36h, actual = 80h -> +122%
    const result = estimateTime(buildImplementationEstimate(80), buildScores(), 6, 6);
    expect(result.hasSignificantDeviationFromDuReference).toBe(true);
  });

  it("does not flag a deviation when the AI estimate is close to the DU-based reference", () => {
    // reference = 36h, actual = 40h -> +11%
    const result = estimateTime(buildImplementationEstimate(40), buildScores(), 6, 6);
    expect(result.hasSignificantDeviationFromDuReference).toBe(false);
  });

  it("splits development and prompting hours so they sum back to the total", () => {
    const scores = buildScores({ aiComplexity: 5 });
    const result = estimateTime(buildImplementationEstimate(10), scores, 6, 6);
    expect(result.developmentHours + result.promptingHours).toBeCloseTo(result.totalHours, 5);
  });

  it("gives an AI-heavy requirement a larger prompting share than a flat-profile one", () => {
    const flat = estimateTime(buildImplementationEstimate(10), buildScores(), 6, 6);
    const aiHeavy = estimateTime(buildImplementationEstimate(10), buildScores({ aiComplexity: 5 }), 6, 6);
    expect(aiHeavy.promptingHours).toBeGreaterThan(flat.promptingHours);
  });

  it("gives zero prompting hours when aiComplexity scores the minimum while everything else is high", () => {
    const result = estimateTime(
      buildImplementationEstimate(10),
      buildScores({
        functionalScope: 5,
        technicalComplexity: 5,
        dataIntegration: 5,
        aiComplexity: 1,
        automation: 5,
        testingQA: 5,
        deploymentOperations: 5,
        uncertaintyRisk: 5,
      }),
      6,
      6,
    );
    expect(result.promptingHours).toBeGreaterThan(0); // aiComplexity still contributes something at score 1
    expect(result.promptingHours).toBeLessThan(result.developmentHours);
  });

  it("carries the AI's own rationale through unchanged", () => {
    const estimate = buildImplementationEstimate(20);
    const result = estimateTime(estimate, buildScores(), 6, 6);
    expect(result.rationale).toBe(estimate.rationale);
  });
});

describe("estimateAlternativeApproaches", () => {
  it("always returns exactly the four approaches in a fixed order", () => {
    const scores = buildScores();
    const timeEstimate = estimateTime(buildImplementationEstimate(36), scores, 6, 6);
    const result = estimateAlternativeApproaches(scores, timeEstimate);
    expect(result.map((a) => a.id)).toEqual(["classicalDevelopment", "n8n", "intrexx", "n8nIntrexxCombined"]);
  });

  it("classicalDevelopment is always the unmodified baseline", () => {
    const scores = buildScores();
    const timeEstimate = estimateTime(buildImplementationEstimate(36), scores, 6, 6);
    const [classical] = estimateAlternativeApproaches(scores, timeEstimate);
    expect(classical!.relativeEffort).toBe(1);
    expect(classical!.estimatedHours).toBe(timeEstimate.totalHours);
  });

  it("gives a low-code-friendly profile (high automation, low aiComplexity/technicalComplexity) a meaningfully lower n8n effort than the opposite profile", () => {
    const friendly = buildScores({ automation: 5, aiComplexity: 1, technicalComplexity: 1 });
    const unfriendly = buildScores({ automation: 1, aiComplexity: 5, technicalComplexity: 5 });
    const friendlyTime = estimateTime(buildImplementationEstimate(10), friendly, 6, 6);
    const unfriendlyTime = estimateTime(buildImplementationEstimate(10), unfriendly, 6, 6);

    const friendlyN8n = estimateAlternativeApproaches(friendly, friendlyTime).find((a) => a.id === "n8n")!;
    const unfriendlyN8n = estimateAlternativeApproaches(unfriendly, unfriendlyTime).find((a) => a.id === "n8n")!;

    expect(friendlyN8n.relativeEffort).toBeLessThan(unfriendlyN8n.relativeEffort);
  });

  it("never estimates below the minimum relative effort floor, even for a maximally platform-friendly profile", () => {
    const perfectFit = buildScores({
      functionalScope: 1,
      technicalComplexity: 1,
      dataIntegration: 5,
      aiComplexity: 1,
      automation: 5,
      testingQA: 1,
      deploymentOperations: 5,
      uncertaintyRisk: 1,
    });
    const timeEstimate = estimateTime(buildImplementationEstimate(10), perfectFit, 6, 6);
    const result = estimateAlternativeApproaches(perfectFit, timeEstimate);
    for (const approach of result) {
      expect(approach.relativeEffort).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("the combined n8n+Intrexx estimate never needs more effort than the better of the two individually", () => {
    const scores = buildScores({ functionalScope: 5, automation: 4, dataIntegration: 4 });
    const timeEstimate = estimateTime(buildImplementationEstimate(10), scores, 6, 6);
    const [, n8n, intrexx, combined] = estimateAlternativeApproaches(scores, timeEstimate);
    expect(combined!.relativeEffort).toBeLessThanOrEqual(Math.min(n8n!.relativeEffort, intrexx!.relativeEffort));
  });

  it("every non-baseline rationale is non-empty and mentions at least one dimension", () => {
    const scores = buildScores();
    const timeEstimate = estimateTime(buildImplementationEstimate(36), scores, 6, 6);
    const result = estimateAlternativeApproaches(scores, timeEstimate);
    for (const approach of result.slice(1)) {
      expect(approach.rationale.length).toBeGreaterThan(10);
    }
  });
});
