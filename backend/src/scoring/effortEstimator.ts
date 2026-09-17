// Effort Model (C) - AI_NATIVE's own human-effort corridor. Deliberately
// thin: the AI already produces the min/likely/max estimate directly
// (domain/schemas.ts EffortEstimateSchema) as an independent professional
// judgment, NOT derived from the DU dimension scores or any DU/hours
// formula (see domain/types.ts EffortEstimate and duEngine.ts, which no
// longer feeds developmentUnits into this at all). This module only
// validates/normalizes that corridor - it does not compute effort itself.
//
// This used to also compute a prompting-hours/development-hours split from
// how much of the weighted score the aiComplexity dimension accounted for.
// That was removed: a high aiComplexity score does not necessarily mean
// more prompting time (aiComplexity can come from RAG, tool calling,
// evaluation, agent architecture, guardrails, data prep, observability,
// model integration, ...), so deriving a time split from it was not
// defensible. The corridor is now shown as one total human-effort range;
// see the Technology Fit Model (technologyFitEngine.ts) for how other
// technologies' hours are derived from it.

import type { EffortEstimate } from "../domain/types.js";

function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

/**
 * Normalizes the AI's raw EffortEstimate into the app's EffortEstimate:
 * rounds to a sane precision and repairs an inconsistent corridor (e.g. the
 * model outputting minHours > likelyHours) by widening it just enough to
 * stay internally consistent, rather than silently reordering or
 * discarding a value - this should be rare, and is a defensive normalization
 * step, not a redesign of the AI's estimate.
 */
export function buildEffortEstimate(raw: EffortEstimate): EffortEstimate {
  const likelyHours = round1(raw.likelyHours);
  const minHours = round1(Math.min(raw.minHours, likelyHours));
  const maxHours = round1(Math.max(raw.maxHours, likelyHours));

  return {
    minHours,
    likelyHours,
    maxHours,
    confidence: raw.confidence,
    rationale: raw.rationale,
  };
}
