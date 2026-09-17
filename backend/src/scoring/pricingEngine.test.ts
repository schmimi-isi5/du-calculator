import { describe, expect, it } from "vitest";
import { computePrice } from "./pricingEngine.js";

describe("computePrice - HOURLY strategy", () => {
  it("multiplies likelyHours by the billing rate per hour", () => {
    expect(
      computePrice("HOURLY", { developmentUnits: 6, likelyHours: 36 }, { billingRatePerHour: 160, pricePerDU: 900 }),
    ).toBe(5760);
  });

  it("returns null when no billing rate is configured", () => {
    expect(
      computePrice("HOURLY", { developmentUnits: 6, likelyHours: 36 }, { billingRatePerHour: null, pricePerDU: 900 }),
    ).toBeNull();
  });

  it("still prices XXL (developmentUnits null) from likelyHours alone - price is independent of DU", () => {
    expect(
      computePrice("HOURLY", { developmentUnits: null, likelyHours: 100 }, { billingRatePerHour: 160, pricePerDU: 900 }),
    ).toBe(16000);
  });
});

describe("computePrice - DU_FIXED_PRICE strategy", () => {
  it("multiplies developmentUnits by the configured price per DU, ignoring hours entirely", () => {
    expect(
      computePrice("DU_FIXED_PRICE", { developmentUnits: 6, likelyHours: 99999 }, { billingRatePerHour: 160, pricePerDU: 900 }),
    ).toBe(5400);
  });

  it("returns null for XXL, where developmentUnits is null - no artificially precise price for an uncounted DU class", () => {
    expect(
      computePrice("DU_FIXED_PRICE", { developmentUnits: null, likelyHours: 100 }, { billingRatePerHour: 160, pricePerDU: 900 }),
    ).toBeNull();
  });

  it("returns null when no price per DU is configured", () => {
    expect(
      computePrice("DU_FIXED_PRICE", { developmentUnits: 6, likelyHours: 100 }, { billingRatePerHour: 160, pricePerDU: null }),
    ).toBeNull();
  });
});
