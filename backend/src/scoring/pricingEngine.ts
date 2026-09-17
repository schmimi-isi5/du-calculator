// Pricing Model (D) - deliberately decoupled from the Effort Model (C) and
// the DU Model (A). Price and production effort are different questions:
// how much a customer is charged is a commercial decision, not a mechanical
// consequence of how many hours or Development Units something took. See
// config.ts PRICING_STRATEGY/PRICE_PER_DU/BILLING_RATE_PER_HOUR.

import type { PricingStrategy } from "../domain/types.js";

/** Round to 2 decimal places without floating-point drift (e.g. 2.0000000000004). */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface PricingInput {
  /** null for XXL (no artificially precise DU count) - DU_FIXED_PRICE then has nothing to multiply and returns null. */
  developmentUnits: number | null;
  /** AI_NATIVE's own likely-hours estimate (scoring/effortEstimator.ts) - always available once scoring succeeds, independent of DU class. */
  likelyHours: number;
}

export interface PricingConfig {
  billingRatePerHour: number | null;
  pricePerDU: number | null;
}

/**
 * HOURLY: price tracks AI_NATIVE's own effort estimate directly - the
 * implied hourly rate always exactly equals billingRatePerHour, for every
 * DU class, by construction.
 * DU_FIXED_PRICE: a purely commercial calibration figure per DU, with no
 * implied hours-per-DU conversion - null for XXL, since developmentUnits
 * itself is null there.
 */
export function computePrice(strategy: PricingStrategy, input: PricingInput, config: PricingConfig): number | null {
  if (strategy === "HOURLY") {
    if (config.billingRatePerHour === null) return null;
    return round2(input.likelyHours * config.billingRatePerHour);
  }

  // DU_FIXED_PRICE
  if (config.pricePerDU === null || input.developmentUnits === null) return null;
  return round2(input.developmentUnits * config.pricePerDU);
}
