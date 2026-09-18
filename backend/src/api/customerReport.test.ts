import { describe, expect, it } from "vitest";
import type { ScoringResult } from "../domain/types.js";
import {
  buildDimensionScores,
  buildDirectCostEstimate,
  buildEffortWorkBreakdownFromPackages,
  buildEstimatedCostItem,
  buildExistingAssetLeverage,
  buildImplementationNoveltyAssessment,
  buildReusableInnovationAssessment,
  buildTechnologyNarratives,
  buildTechnologyProfile,
  buildWorkPackage,
} from "../scoring/testFixtures.js";
import { computeDuResult } from "../scoring/duEngine.js";
import { buildCustomerReport } from "./customerReport.js";

const SENSITIVE_WORK_BREAKDOWN = buildEffortWorkBreakdownFromPackages([
  buildWorkPackage({
    id: "wp-secret-1",
    title: "Interne Kundendaten-Migration",
    humanEffort: { minHours: 10, likelyHours: 20, maxHours: 30 },
    affectedComponents: ["internal-billing-service"],
    dependencies: ["wp-secret-0"],
    repositoryEvidence: [{ path: "src/services/customerMemory.ts", symbol: "CustomerMemoryService", status: "VERIFIED" }],
    rationale: "internal effort rationale - do not show a customer how we sized this",
    risks: ["internal risk: legacy auth module is fragile"],
    assumptions: ["internal assumption: vector store already sharded"],
  }),
]);

function buildScoringResult(): ScoringResult {
  const scores = buildDimensionScores();
  const duResult = computeDuResult({
    scores,
    effortWorkBreakdown: SENSITIVE_WORK_BREAKDOWN,
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

  // Test K (bottom-up effort spec section 42) - Work Packages can carry
  // sensitive technical detail (file paths, internal services, risks,
  // assumptions) that must never reach the public, unauthenticated share
  // link. buildCustomerReport never even reads du.effortEstimate, but this
  // regression test guards against that ever changing silently.
  it("never leaks Work Package internals (repository paths, dependencies, internal rationale/risks/assumptions)", () => {
    const report = buildCustomerReport(buildScoringResult())!;
    const serialized = JSON.stringify(report);

    expect(report).not.toHaveProperty("effortEstimate");
    expect(serialized).not.toContain("workPackages");
    expect(serialized).not.toContain("workBreakdown");
    expect(serialized).not.toContain("wp-secret");
    expect(serialized).not.toContain("customerMemory.ts");
    expect(serialized).not.toContain("CustomerMemoryService");
    expect(serialized).not.toContain("internal-billing-service");
    expect(serialized).not.toContain("internal effort rationale");
    expect(serialized).not.toContain("legacy auth module is fragile");
    expect(serialized).not.toContain("vector store already sharded");
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

  // Test O (requirement-challenge-v1 spec) - Requirement Challenge internals
  // (proposals with their evidence/rationale/confidence, the goal/problem-
  // statement analysis, solution specificity, conflicting alternatives) must
  // never reach the public customer report. buildCustomerReport takes only a
  // ScoringResult (see domain/types.ts), which never carries
  // challengeProposals/challengeAnalysis/originalRequirement/
  // normalizedRequirement/approvalStatus at all - those live exclusively on
  // RequirementContext - so there is no leak path today. This regression
  // test guards against that ever changing silently (e.g. someone later
  // adding a "challengeAnalysis" field to ScoringResult and having
  // buildCustomerReport spread it through unfiltered).
  it("never leaks Requirement Challenge internals (proposals, evidence, rationale, goal analysis)", () => {
    const report = buildCustomerReport(buildScoringResult())!;
    const serialized = JSON.stringify(report);

    expect(report).not.toHaveProperty("challengeProposals");
    expect(report).not.toHaveProperty("challengeAnalysis");
    expect(report).not.toHaveProperty("originalRequirement");
    expect(report).not.toHaveProperty("normalizedRequirement");
    expect(report).not.toHaveProperty("approvalStatus");
    expect(serialized).not.toContain("solutionSpecificity");
    expect(serialized).not.toContain("proposedChange");
    expect(serialized).not.toContain("SOLUTION_CONSTRAINT");
    expect(serialized).not.toContain("REUSE_OPPORTUNITY");
  });
});
