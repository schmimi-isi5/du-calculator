import { describe, expect, it } from "vitest";
import { buildEffortWorkBreakdownFromPackages, buildWorkPackage } from "./testFixtures.js";
import { buildEffortEstimateFromWorkPackages } from "./effortEstimator.js";

describe("buildEffortEstimateFromWorkPackages - deterministic aggregation (Test A)", () => {
  it("sums min/likely/max across Work Packages - never re-estimated by the AI", () => {
    const breakdown = buildEffortWorkBreakdownFromPackages([
      buildWorkPackage({ id: "wp-1", humanEffort: { minHours: 1, likelyHours: 2, maxHours: 3 } }),
      buildWorkPackage({ id: "wp-2", humanEffort: { minHours: 2, likelyHours: 4, maxHours: 7 } }),
      buildWorkPackage({ id: "wp-3", humanEffort: { minHours: 1, likelyHours: 3, maxHours: 5 } }),
    ]);

    const result = buildEffortEstimateFromWorkPackages(breakdown);

    expect(result.minHours).toBe(4);
    expect(result.likelyHours).toBe(9);
    expect(result.maxHours).toBe(15);
  });
});

describe("buildEffortEstimateFromWorkPackages - confidence aggregation (Test B)", () => {
  it("weights each Work Package's confidence by its share of total likely hours", () => {
    const breakdown = buildEffortWorkBreakdownFromPackages([
      buildWorkPackage({ id: "wp-1", humanEffort: { minHours: 1, likelyHours: 2, maxHours: 3 }, confidence: 0.9 }),
      buildWorkPackage({ id: "wp-2", humanEffort: { minHours: 5, likelyHours: 8, maxHours: 12 }, confidence: 0.6 }),
    ]);

    const result = buildEffortEstimateFromWorkPackages(breakdown);

    // weight_1 = 2/10 = 0.2, weight_2 = 8/10 = 0.8
    // overall = 0.9*0.2 + 0.6*0.8 = 0.18 + 0.48 = 0.66
    expect(result.confidence).toBeCloseTo(0.66, 5);
  });

  it("falls back cleanly to 0 confidence when total likely hours is 0, instead of a hidden independent AI confidence", () => {
    const breakdown = buildEffortWorkBreakdownFromPackages([
      buildWorkPackage({ id: "wp-1", humanEffort: { minHours: 0, likelyHours: 0, maxHours: 0 }, confidence: 0.9 }),
    ]);

    const result = buildEffortEstimateFromWorkPackages(breakdown);
    expect(result.confidence).toBe(0);
  });
});

describe("buildEffortEstimateFromWorkPackages - no independent AI total (Test C)", () => {
  it("computes the total purely from the Work Packages - the raw AI output never carries a total field at all", () => {
    // EffortWorkBreakdownOutput has no minHours/likelyHours/maxHours/confidence
    // field anywhere in its shape (see domain/types.ts) - so this test's
    // fixture input has nowhere to even put an independent total. Asserting
    // the result exactly matches the Work Package sum is the regression
    // guard: any future change that starts respecting a "total" field
    // sneaking into the AI schema would have nowhere to read it from here.
    const breakdown = buildEffortWorkBreakdownFromPackages([
      buildWorkPackage({ id: "wp-1", humanEffort: { minHours: 3, likelyHours: 5, maxHours: 8 } }),
    ]);
    expect(breakdown).not.toHaveProperty("totalHours");
    expect(breakdown).not.toHaveProperty("minHours");
    expect(breakdown).not.toHaveProperty("likelyHours");
    expect(breakdown).not.toHaveProperty("confidence");

    const result = buildEffortEstimateFromWorkPackages(breakdown);
    expect(result.likelyHours).toBe(5);
  });
});

describe("buildEffortEstimateFromWorkPackages - repository reuse (Test D)", () => {
  it("keeps a MODIFY action with HIGH reuse as-is - no artificial CREATE assumption", () => {
    const breakdown = buildEffortWorkBreakdownFromPackages([
      buildWorkPackage({
        id: "wp-1",
        action: "MODIFY",
        reuse: { level: "HIGH", description: "Existing service extended in place", evidence: [] },
        repositoryEvidence: [{ path: "src/services/customerMemory.ts", symbol: "CustomerMemoryService", status: "VERIFIED" }],
      }),
    ]);

    const result = buildEffortEstimateFromWorkPackages(breakdown);
    const wp = result.workBreakdown!.workPackages[0]!;
    expect(wp.action).toBe("MODIFY");
    expect(wp.reuse.level).toBe("HIGH");
    expect(wp.repositoryEvidence[0]!.status).toBe("VERIFIED");
  });
});

