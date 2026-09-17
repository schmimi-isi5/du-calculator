// Derives an internal effort estimate (hours) and an alternative-approach
// comparison (low-code/no-code vs. classical development) from a scored
// requirement. Kept separate from duEngine.ts (which computes DU/class/price
// only) because this is a distinct translation layer: how much internal
// time this might cost, and how well-suited it is to a platform other than
// custom code.
//
// totalHours comes from the AI's own ImplementationEstimate - an
// independent, experience-based judgment (domain/schemas.ts
// ImplementationEstimateSchema), deliberately NOT derived from the DU
// dimension scores or a DU/hours formula. A DU class of "L" says nothing
// about how long an "L" actually takes to build; only the AI's own estimate
// of THIS requirement's implementation effort does. hoursPerDU (config.ts
// HOURS_PER_DU) is kept only as a rough, independent cross-check reference
// (referenceHoursFromDU/hasSignificantDeviationFromDuReference) - it is
// never used to compute totalHours, and a deviation from it is a signal to
// review, not something the app "corrects" automatically.
//
// PLATFORM_DIMENSION_FIT below is a separate, explicit business assumption:
// a documented, reviewable judgment call about what n8n/Intrexx are
// generally good and bad at, not measured data for this specific
// requirement. It should be tuned by someone who actually knows these
// platforms well, not treated as verified.

import type {
  AlternativeApproachEstimate,
  AlternativeApproachId,
  DimensionKey,
  DimensionScores,
  ImplementationEstimate,
  TimeEstimate,
} from "../domain/types.js";
import { DIMENSION_KEYS } from "../domain/types.js";
import { DIMENSION_WEIGHTS } from "./duEngine.js";

/** Round to 1 decimal place - hours are an estimate, not a precise figure. */
function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

/** Round to 2 decimal places - used for relativeEffort fractions (0-1). */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// How far the AI's independent estimate may diverge from the old DU-based
// reference before it's flagged for review - a difference this large means
// the two models of "how big this is" (scope/complexity/risk vs. actual
// implementation time) disagree enough to be worth a second look, not
// something to silently reconcile.
const SIGNIFICANT_DEVIATION_THRESHOLD = 0.5;

/**
 * totalHours is the AI's own estimate, taken as-is. The prompting/
 * development split IS still computed deterministically here, from how
 * much of the requirement's weighted score the aiComplexity dimension
 * accounts for - a requirement the AI itself scored as AI-heavy gets a
 * proportionally larger prompting share, rather than an arbitrary fixed
 * split. referenceHoursFromDU is a separate, DU-based sanity-check figure,
 * never used to adjust totalHours.
 */
export function estimateTime(
  implementationEstimate: ImplementationEstimate,
  scores: DimensionScores,
  developmentUnits: number,
  hoursPerDU: number,
): TimeEstimate {
  const totalHours = implementationEstimate.estimatedHours;
  const weightedScore = DIMENSION_KEYS.reduce((sum, key) => sum + scores[key].score * DIMENSION_WEIGHTS[key], 0);
  const aiComplexityContribution = (scores.aiComplexity.score * DIMENSION_WEIGHTS.aiComplexity) / weightedScore;
  const promptingHours = round1(totalHours * aiComplexityContribution);
  const referenceHoursFromDU = round1(developmentUnits * hoursPerDU);
  const hasSignificantDeviationFromDuReference =
    referenceHoursFromDU > 0
      ? Math.abs(totalHours - referenceHoursFromDU) / referenceHoursFromDU > SIGNIFICANT_DEVIATION_THRESHOLD
      : totalHours > 0;

  return {
    totalHours: round1(totalHours),
    promptingHours,
    developmentHours: round1(totalHours - promptingHours),
    rationale: implementationEstimate.rationale,
    referenceHoursFromDU,
    hoursPerDU,
    hasSignificantDeviationFromDuReference,
  };
}

const APPROACH_LABELS: Record<AlternativeApproachId, string> = {
  classicalDevelopment: "Klassische Entwicklung",
  n8n: "n8n (Low-Code/Automatisierung)",
  intrexx: "Intrexx (Low-Code-Plattform)",
  n8nIntrexxCombined: "n8n + Intrexx kombiniert",
};

// How well-suited each platform generally is per dimension (0 = no benefit,
// must be custom-built like classical development; 1 = near-effortless on
// that platform relative to custom code). Rough, general-knowledge
// assumptions about these platforms' typical strengths/weaknesses - not
// specific to any one requirement, and not verified against either
// platform's actual current capabilities. Review and tune before relying on
// this for a real customer-facing comparison.
const PLATFORM_DIMENSION_FIT: Record<"n8n" | "intrexx", Record<DimensionKey, number>> = {
  n8n: {
    functionalScope: 0.3,
    technicalComplexity: 0.2,
    dataIntegration: 0.6,
    aiComplexity: 0.35,
    automation: 0.85,
    testingQA: 0.2,
    deploymentOperations: 0.5,
    uncertaintyRisk: 0.2,
  },
  intrexx: {
    functionalScope: 0.7,
    technicalComplexity: 0.25,
    dataIntegration: 0.65,
    aiComplexity: 0.15,
    automation: 0.55,
    testingQA: 0.3,
    deploymentOperations: 0.6,
    uncertaintyRisk: 0.25,
  },
};

