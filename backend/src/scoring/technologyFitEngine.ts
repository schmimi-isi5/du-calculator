// Technology Fit Model (B) - deterministic, fully unit-tested, no LLM calls.
// Turns the AI's TechnologyProfile (what this requirement actually needs)
// and ExistingAssetLeverage (what this repository already gives each
// technology a head start on) into a RelativeEffortFactor per technology,
// scaled against AI_NATIVE's own EffortEstimate corridor.
//
// Anti-bias by construction: every technology (including AI_NATIVE) is
// scored through the exact same formula, using its own CapabilityProfile
// (domain/technology.ts) - there is no special-cased "neutral baseline"
// path for AI_NATIVE. A technology can end up either better or worse than
// AI_NATIVE for a given requirement; both directions are equally reachable.
//
// The core idea: for each technology, compute a "raw effort score" from how
// much this requirement's characteristics (TechnologyProfile, weighted by
// how strongly each one applies) align with that technology's own
// strengths/weaknesses (CapabilityProfile, -1..+1 per characteristic). Lower
// raw score = better fit = less effort. AI_NATIVE's own raw score becomes
// the reference (normalized to a RelativeEffortFactor of 1.0); every other
// technology (and combination) is expressed as a ratio against it - which
// can legitimately land above OR below 1.0.

import type {
  Evidence,
  ExistingAssetLeverage,
  TechnologyAssessment,
  TechnologyNarrative,
  TechnologyProfile,
} from "../domain/types.js";
import {
  ASSET_LEVERAGE_WEIGHT,
  COMBINATION_INTEGRATION_OVERHEAD,
  COMBINATION_OPERATIONAL_OVERHEAD,
  RAW_SCORE_EPSILON,
  RELATIVE_EFFORT_FACTOR_GUARDRAIL_MAX,
  RELATIVE_EFFORT_FACTOR_GUARDRAIL_MIN,
  SUPPORTED_COMBINATIONS,
  TECHNOLOGY_CAPABILITY_PROFILES,
  TECHNOLOGY_IDS,
  TECHNOLOGY_PROFILE_FACTORS,
  type CapabilityProfile,
  type TechnologyId,
  type TechnologyKey,
} from "../domain/technology.js";

const TECHNOLOGY_LABELS: Record<TechnologyKey, string> = {
  AI_NATIVE: "KI-native Individualentwicklung",
  N8N: "n8n (Low-Code/Automatisierung)",
  INTREXX: "Intrexx (Low-Code-Plattform)",
  N8N_INTREXX: "n8n + Intrexx kombiniert",
};

function combinationKey(members: readonly TechnologyId[]): TechnologyKey {
  return members.join("_") as TechnologyKey;
}

function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Weighted capability effect of one technology on this requirement, in
 * -1..+1: each factor's relevance (how strongly it applies here, from the
 * AI's TechnologyProfile score) weights that factor's fixed capability
 * effect for this technology. A requirement where every factor scores 0
 * (AI judged nothing as characterizing it) has no signal either way -
 * treated as perfectly neutral (effect 0), not as "this technology has
 * zero effort".
 */
function weightedCapabilityEffect(profile: TechnologyProfile, capability: CapabilityProfile): number {
  let weightedSum = 0;
  let relevanceSum = 0;
  for (const factor of TECHNOLOGY_PROFILE_FACTORS) {
    const relevance = profile[factor].score / 5;
    weightedSum += relevance * capability[factor];
    relevanceSum += relevance;
  }
  return relevanceSum > 0 ? weightedSum / relevanceSum : 0;
}

/** Raw effort score in [0, 2]: 1 - capabilityEffect. Lower = this technology fits better = less effort. */
function rawEffortScore(profile: TechnologyProfile, capability: CapabilityProfile): number {
  return 1 - weightedCapabilityEffect(profile, capability);
}

/** 0-1 descriptive "how good is the fit" - purely for display, not used in the relativeEffortFactor math (which uses rawEffortScore directly). */
function fitFromRawScore(raw: number): number {
  return clamp(1 - raw / 2, 0, 1);
}

function averageFactorConfidence(profile: TechnologyProfile): number {
  const total = TECHNOLOGY_PROFILE_FACTORS.reduce((sum, factor) => sum + profile[factor].confidence, 0);
  return round2(total / TECHNOLOGY_PROFILE_FACTORS.length);
}

/** Applies this technology's own existing-asset leverage as a discount on its raw score - null/UNKNOWN leverage means no adjustment, never an assumed 0. */
function applyAssetLeverage(raw: number, assetLeverage: number | null): number {
  const effectiveLeverage = assetLeverage ?? 0;
  return Math.max(raw * (1 - effectiveLeverage * ASSET_LEVERAGE_WEIGHT), RAW_SCORE_EPSILON);
}

