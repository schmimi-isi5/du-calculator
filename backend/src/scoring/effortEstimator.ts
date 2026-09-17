// Effort Model (C) - bottom-up human-effort estimation (effort-bottom-up-v1).
// Deterministic, fully unit-tested, no LLM calls. The AI (see
// ai/prompts.ts EFFORT_WORK_BREAKDOWN_RULE) identifies concrete Work
// Packages and estimates HUMAN effort (min/likely/max hours + confidence)
// per package, grounded in the Requirement Impact Analysis and repository
// evidence. This module aggregates that raw output into the app's
// EffortEstimate deterministically - the AI never states an independent
// total; "AI analyzes and estimates components, application aggregates
// deterministically."
//
// Previously (technology-fit-v2 / commercial-du-v1 / commercial-du-v2) this
// module only validated/normalized a single AI-provided min/likely/max
// corridor for the WHOLE requirement. That corridor was not explainable -
// there was no way to see what drove the number, verify it against the
// repository, or later work out which KINDS of work the AI systematically
// under/overestimates. Bottom-up aggregation replaces it while keeping the
// exact same EffortEstimate contract every downstream consumer (Technology
// Fit, Commercial Model, Pricing, the UI) already relies on.

import {
  EFFORT_CALCULATION_METHOD,
  EFFORT_CALCULATION_MODEL_VERSION,
  LARGE_WORK_PACKAGE_THRESHOLD_HOURS,
  LOW_EVIDENCE_UNKNOWN_COUNT_THRESHOLD,
  type EffortSanityFlag,
} from "../domain/effort.js";
import type {
  EffortEstimate,
  EffortWorkBreakdown,
  EffortWorkBreakdownOutput,
  EffortWorkPackage,
  EffortWorkPackageInput,
  HumanEffortCorridor,
} from "../domain/types.js";

function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Rounds a Work Package's own corridor and repairs an inconsistent one (the
 * AI outputting minHours > likelyHours, or maxHours < likelyHours) by
 * widening it just enough to stay internally consistent - the same
 * defensive normalization the old whole-requirement corridor got, now
 * applied per Work Package.
 */
function normalizeCorridor(raw: HumanEffortCorridor): HumanEffortCorridor {
  const likelyHours = round1(raw.likelyHours);
  const minHours = round1(Math.min(raw.minHours, likelyHours));
  const maxHours = round1(Math.max(raw.maxHours, likelyHours));
  return { minHours, likelyHours, maxHours };
}

function normalizeWorkPackage(raw: EffortWorkPackageInput): EffortWorkPackage {
  const humanEffort = normalizeCorridor(raw.humanEffort);
  return {
    ...raw,
    humanEffort,
    isLargeWorkPackage: humanEffort.likelyHours > LARGE_WORK_PACKAGE_THRESHOLD_HOURS,
  };
}

/** Deterministic sum - never re-estimated by the AI. Personnel hours are always added, even for Work Packages that could run in parallel (spec: this estimates personal effort, not calendar/lead time). */
function aggregateTotals(workPackages: EffortWorkPackage[]): HumanEffortCorridor {
  return {
    minHours: round1(workPackages.reduce((sum, wp) => sum + wp.humanEffort.minHours, 0)),
    likelyHours: round1(workPackages.reduce((sum, wp) => sum + wp.humanEffort.likelyHours, 0)),
    maxHours: round1(workPackages.reduce((sum, wp) => sum + wp.humanEffort.maxHours, 0)),
  };
}

/**
 * Weighted mean of each Work Package's confidence, weighted by its own
 * share of total likely hours - a large, uncertain package should move the
 * overall confidence more than a small one (spec section 18). Returns 0 as
 * the "clean fallback" when totalLikelyHours is 0 (no meaningful weights
 * exist) - never a hidden independent AI-provided overall confidence.
 */
function aggregateConfidence(workPackages: EffortWorkPackage[], totalLikelyHours: number): number {
  if (totalLikelyHours <= 0) return 0;
  const weighted = workPackages.reduce(
    (sum, wp) => sum + wp.confidence * (wp.humanEffort.likelyHours / totalLikelyHours),
    0,
  );
  return round2(weighted);
}

function countUnknownEvidence(workPackages: EffortWorkPackage[]): number {
  return workPackages.reduce(
    (count, wp) => count + wp.repositoryEvidence.filter((e) => e.status === "UNKNOWN").length,
    0,
  );
}

