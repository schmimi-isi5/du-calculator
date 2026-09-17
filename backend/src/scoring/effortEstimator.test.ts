import { describe, expect, it } from "vitest";
import { buildEffortEstimate } from "./effortEstimator.js";

describe("buildEffortEstimate", () => {
  it("passes through a well-formed corridor unchanged (aside from rounding)", () => {
    const result = buildEffortEstimate({
      minHours: 20.04,
      likelyHours: 28.06,
      maxHours: 38.01,
      confidence: 0.74,
      rationale: { en: "en text", de: "de text" },
    });

    expect(result).toEqual({
      minHours: 20,
      likelyHours: 28.1,
      maxHours: 38,
      confidence: 0.74,
      rationale: { en: "en text", de: "de text" },
    });
  });

  it("widens minHours up to likelyHours if the AI's minHours was inconsistently above likelyHours", () => {
    const result = buildEffortEstimate({
      minHours: 40,
      likelyHours: 30,
      maxHours: 50,
      confidence: 0.7,
      rationale: { en: "x", de: "y" },
    });

    expect(result.minHours).toBe(30);
    expect(result.likelyHours).toBe(30);
  });

  it("widens maxHours up to likelyHours if the AI's maxHours was inconsistently below likelyHours", () => {
    const result = buildEffortEstimate({
      minHours: 10,
      likelyHours: 30,
      maxHours: 20,
      confidence: 0.7,
      rationale: { en: "x", de: "y" },
    });

    expect(result.maxHours).toBe(30);
    expect(result.likelyHours).toBe(30);
  });

  it("never derives the corridor from a DU/dimension formula - it is a pure passthrough of the given estimate", () => {
    const result = buildEffortEstimate({
      minHours: 500,
      likelyHours: 620,
      maxHours: 800,
      confidence: 0.6,
      rationale: { en: "unusually large", de: "ungewöhnlich groß" },
    });

    expect(result.likelyHours).toBe(620);
  });
});