function topDrivingFactors(profile: TechnologyProfile, capability: CapabilityProfile, count: number) {
  return [...TECHNOLOGY_PROFILE_FACTORS]
    .map((factor) => ({
      factor,
      contribution: (profile[factor].score / 5) * capability[factor],
      evidence: profile[factor].evidence,
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, count);
}

const FACTOR_LABELS_DE: Record<(typeof TECHNOLOGY_PROFILE_FACTORS)[number], string> = {
  uiForms: "Formulare/UI",
  crudDataManagement: "CRUD-/Datenverwaltung",
  workflowOrchestration: "Workflow-Orchestrierung",
  standardConnectors: "Standard-Konnektoren",
  customIntegrations: "individuelle Integrationen",
  customBusinessLogic: "individuelle Fachlogik",
  aiAgentsRag: "KI-Agenten/RAG",
  complexStateManagement: "komplexes State-Management",
  customAlgorithms: "individuelle Algorithmen",
  testingRequirements: "Testanforderungen",
  deploymentComplexity: "Deployment-Komplexität",
  expectedChangeFrequency: "erwartete Änderungshäufigkeit",
};

function buildRationale(technology: TechnologyKey, profile: TechnologyProfile, capability: CapabilityProfile): string {
  const driving = topDrivingFactors(profile, capability, 2).map((d) => FACTOR_LABELS_DE[d.factor]);
  if (technology === "AI_NATIVE") {
    return `Referenzwert - v. a. geprägt durch ${driving.join(" und ")}.`;
  }
  return `Grobe Schätzung: v. a. geprägt durch ${driving.join(" und ")} - relativ zur AI-nativen Individualentwicklung (Referenz).`;
}

function evidenceFor(profile: TechnologyProfile, capability: CapabilityProfile, assetEvidence: Evidence[]): Evidence[] {
  const driving = topDrivingFactors(profile, capability, 2).flatMap((d) => d.evidence);
  return [...assetEvidence, ...driving];
}

function findLeverage(list: ExistingAssetLeverage[], technology: TechnologyId): ExistingAssetLeverage | undefined {
  return list.find((l) => l.technology === technology);
}

function findNarrative(list: TechnologyNarrative[], technology: TechnologyId): TechnologyNarrative | undefined {
  return list.find((n) => n.technology === technology);
}

interface EffortCorridor {
  minHours: number;
  likelyHours: number;
  maxHours: number;
}

function scaledCorridor(reference: EffortCorridor, relativeEffortFactor: number): TechnologyAssessment["estimatedHours"] {
  return {
    minHours: round1(reference.minHours * relativeEffortFactor),
    likelyHours: round1(reference.likelyHours * relativeEffortFactor),
    maxHours: round1(reference.maxHours * relativeEffortFactor),
  };
}

/**
 * Builds the full technology comparison: one row per TECHNOLOGY_IDS entry,
 * plus one row per SUPPORTED_COMBINATIONS entry. AI_NATIVE's row always has
 * relativeEffortFactor exactly 1.0 by construction - every other row is
 * genuinely free to land above or below it.
 */
export function buildTechnologyComparison(
  profile: TechnologyProfile,
  existingAssetLeverage: ExistingAssetLeverage[],
  technologyNarratives: TechnologyNarrative[],
  aiNativeEffort: EffortCorridor,
): TechnologyAssessment[] {
  const rawScores = new Map<TechnologyId, number>();
  const adjustedScores = new Map<TechnologyId, number>();

  for (const technology of TECHNOLOGY_IDS) {
    const capability = TECHNOLOGY_CAPABILITY_PROFILES[technology];
    const raw = rawEffortScore(profile, capability);
    rawScores.set(technology, raw);
    const leverage = findLeverage(existingAssetLeverage, technology);
    adjustedScores.set(technology, applyAssetLeverage(raw, leverage?.assetLeverage ?? null));
  }

  const aiNativeAdjusted = adjustedScores.get("AI_NATIVE")!;
  const fitConfidence = averageFactorConfidence(profile);

  const singleRows: TechnologyAssessment[] = TECHNOLOGY_IDS.map((technology) => {
    const capability = TECHNOLOGY_CAPABILITY_PROFILES[technology];
    const raw = rawScores.get(technology)!;
    const adjusted = adjustedScores.get(technology)!;
    const relativeEffortFactor =
      technology === "AI_NATIVE"
        ? 1
        : clamp(adjusted / aiNativeAdjusted, RELATIVE_EFFORT_FACTOR_GUARDRAIL_MIN, RELATIVE_EFFORT_FACTOR_GUARDRAIL_MAX);
    const leverage = findLeverage(existingAssetLeverage, technology);
    const narrative = findNarrative(technologyNarratives, technology);

    return {
      technology,
      label: TECHNOLOGY_LABELS[technology],
      fit: round2(fitFromRawScore(raw)),
      fitConfidence,
      assetLeverage: leverage?.assetLeverage ?? null,
      assetLeverageConfidence: leverage?.confidence ?? null,
      integrationOverhead: 0,
      operationalOverhead: 0,
      relativeEffortFactor: round2(relativeEffortFactor),
      estimatedHours: scaledCorridor(aiNativeEffort, relativeEffortFactor),
      advantages: narrative?.advantages ?? [],
      disadvantages: narrative?.disadvantages ?? [],
      evidence: evidenceFor(profile, capability, leverage?.evidence ?? []),
      rationale: buildRationale(technology, profile, capability),
    };
  });

  const combinationRows: TechnologyAssessment[] = SUPPORTED_COMBINATIONS.map((members) =>
    buildCombinationRow(members, profile, existingAssetLeverage, technologyNarratives, aiNativeAdjusted, aiNativeEffort),
  );

  return [...singleRows, ...combinationRows];
}

/**
 * A combination's per-factor capability is the best of its members
 * (playing to each platform's individual strengths), but that best-of
 * result is never free: COMBINATION_INTEGRATION_OVERHEAD/
 * COMBINATION_OPERATIONAL_OVERHEAD are added on top, so a combination is
 * never automatically better than both individual technologies - only
 * allowed to be, once its own real integration/operational cost is
 * accounted for.
 */
function buildCombinationRow(
  members: readonly TechnologyId[],
  profile: TechnologyProfile,
  existingAssetLeverage: ExistingAssetLeverage[],
  technologyNarratives: TechnologyNarrative[],
  aiNativeAdjusted: number,
  aiNativeEffort: EffortCorridor,
): TechnologyAssessment {
  const key = combinationKey(members);
  const combinedCapability = Object.fromEntries(
    TECHNOLOGY_PROFILE_FACTORS.map((factor) => [
      factor,
      Math.max(...members.map((m) => TECHNOLOGY_CAPABILITY_PROFILES[m][factor])),
    ]),
  ) as CapabilityProfile;

  const rawBeforeOverhead = rawEffortScore(profile, combinedCapability);
  const rawWithOverhead = rawBeforeOverhead * (1 + COMBINATION_INTEGRATION_OVERHEAD + COMBINATION_OPERATIONAL_OVERHEAD);

  const memberLeverages = members
    .map((m) => findLeverage(existingAssetLeverage, m)?.assetLeverage)
    .filter((v): v is number => v !== null && v !== undefined);
  const combinedLeverage = memberLeverages.length > 0 ? memberLeverages.reduce((a, b) => a + b, 0) / memberLeverages.length : null;
  const memberLeverageConfidences = members
    .map((m) => findLeverage(existingAssetLeverage, m)?.confidence)
    .filter((v): v is number => v !== undefined);
  const combinedLeverageConfidence =
    memberLeverageConfidences.length > 0
      ? round2(memberLeverageConfidences.reduce((a, b) => a + b, 0) / memberLeverageConfidences.length)
      : null;

  const adjustedWithOverhead = applyAssetLeverage(rawWithOverhead, combinedLeverage);
  const relativeEffortFactor = clamp(
    adjustedWithOverhead / aiNativeAdjusted,
    RELATIVE_EFFORT_FACTOR_GUARDRAIL_MIN,
    RELATIVE_EFFORT_FACTOR_GUARDRAIL_MAX,
  );

  const combinedEvidence = members.flatMap((m) => findLeverage(existingAssetLeverage, m)?.evidence ?? []);
  const combinedAdvantages = members.flatMap((m) => findNarrative(technologyNarratives, m)?.advantages ?? []);
  const driving = topDrivingFactors(profile, combinedCapability, 2).map((d) => FACTOR_LABELS_DE[d.factor]);

  return {
    technology: key,
    label: TECHNOLOGY_LABELS[key],
    fit: round2(fitFromRawScore(rawBeforeOverhead)),
    fitConfidence: averageFactorConfidence(profile),
    assetLeverage: combinedLeverage,
    assetLeverageConfidence: combinedLeverageConfidence,
    integrationOverhead: COMBINATION_INTEGRATION_OVERHEAD,
    operationalOverhead: COMBINATION_OPERATIONAL_OVERHEAD,
    relativeEffortFactor: round2(relativeEffortFactor),
    estimatedHours: scaledCorridor(aiNativeEffort, relativeEffortFactor),
    advantages: combinedAdvantages,
    disadvantages: [],
    evidence: [...combinedEvidence, ...topDrivingFactors(profile, combinedCapability, 2).flatMap((d) => d.evidence)],
    rationale: `Grobe Schätzung: nutzt jeweils die stärkere Einzeltechnologie pro Bereich - v. a. ${driving.join(
      " und ",
    )} - abzüglich Integrations-/Betriebsaufwand für die Kombination zweier Systeme.`,
  };
}