/** A Work Package that changes code (CREATE/MODIFY, outside TESTING_QA/DOCUMENTATION itself) with no TESTING_QA package anywhere in the breakdown - a plausibility nudge, never a forced addition (spec section 22: not every category must produce a package). */
function hasCodeChangeWithoutTesting(workPackages: EffortWorkPackage[]): boolean {
  const hasCodeChange = workPackages.some(
    (wp) =>
      (wp.action === "CREATE" || wp.action === "MODIFY") &&
      wp.category !== "TESTING_QA" &&
      wp.category !== "DOCUMENTATION",
  );
  const hasTesting = workPackages.some((wp) => wp.category === "TESTING_QA");
  return hasCodeChange && !hasTesting;
}

/**
 * The Sanity Check (spec section 45) - flags only, never a hidden hours
 * change. Every flag here must be independently justifiable from the
 * normalized Work Packages/completeness assessment alone, never a numeric
 * side effect of the aggregation above.
 */
function computeSanityFlags(
  workPackages: EffortWorkPackage[],
  completeness: EffortWorkBreakdownOutput["completenessAssessment"],
  overallConfidence: number,
): EffortSanityFlag[] {
  const flags = new Set<EffortSanityFlag>();

  if (workPackages.some((wp) => wp.isLargeWorkPackage)) flags.add("LARGE_WORK_PACKAGE");
  if (countUnknownEvidence(workPackages) >= LOW_EVIDENCE_UNKNOWN_COUNT_THRESHOLD) flags.add("LOW_EVIDENCE");
  if (hasCodeChangeWithoutTesting(workPackages)) flags.add("POSSIBLE_MISSING_TESTING");
  if (completeness.overlapWarnings.length > 0) flags.add("POSSIBLE_OVERLAP");
  // General "have a human double-check this" nudge - unusually few Work
  // Packages for a real requirement, the AI's own completeness check came
  // back incomplete, or overall confidence is very low.
  if (workPackages.length === 1 || !completeness.complete || overallConfidence < 0.5) {
    flags.add("EFFORT_REVIEW_RECOMMENDED");
  }

  return Array.from(flags);
}

function buildAggregateRationale(workPackages: EffortWorkPackage[], totals: HumanEffortCorridor): EffortEstimate["rationale"] {
  const count = workPackages.length;
  return {
    en: `Bottom-up aggregation from ${count} work package${count === 1 ? "" : "s"}: ${totals.minHours}-${totals.maxHours}h, likely ${totals.likelyHours}h. See the work breakdown for the per-package reasoning.`,
    de: `Bottom-up aggregiert aus ${count} Arbeitspaket${count === 1 ? "" : "en"}: ${totals.minHours}-${totals.maxHours} Std., wahrscheinlich ${totals.likelyHours} Std. Details siehe Aufwandsschätzung je Arbeitspaket.`,
  };
}

/**
 * Turns the AI's raw Work Package breakdown into the app's EffortEstimate -
 * the ONLY place totals/overall confidence for the Effort Model are
 * computed. See domain/types.ts EffortEstimate/EffortWorkBreakdown for the
 * exact contract.
 */
export function buildEffortEstimateFromWorkPackages(raw: EffortWorkBreakdownOutput): EffortEstimate {
  const workPackages = raw.workPackages.map(normalizeWorkPackage);
  const totals = aggregateTotals(workPackages);
  const overallConfidence = aggregateConfidence(workPackages, totals.likelyHours);
  const flags = computeSanityFlags(workPackages, raw.completenessAssessment, overallConfidence);

  const workBreakdown: EffortWorkBreakdown = {
    workPackages,
    completenessAssessment: raw.completenessAssessment,
    clarificationsRequired: raw.clarificationsRequired,
    generalAssumptions: raw.generalAssumptions,
    calculationMethod: EFFORT_CALCULATION_METHOD,
    calculationModelVersion: EFFORT_CALCULATION_MODEL_VERSION,
    flags,
  };

  return {
    minHours: totals.minHours,
    likelyHours: totals.likelyHours,
    maxHours: totals.maxHours,
    confidence: overallConfidence,
    rationale: buildAggregateRationale(workPackages, totals),
    workBreakdown,
  };
}
