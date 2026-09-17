// Shared test-only builders for the DU/Technology-Fit/Effort/Pricing models.
// Not imported by any production code - keeps duEngine.test.ts,
// effortEstimator.test.ts, technologyFitEngine.test.ts, and
// pricingEngine.test.ts from each hand-rolling the same large fixture
// objects.

import { TECHNOLOGY_IDS, TECHNOLOGY_PROFILE_FACTORS, type TechnologyId, type TechnologyProfileFactor } from "../domain/technology.js";
import type {
  DimensionKey,
  DimensionScores,
  EffortEstimate,
  ExistingAssetLeverage,
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

export function buildEffortEstimate(minHours: number, likelyHours: number, maxHours: number): EffortEstimate {
  return {
    minHours,
    likelyHours,
    maxHours,
    confidence: 0.8,
    rationale: { en: "test rationale", de: "Test-Begründung" },
  };
}
