// Turns the single QualityLevel choice for a run into every concrete tuning
// knob it affects - effort per AI call, how many clarification questions/
// rounds are allowed, and an extra prompt instruction that asks the model to
// actually write shorter or more thorough rationale (the level is meant to
// change what's visible in the output, not just internal "thinking" time).
//
// Deliberately excludes repository-analysis depth: the file excerpts a
// snapshot was analyzed with are fixed at analysis time and reused across
// every requirement scored against it (see RepositoryContextBuilder.ts) -
// there is no "per assessment" lever over content that was already read
// before this requirement existed.

import type { QualityLevel } from "./types.js";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface QualityProfile {
  /** Effort for AIProvider.resolveRequirementContext calls (classification/extraction-shaped work). */
  resolutionEffort: EffortLevel;
  /** Effort for AIProvider.assessRequirement calls - the one step where nuanced judgment directly drives the DU result. */
  assessmentEffort: EffortLevel;
  /** How many clarification questions may be asked in a single round. */
  maxClarificationsPerRound: number;
  /** How many resolution rounds may ever ask a new question before the run finalizes on facts/assumptions gathered so far. */
  maxResolutionRounds: number;
  /** Appended to the assessment system prompt - asks the model to visibly scale rationale depth, not just internal effort. */
  rationaleGuidance: string;
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  quick: {
    resolutionEffort: "low",
    assessmentEffort: "medium",
    maxClarificationsPerRound: 1,
    maxResolutionRounds: 1,
    rationaleGuidance:
      "This is a quick, rough estimate (Grobschätzung) - keep every summary and rationale concise (a few sentences), still evidence-based, but do not exhaustively enumerate every file or edge case.",
  },
  standard: {
    resolutionEffort: "medium",
    assessmentEffort: "high",
    maxClarificationsPerRound: 2,
    maxResolutionRounds: 2,
    rationaleGuidance:
      "This is a standard estimate (Standardschätzung) - balance thoroughness and concision: cover the material evidence and reasoning without padding.",
  },
  thorough: {
    resolutionEffort: "high",
    assessmentEffort: "xhigh",
    maxClarificationsPerRound: 3,
    maxResolutionRounds: 3,
    rationaleGuidance:
      "This is a detailed estimate (Feinschätzung) - be especially thorough: cite more supporting evidence per dimension, spell out edge cases and alternative interpretations you considered, and give the fullest defensible rationale for each score.",
  },
};

export const DEFAULT_QUALITY_LEVEL: QualityLevel = "standard";

export function isQualityLevel(value: unknown): value is QualityLevel {
  return value === "quick" || value === "standard" || value === "thorough";
}
