// Derives an internal effort estimate (hours) and an alternative-approach
// comparison (low-code/no-code vs. classical development) from a scored
// requirement's DU result. Kept separate from duEngine.ts (which computes
// DU/class/price only) because this is a distinct, more speculative
// translation layer: how much internal time this might cost, and how
// well-suited it is to a platform other than custom code.
//
// Every number here is an explicit business assumption or a rough,
// evidence-weighted estimate, never a fact and never invented by the AI:
// - hoursPerDU is an operator-configured constant (config.ts HOURS_PER_DU),
//   not a measured rate - there is no fixed DU-to-hours conversion.
// - PLATFORM_DIMENSION_FIT is a documented, reviewable judgment call about
//   what n8n/Intrexx are generally good and bad at, not measured data for
//   this specific requirement. It should be tuned by someone who actually
//   knows these platforms well, not treated as verified.
// The AI itself is never consulted for any of this - it only ever produces
// the per-dimension scores these estimates are computed from.

import type {
  AlternativeApproachEstimate,
  AlternativeApproachId,
  DimensionKey,
  DimensionScores,
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

/**
 * Splits total estimated hours into "Prompting-Zeit" (designing, tuning,
 * and validating AI prompts/behavior) and "Entwicklungszeit" (everything
 * else) by how much of the requirement's own weighted score the
 * aiComplexity dimension accounts for - a requirement the AI itself scored
 * as AI-heavy gets a proportionally larger prompting share, rather than an
 * arbitrary fixed split.
 */
export function estimateTime(developmentUnits: number, scores: DimensionScores, hoursPerDU: number): TimeEstimate {
  const totalHours = developmentUnits * hoursPerDU;
  const weightedScore = DIMENSION_KEYS.reduce((sum, key) => sum + scores[key].score * DIMENSION_WEIGHTS[key], 0);
  const aiComplexityContribution = (scores.aiComplexity.score * DIMENSION_WEIGHTS.aiComplexity) / weightedScore;
  const promptingHours = round1(totalHours * aiComplexityContribution);

  return {
    totalHours: round1(totalHours),
    promptingHours,
    developmentHours: round1(totalHours - promptingHours),
    hoursPerDU,
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
