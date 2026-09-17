// Builds the narrow, customer-safe projection of a ScoringResult served by
// the public, unauthenticated share link (GET /api/requirement/:id/customer-report).
// This is the ONLY place allowed to decide what a customer may see - never
// duplicate this field list anywhere else, and never widen it without
// re-checking domain/types.ts CustomerReport's own doc comment on why each
// field is safe to expose without a login.

import type { CustomerReport, DirectCostEstimate, ScoringResult } from "../domain/types.js";

/** Only RECURRING_RUNTIME (or BOTH) items - a customer-facing "ongoing cost" disclosure, distinct from the internal Commercial DU cost adjustment (which uses ONE_TIME_DEVELOPMENT costs only and is never exposed here). */
function extractRuntimeCosts(directCosts: DirectCostEstimate | undefined): CustomerReport["runtimeCosts"] {
  if (!directCosts) return [];
  const entries: [string, DirectCostEstimate[keyof DirectCostEstimate]][] = [
    ["KI/API-Nutzung", directCosts.aiApiCost],
    ["Infrastruktur", directCosts.infrastructureCost],
    ["Third-Party", directCosts.thirdPartyCost],
    ["Sonstiges", directCosts.otherDirectCost],
  ];
  return entries
    .filter(([, item]) => item.costType === "RECURRING_RUNTIME" || item.costType === "BOTH")
    .map(([label, item]) => ({ label, amountEur: item.amountEur, status: item.status }));
}

/**
 * Returns null when there is nothing shareable yet - no duResult (still
 * analyzing, errored, or withheld for low confidence) means there is no
 * customer-safe report to build. The caller (requirementRoutes.ts) turns
 * that into a 404/409, never a report with fabricated numbers.
 */
export function buildCustomerReport(result: ScoringResult): CustomerReport | null {
  const du = result.duResult;
  if (!du) return null;

  return {
    scoringId: result.id,
    requirement: { title: result.requirement.title, description: result.requirement.description },
    price: du.price,
    pricingStrategy: du.pricingStrategy,
    isRoughEstimate: du.isRoughEstimate,
    duClass: du.duClass,
    developmentUnits: du.commercialDevelopmentUnits ?? du.developmentUnits,
    overallConfidence: du.overallConfidence,
    confidenceLevel: du.confidenceLevel,
    created: result.impactAnalysis?.create ?? [],
    modified: result.impactAnalysis?.modify ?? [],
    reused: result.impactAnalysis?.reusable ?? [],
    technologyComparison: (du.technologyComparison ?? []).map((t) => ({
      technology: t.technology,
      label: t.label,
      relativeEffortFactor: t.relativeEffortFactor,
      advantages: t.advantages,
      disadvantages: t.disadvantages,
    })),
    runtimeCosts: extractRuntimeCosts(du.directCosts),
    suggestedDecomposition: result.impactAnalysis?.suggestedDecomposition ?? [],
    overallAssessment: result.overallAssessment,
  };
}
