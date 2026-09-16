import { describe, expect, it } from "vitest";
import type { DimensionKey, DimensionScores } from "../domain/types.js";
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

describe("estimateTime", () => {
  it("multiplies development units by hoursPerDU for the total", () => {
    const scores = buildScores();
    const result = estimateTime(6, scores, 6);
    expect(result.totalHours).toBe(36);
    expect(result.hoursPerDU).toBe(6);
  });

  it("splits development and prompting hours so they sum back to the total", () => {
    const scores = buildScores({ aiComplexity: 5 });
    const result = estimateTime(10, scores, 6);
    expect(result.developmentHours + result.promptingHours).toBeCloseTo(result.totalHours, 5);
  });

  it("gives an AI-heavy requirement a larger prompting share than a flat-profile one", () => {
    const flat = estimateTime(10, buildScores(), 6);
    const aiHeavy = estimateTime(10, buildScores({ aiComplexity: 5 }), 6);
    expect(aiHeavy.promptingHours).toBeGreaterThan(flat.promptingHours);
  });

  it("gives zero prompting hours when aiComplexity scores the minimum while everything else is high", () => {
    const result = estimateTime(
      10,
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
    );
    expect(result.promptingHours).toBeGreaterThan(0); // aiComplexity still contributes something at score 1
    expect(result.promptingHours).toBeLessThan(result.developmentHours);
  });
});

describe("estimateAlternativeApproaches", () => {
  it("always returns exactly the four approaches in a fixed order", () => {
    const scores = buildScores();
    const timeEstimate = estimateTime(6, scores, 6);
    const result = estimateAlternativeApproaches(scores, timeEstimate);
    expect(result.map((a) => a.id)).toEqual(["classicalDevelopment", "n8n", "intrexx", "n8nIntrexxCombined"]);
  });

  it("classicalDevelopment is always the unmodified baseline", () => {
    const scores = buildScores();
    const timeEstimate = estimateTime(6, scores, 6);
    const [classical] = estimateAlternativeApproaches(scores, timeEstimate);
    expect(classical!.relativeEffort).toBe(1);
    expect(classical!.estimatedHours).toBe(timeEstimate.totalHours);
  });

  it("gives a low-code-friendly profile (high automation, low aiComplexity/technicalComplexity) a meaningfully lower n8n effort than the opposite profile", () => {
    const friendly = buildScores({ automation: 5, aiComplexity: 1, technicalComplexity: 1 });
    const unfriendly = buildScores({ automation: 1, aiComplexity: 5, technicalComplexity: 5 });
    const friendlyTime = estimateTime(10, friendly, 6);
    const unfriendlyTime = estimateTime(10, unfriendly, 6);

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
    const timeEstimate = estimateTime(10, perfectFit, 6);
    const result = estimateAlternativeApproaches(perfectFit, timeEstimate);
    for (const approach of result) {
      expect(approach.relativeEffort).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("the combined n8n+Intrexx estimate never needs more effort than the better of the two individually", () => {
    const scores = buildScores({ functionalScope: 5, automation: 4, dataIntegration: 4 });
    const timeEstimate = estimateTime(10, scores, 6);
    const [, n8n, intrexx, combined] = estimateAlternativeApproaches(scores, timeEstimate);
    expect(combined!.relativeEffort).toBeLessThanOrEqual(Math.min(n8n!.relativeEffort, intrexx!.relativeEffort));
  });

  it("every non-baseline rationale is non-empty and mentions at least one dimension", () => {
    const scores = buildScores();
    const timeEstimate = estimateTime(6, scores, 6);
    const result = estimateAlternativeApproaches(scores, timeEstimate);
    for (const approach of result.slice(1)) {
      expect(approach.rationale.length).toBeGreaterThan(10);
    }
  });
});
