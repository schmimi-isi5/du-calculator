// Pricing Model (E) - deliberately decoupled from the Effort Model (C) and
// the Commercial Model (D). Price and production effort/commercial sizing
// are different questions: how much a customer is charged is a commercial
// decision, not a mechanical consequence of how many hours or Development
// Units something took. See config.ts PRICING_STRATEGY/PRICE_PER_DU/
// BILLING_RATE_PER_HOUR.

import type { PricingStrategy } from "../domain/types.js";

/** Round to 2 decimal places without floating-point drift (e.g. 2.0000000000004). */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface PricingInput {
  /** Commercial DU (scoring/commercialEngine.ts) - null for XXL, where Base DU (and therefore Commercial DU) is never set. NOT Base DU: DU_FIXED_PRICE deliberately prices against the commercially-adjusted unit, not the raw technical scope figure. */
  commercialDU: number | null;
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
 * DU_FIXED_PRICE: Commercial DU × a purely commercial calibration figure
 * per DU, with no implied hours-per-DU conversion - null for XXL, since
 * Commercial DU itself is null there.
 */
export function computePrice(strategy: PricingStrategy, input: PricingInput, config: PricingConfig): number | null {
  if (strategy === "HOURLY") {
    if (config.billingRatePerHour === null) return null;
    return round2(input.likelyHours * config.billingRatePerHour);
  }

  // DU_FIXED_PRICE
  if (config.pricePerDU === null || input.commercialDU === null) return null;
  return round2(input.commercialDU * config.pricePerDU);
}
