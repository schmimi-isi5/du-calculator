// Shared test-only builders for the DU/Technology-Fit/Effort/Pricing models.
// Not imported by any production code - keeps duEngine.test.ts,
// effortEstimator.test.ts, technologyFitEngine.test.ts, and
// pricingEngine.test.ts from each hand-rolling the same large fixture
// objects.

import { TECHNOLOGY_IDS, TECHNOLOGY_PROFILE_FACTORS, type TechnologyId, type TechnologyProfileFactor } from "../domain/technology.js";
import type {
  DimensionKey,
  DimensionScores,
  DirectCostEstimate,
  DirectCostItem,
  EffortEstimate,
  EffortWorkBreakdownOutput,
  EffortWorkPackageInput,
  ExistingAssetLeverage,
  ImplementationNoveltyAssessment,
  ReusableInnovationAssessment,
  TechnologyNarrative,
  TechnologyProfile,
} from "../domain/types.js";
import { DIMENSION_KEYS } from "../domain/types.js";

export function buildDimensionScores(
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

/** Every factor defaults to a neutral score of 0 (not relevant) so a test only needs to set the factors it actually cares about. */
export function buildTechnologyProfile(
  overrides: Partial<Record<TechnologyProfileFactor, { score: 0 | 1 | 2 | 3 | 4 | 5; confidence?: number }>> = {},
): TechnologyProfile {
  const profile = {} as TechnologyProfile;
  for (const factor of TECHNOLOGY_PROFILE_FACTORS) {
    const override = overrides[factor];
    profile[factor] = {
      score: override?.score ?? 0,
      rationale: "test rationale",
      evidence: [],
      confidence: override?.confidence ?? 0.8,
    };
  }
  return profile;
}

/** Defaults every technology to assetLeverage: null (UNKNOWN, no evidence) - override only the technologies a test cares about. */
export function buildExistingAssetLeverage(
  overrides: Partial<Record<TechnologyId, { assetLeverage: number | null; confidence?: number }>> = {},
): ExistingAssetLeverage[] {
  return TECHNOLOGY_IDS.map((technology) => ({
    technology,
    assetLeverage: overrides[technology]?.assetLeverage ?? null,
    rationale: "test rationale",
    evidence: [],
    confidence: overrides[technology]?.confidence ?? (overrides[technology] ? 0.7 : 0),
  }));
}

export function buildTechnologyNarratives(): TechnologyNarrative[] {
  return TECHNOLOGY_IDS.map((technology) => ({
    technology,
    advantages: [`${technology} advantage`],
    disadvantages: [`${technology} disadvantage`],
  }));
}

/** @deprecated Only for tests that consume a plain EffortEstimate directly (commercialEngine.test.ts, technologyFitEngine.test.ts) - computeDuResult now takes an EffortWorkBreakdownOutput, see buildEffortWorkBreakdownOutput. */
export function buildEffortEstimate(minHours: number, likelyHours: number, maxHours: number, confidence = 0.8): EffortEstimate {
  return {
    minHours,
    likelyHours,
    maxHours,
    confidence,
    rationale: { en: "test rationale", de: "Test-Begründung" },
  };
}

export function buildWorkPackage(overrides: Partial<EffortWorkPackageInput> = {}): EffortWorkPackageInput {
  return {
    id: overrides.id ?? "wp-1",
    title: overrides.title ?? "Test work package",
    category: overrides.category ?? "BACKEND",
    description: overrides.description ?? "test description",
    action: overrides.action ?? "CREATE",
    affectedComponents: overrides.affectedComponents ?? [],
    repositoryEvidence: overrides.repositoryEvidence ?? [],
    dependencies: overrides.dependencies ?? [],
    reuse: overrides.reuse ?? { level: "NONE", description: "test reuse", evidence: [] },
    humanEffort: overrides.humanEffort ?? { minHours: 2, likelyHours: 4, maxHours: 7 },
    confidence: overrides.confidence ?? 0.8,
    rationale: overrides.rationale ?? "test rationale",
    assumptions: overrides.assumptions ?? [],
    risks: overrides.risks ?? [],
    effortDrivers: overrides.effortDrivers ?? [],
  };
}

/** Convenience single-Work-Package breakdown that aggregates to exactly (minHours, likelyHours, maxHours, confidence) - a drop-in replacement for the old single-corridor buildEffortEstimate() wherever a test only cares about the resulting totals, not the Work Package internals. */
export function buildEffortWorkBreakdownOutput(
  minHours: number,
  likelyHours: number,
  maxHours: number,
  confidence = 0.8,
): EffortWorkBreakdownOutput {
  return buildEffortWorkBreakdownFromPackages([
    buildWorkPackage({ id: "wp-1", humanEffort: { minHours, likelyHours, maxHours }, confidence }),
  ]);
}

export function buildEffortWorkBreakdownFromPackages(
  workPackages: EffortWorkPackageInput[],
  overrides: Partial<Omit<EffortWorkBreakdownOutput, "workPackages">> = {},
): EffortWorkBreakdownOutput {
  return {
    workPackages,
    completenessAssessment: overrides.completenessAssessment ?? { complete: true, missingAreas: [], overlapWarnings: [] },
    clarificationsRequired: overrides.clarificationsRequired ?? [],
    generalAssumptions: overrides.generalAssumptions ?? [],
  };
}

function zeroDirectCostItem(): DirectCostItem {
  return { amountEur: null, costType: "ONE_TIME_DEVELOPMENT", status: "UNKNOWN", rationale: "test rationale" };
}

/** Defaults every cost category to UNKNOWN/null - override only what a test cares about. */
export function buildDirectCostEstimate(overrides: Partial<DirectCostEstimate> = {}): DirectCostEstimate {
  return {
    aiApiCost: overrides.aiApiCost ?? zeroDirectCostItem(),
    infrastructureCost: overrides.infrastructureCost ?? zeroDirectCostItem(),
    thirdPartyCost: overrides.thirdPartyCost ?? zeroDirectCostItem(),
    otherDirectCost: overrides.otherDirectCost ?? zeroDirectCostItem(),
  };
}

export function buildEstimatedCostItem(amountEur: number, costType: DirectCostItem["costType"] = "ONE_TIME_DEVELOPMENT"): DirectCostItem {
  return { amountEur, costType, status: "ESTIMATED", rationale: "test rationale" };
}

export function buildImplementationNoveltyAssessment(
  level: ImplementationNoveltyAssessment["level"] = "LOW",
  confidence = 0.8,
): ImplementationNoveltyAssessment {
  return { level, rationale: "test rationale", evidence: [], confidence };
}

export function buildReusableInnovationAssessment(
  level: ReusableInnovationAssessment["level"] = "NONE",
  confidence = 0.8,
): ReusableInnovationAssessment {
  return { level, rationale: "test rationale", evidence: [], confidence };
}
