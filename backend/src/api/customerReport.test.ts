import { describe, expect, it } from "vitest";
import type { ScoringResult } from "../domain/types.js";
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
} from "../scoring/testFixtures.js";
import { computeDuResult } from "../scoring/duEngine.js";
import { buildCustomerReport } from "./customerReport.js";

function buildScoringResult(): ScoringResult {
  const scores = buildDimensionScores();
  const duResult = computeDuResult({
    scores,
    effortEstimate: buildEffortEstimate(30, 36, 42),
    technologyProfile: buildTechnologyProfile({ customBusinessLogic: { score: 4 } }),
    existingAssetLeverage: buildExistingAssetLeverage(),
    technologyNarratives: buildTechnologyNarratives(),
    directCosts: buildDirectCostEstimate({
      aiApiCost: buildEstimatedCostItem(300, "ONE_TIME_DEVELOPMENT"),
      infrastructureCost: buildEstimatedCostItem(50, "RECURRING_RUNTIME"),
    }),
    implementationNovelty: buildImplementationNoveltyAssessment("MEDIUM"),
    reusableInnovationIp: buildReusableInnovationAssessment("HIGH"),
    pricingStrategy: "HOURLY",
    pricingConfig: { billingRatePerHour: 160, pricePerDU: 900 },
  });

  return {
    id: "scoring-1",
    snapshotId: "snapshot-1",
    requirementContextId: "context-1",
    requirement: { title: "Test requirement", description: "Test description", acceptanceCriteria: [], constraints: [] },
    qualityLevel: "standard",
    model: "claude-opus-5",
    status: "SCORED",
    impactAnalysis: {
      existing: ["existing service"],
      reusable: ["reusable component"],
      modify: ["modified module"],
      create: ["new endpoint"],
      dataChanges: ["new column"],
      integrations: ["Stripe"],
      tests: ["unit tests"],
      risks: ["internal risk note"],
      openQuestions: [],
      suggestedDecomposition: [],
    },
    dimensionScores: scores,
    confidence: { overallConfidence: duResult.overallConfidence, confidenceLevel: duResult.confidenceLevel },
    duResult,
    overallAssessment: { en: "Overall assessment EN", de: "Gesamteinschätzung DE" },
    assumptionsUsed: ["assumption-1", "assumption-2"],
    openQuestions: [],
    errorMessage: null,
    scoredAt: new Date().toISOString(),
  };
}

describe("buildCustomerReport", () => {
  it("returns null when there is no duResult yet", () => {
    const result = buildScoringResult();
    result.duResult = null;
    expect(buildCustomerReport(result)).toBeNull();
  });

  it("never leaks internal-only fields, even serialized to JSON", () => {
    const report = buildCustomerReport(buildScoringResult())!;
    const serialized = JSON.stringify(report);

    // Structural checks: none of the internal top-level DuResult sections exist.
    expect(report).not.toHaveProperty("commercialCalculation");
    expect(report).not.toHaveProperty("effortEstimate");
    expect(report).not.toHaveProperty("directCosts");
    expect(report).not.toHaveProperty("implementationNovelty");
    expect(report).not.toHaveProperty("reusableInnovationIp");
    expect(report).not.toHaveProperty("dimensionScores");
    expect(report).not.toHaveProperty("assumptionsUsed");
    expect(report).not.toHaveProperty("weightedScore");
    expect(report).not.toHaveProperty("developmentUnits", 6); // base DU number must not appear verbatim under this key

    // Content checks: internal-only string markers must not appear anywhere
    // in the serialized payload - catches leaks through nested fields too.
    expect(serialized).not.toContain("commercialDUConfidence");
    expect(serialized).not.toContain("guardrailApplied");
    expect(serialized).not.toContain("INITIAL_HYPOTHESIS");
    expect(serialized).not.toContain("assumption-1");
    expect(serialized).not.toContain("internal risk note");
    expect(serialized).not.toContain("estimatedHours");
    expect(serialized).not.toContain("fitConfidence");
  });

  it("only includes RECURRING_RUNTIME/BOTH direct costs, never ONE_TIME_DEVELOPMENT ones", () => {
    const report = buildCustomerReport(buildScoringResult())!;
    expect(report.runtimeCosts).toHaveLength(1);
    expect(report.runtimeCosts[0]!.label).toBe("Infrastruktur");
    expect(report.runtimeCosts[0]!.amountEur).toBe(50);
  });

  it("uses Commercial DU as the shown development unit count", () => {
    const result = buildScoringResult();
    const report = buildCustomerReport(result)!;
    expect(report.developmentUnits).toBe(result.duResult!.commercialDevelopmentUnits);
  });

  it("includes the impact analysis subsets a customer should see, but not internal risk notes", () => {
    const report = buildCustomerReport(buildScoringResult())!;
    expect(report.created).toEqual(["new endpoint"]);
    expect(report.modified).toEqual(["modified module"]);
    expect(report.reused).toEqual(["reusable component"]);
  });

  it("strips technology comparison down to only customer-safe fields", () => {
    const report = buildCustomerReport(buildScoringResult())!;
    for (const tech of report.technologyComparison) {
      expect(Object.keys(tech).sort()).toEqual(["advantages", "disadvantages", "label", "relativeEffortFactor", "technology"].sort());
    }
  });
});