// Even a perfect-fit requirement still needs requirements analysis,
// platform configuration, testing, and deployment glue work - capped so
// this estimator never implies a platform eliminates effort entirely.
const MAX_DISCOUNT = 0.7;
const MIN_RELATIVE_EFFORT = 1 - MAX_DISCOUNT;

/**
 * Weighted "how well does this platform fit THIS requirement's actual
 * complexity profile" - each dimension's own score (how much of this
 * requirement's difficulty lives there) times its fixed importance weight
 * times the platform's general fit for that dimension, normalized to 0-1.
 */
function weightedFit(scores: DimensionScores, fit: Record<DimensionKey, number>): number {
  let weightedFitSum = 0;
  let weightSum = 0;
  for (const key of DIMENSION_KEYS) {
    const dimensionWeight = (scores[key].score / 5) * DIMENSION_WEIGHTS[key];
    weightedFitSum += dimensionWeight * fit[key];
    weightSum += dimensionWeight;
  }
  return weightSum > 0 ? weightedFitSum / weightSum : 0;
}

function topDrivingDimensions(scores: DimensionScores, fit: Record<DimensionKey, number>, count: number): DimensionKey[] {
  return [...DIMENSION_KEYS]
    .sort((a, b) => scores[b].score * fit[b] - scores[a].score * fit[a])
    .slice(0, count);
}

const DIMENSION_LABELS_DE: Record<DimensionKey, string> = {
  functionalScope: "funktionaler Umfang",
  technicalComplexity: "technische Komplexität",
  dataIntegration: "Daten & Integration",
  aiComplexity: "KI-Komplexität",
  automation: "Automatisierung",
  testingQA: "Testing & QA",
  deploymentOperations: "Deployment & Operations",
  uncertaintyRisk: "Unsicherheit/Risiko",
};

function buildEstimate(
  id: "n8n" | "intrexx",
  scores: DimensionScores,
  classicalHours: number,
): AlternativeApproachEstimate {
  const fit = PLATFORM_DIMENSION_FIT[id];
  const fitScore = weightedFit(scores, fit);
  const relativeEffort = Math.max(MIN_RELATIVE_EFFORT, round2(1 - fitScore * MAX_DISCOUNT));
  const driving = topDrivingDimensions(scores, fit, 2).map((k) => DIMENSION_LABELS_DE[k]);

  return {
    id,
    label: APPROACH_LABELS[id],
    relativeEffort,
    estimatedHours: round1(classicalHours * relativeEffort),
    rationale: `Grobe Schätzung: v. a. geprägt durch ${driving.join(" und ")} - Faktor ${(relativeEffort * 100).toFixed(0)}% des klassischen Aufwands.`,
  };
}

/**
 * Compares classical development against n8n, Intrexx, and both combined
 * (the per-dimension better of the two, since combining plays to each
 * platform's individual strengths). classicalDevelopment itself always has
 * relativeEffort 1.0 - it IS the baseline this app's own time estimate
 * already represents.
 */
export function estimateAlternativeApproaches(
  scores: DimensionScores,
  timeEstimate: TimeEstimate,
): AlternativeApproachEstimate[] {
  const classical: AlternativeApproachEstimate = {
    id: "classicalDevelopment",
    label: APPROACH_LABELS.classicalDevelopment,
    relativeEffort: 1,
    estimatedHours: timeEstimate.totalHours,
    rationale: "Basiswert - die reguläre DU-/Zeitschätzung dieser Anforderung.",
  };

  const n8n = buildEstimate("n8n", scores, timeEstimate.totalHours);
  const intrexx = buildEstimate("intrexx", scores, timeEstimate.totalHours);

  const combinedFit: Record<DimensionKey, number> = Object.fromEntries(
    DIMENSION_KEYS.map((key) => [key, Math.max(PLATFORM_DIMENSION_FIT.n8n[key], PLATFORM_DIMENSION_FIT.intrexx[key])]),
  ) as Record<DimensionKey, number>;
  const combinedFitScore = weightedFit(scores, combinedFit);
  const combinedRelativeEffort = Math.max(MIN_RELATIVE_EFFORT, round2(1 - combinedFitScore * MAX_DISCOUNT));
  const combinedDriving = topDrivingDimensions(scores, combinedFit, 2).map((k) => DIMENSION_LABELS_DE[k]);
  const combined: AlternativeApproachEstimate = {
    id: "n8nIntrexxCombined",
    label: APPROACH_LABELS.n8nIntrexxCombined,
    relativeEffort: combinedRelativeEffort,
    estimatedHours: round1(timeEstimate.totalHours * combinedRelativeEffort),
    rationale: `Grobe Schätzung: nutzt jeweils die stärkere Plattform pro Bereich - v. a. ${combinedDriving.join(" und ")} - Faktor ${(combinedRelativeEffort * 100).toFixed(0)}% des klassischen Aufwands.`,
  };

  return [classical, n8n, intrexx, combined];
}