describe("buildEffortEstimateFromWorkPackages - GREENFIELD (Test E)", () => {
  it("produces valid Work Packages with empty repositoryEvidence - not an error, not a fabricated path", () => {
    const breakdown = buildEffortWorkBreakdownFromPackages([
      buildWorkPackage({ id: "wp-1", repositoryEvidence: [] }),
      buildWorkPackage({ id: "wp-2", repositoryEvidence: [] }),
    ]);

    const result = buildEffortEstimateFromWorkPackages(breakdown);
    expect(result.workBreakdown!.workPackages).toHaveLength(2);
    for (const wp of result.workBreakdown!.workPackages) {
      expect(wp.repositoryEvidence).toEqual([]);
    }
  });
});

describe("buildEffortEstimateFromWorkPackages - dependencies never reduce the sum (Test F)", () => {
  it("adds Work Package hours even when they could run in parallel - this estimates personnel effort, not calendar time", () => {
    const breakdown = buildEffortWorkBreakdownFromPackages([
      buildWorkPackage({ id: "wp-a", humanEffort: { minHours: 4, likelyHours: 4, maxHours: 4 } }),
      buildWorkPackage({ id: "wp-b", humanEffort: { minHours: 5, likelyHours: 5, maxHours: 5 }, dependencies: [] }),
    ]);

    const result = buildEffortEstimateFromWorkPackages(breakdown);
    expect(result.likelyHours).toBe(9);
    expect(result.likelyHours).not.toBe(5);
  });
});

describe("buildEffortEstimateFromWorkPackages - large Work Package flag (Test G)", () => {
  it("flags a Work Package with likelyHours > 16 as LARGE_WORK_PACKAGE, without changing its hours", () => {
    const breakdown = buildEffortWorkBreakdownFromPackages([
      buildWorkPackage({ id: "wp-1", humanEffort: { minHours: 10, likelyHours: 20, maxHours: 30 } }),
    ]);

    const result = buildEffortEstimateFromWorkPackages(breakdown);
    expect(result.workBreakdown!.workPackages[0]!.isLargeWorkPackage).toBe(true);
    expect(result.workBreakdown!.workPackages[0]!.humanEffort.likelyHours).toBe(20);
    expect(result.workBreakdown!.flags).toContain("LARGE_WORK_PACKAGE");
  });

  it("does not flag a Work Package at or below the threshold", () => {
    const breakdown = buildEffortWorkBreakdownFromPackages([
      buildWorkPackage({ id: "wp-1", humanEffort: { minHours: 8, likelyHours: 16, maxHours: 20 } }),
    ]);

    const result = buildEffortEstimateFromWorkPackages(breakdown);
    expect(result.workBreakdown!.workPackages[0]!.isLargeWorkPackage).toBe(false);
    expect(result.workBreakdown!.flags).not.toContain("LARGE_WORK_PACKAGE");
  });
});

describe("buildEffortEstimateFromWorkPackages - low evidence sanity flag (Test H)", () => {
  it("flags LOW_EVIDENCE when several relevant Work Packages have UNKNOWN evidence, without changing any hours", () => {
    const unknownEvidence = [{ path: "src/unknown.ts", symbol: null, status: "UNKNOWN" as const }];
    const breakdown = buildEffortWorkBreakdownFromPackages([
      buildWorkPackage({ id: "wp-1", humanEffort: { minHours: 2, likelyHours: 4, maxHours: 6 }, repositoryEvidence: unknownEvidence }),
      buildWorkPackage({ id: "wp-2", humanEffort: { minHours: 2, likelyHours: 4, maxHours: 6 }, repositoryEvidence: unknownEvidence }),
      buildWorkPackage({ id: "wp-3", humanEffort: { minHours: 2, likelyHours: 4, maxHours: 6 }, repositoryEvidence: unknownEvidence }),
    ]);

    const withoutFlag = buildEffortEstimateFromWorkPackages(
      buildEffortWorkBreakdownFromPackages([buildWorkPackage({ id: "wp-1", humanEffort: { minHours: 2, likelyHours: 4, maxHours: 6 } })]),
    );
    const withFlag = buildEffortEstimateFromWorkPackages(breakdown);

    expect(withoutFlag.workBreakdown!.flags).not.toContain("LOW_EVIDENCE");
    expect(withFlag.workBreakdown!.flags).toContain("LOW_EVIDENCE");
    // Sanity flags never change the aggregated hours.
    expect(withFlag.likelyHours).toBe(12);
  });
});

describe("buildEffortEstimateFromWorkPackages - no fixed category hours (Test N)", () => {
  it("produces different totals for the same category depending only on the given Work Package hours - no hidden per-category constant", () => {
    const cheapBackend = buildEffortEstimateFromWorkPackages(
      buildEffortWorkBreakdownFromPackages([
        buildWorkPackage({ id: "wp-1", category: "BACKEND", humanEffort: { minHours: 1, likelyHours: 2, maxHours: 3 } }),
      ]),
    );
    const expensiveBackend = buildEffortEstimateFromWorkPackages(
      buildEffortWorkBreakdownFromPackages([
        buildWorkPackage({ id: "wp-1", category: "BACKEND", humanEffort: { minHours: 10, likelyHours: 20, maxHours: 30 } }),
      ]),
    );

    expect(cheapBackend.likelyHours).toBe(2);
    expect(expensiveBackend.likelyHours).toBe(20);
    expect(cheapBackend.likelyHours).not.toBe(expensiveBackend.likelyHours);
  });

  it("never derives hours from a DU/dimension formula - normalization is a pure function of the given corridor", () => {
    const breakdown = buildEffortWorkBreakdownFromPackages([
      buildWorkPackage({ id: "wp-1", humanEffort: { minHours: 500, likelyHours: 620, maxHours: 800 } }),
    ]);
    const result = buildEffortEstimateFromWorkPackages(breakdown);
    expect(result.likelyHours).toBe(620);
  });
});

describe("buildEffortEstimateFromWorkPackages - per-Work-Package corridor normalization", () => {
  it("widens minHours up to likelyHours if the AI's minHours was inconsistently above likelyHours", () => {
    const breakdown = buildEffortWorkBreakdownFromPackages([
      buildWorkPackage({ id: "wp-1", humanEffort: { minHours: 40, likelyHours: 30, maxHours: 50 } }),
    ]);
    const result = buildEffortEstimateFromWorkPackages(breakdown);
    const wp = result.workBreakdown!.workPackages[0]!;
    expect(wp.humanEffort.minHours).toBe(30);
    expect(wp.humanEffort.likelyHours).toBe(30);
  });

  it("widens maxHours up to likelyHours if the AI's maxHours was inconsistently below likelyHours", () => {
    const breakdown = buildEffortWorkBreakdownFromPackages([
      buildWorkPackage({ id: "wp-1", humanEffort: { minHours: 10, likelyHours: 30, maxHours: 20 } }),
    ]);
    const result = buildEffortEstimateFromWorkPackages(breakdown);
    const wp = result.workBreakdown!.workPackages[0]!;
    expect(wp.humanEffort.maxHours).toBe(30);
  });

  it("rounds to one decimal place", () => {
    const breakdown = buildEffortWorkBreakdownFromPackages([
      buildWorkPackage({ id: "wp-1", humanEffort: { minHours: 20.04, likelyHours: 28.06, maxHours: 38.01 } }),
    ]);
    const result = buildEffortEstimateFromWorkPackages(breakdown);
    const wp = result.workBreakdown!.workPackages[0]!;
    expect(wp.humanEffort).toEqual({ minHours: 20, likelyHours: 28.1, maxHours: 38 });
  });
});

describe("buildEffortEstimateFromWorkPackages - overlap sanity flag", () => {
  it("surfaces POSSIBLE_OVERLAP when the AI's own completeness check reported an overlap warning", () => {
    const breakdown = buildEffortWorkBreakdownFromPackages(
      [buildWorkPackage({ id: "wp-1" }), buildWorkPackage({ id: "wp-2" })],
      { completenessAssessment: { complete: true, missingAreas: [], overlapWarnings: ["wp-1 und wp-2 überschneiden sich"] } },
    );
    const result = buildEffortEstimateFromWorkPackages(breakdown);
    expect(result.workBreakdown!.flags).toContain("POSSIBLE_OVERLAP");
  });
});

describe("buildEffortEstimateFromWorkPackages - missing testing sanity flag", () => {
  it("flags POSSIBLE_MISSING_TESTING when code changes exist with no TESTING_QA Work Package", () => {
    const breakdown = buildEffortWorkBreakdownFromPackages([
      buildWorkPackage({ id: "wp-1", category: "BACKEND", action: "CREATE" }),
    ]);
    const result = buildEffortEstimateFromWorkPackages(breakdown);
    expect(result.workBreakdown!.flags).toContain("POSSIBLE_MISSING_TESTING");
  });

  it("does not flag POSSIBLE_MISSING_TESTING once a TESTING_QA Work Package exists", () => {
    const breakdown = buildEffortWorkBreakdownFromPackages([
      buildWorkPackage({ id: "wp-1", category: "BACKEND", action: "CREATE" }),
      buildWorkPackage({ id: "wp-2", category: "TESTING_QA", action: "TEST" }),
    ]);
    const result = buildEffortEstimateFromWorkPackages(breakdown);
    expect(result.workBreakdown!.flags).not.toContain("POSSIBLE_MISSING_TESTING");
  });
});
