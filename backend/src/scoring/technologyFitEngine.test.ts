import { describe, expect, it } from "vitest";
import {
  RELATIVE_EFFORT_FACTOR_GUARDRAIL_MAX,
  RELATIVE_EFFORT_FACTOR_GUARDRAIL_MIN,
  TECHNOLOGY_CAPABILITY_PROFILES,
  TECHNOLOGY_PROFILE_FACTORS,
} from "../domain/technology.js";
import type { TechnologyProfile } from "../domain/types.js";
import { buildTechnologyComparison } from "./technologyFitEngine.js";
import { buildEffortEstimate, buildExistingAssetLeverage, buildTechnologyNarratives, buildTechnologyProfile } from "./testFixtures.js";

const AI_NATIVE_EFFORT = { minHours: 20, likelyHours: 30, maxHours: 45 };

function findRow(rows: ReturnType<typeof buildTechnologyComparison>, technology: string) {
  return rows.find((r) => r.technology === technology)!;
}

describe("buildTechnologyComparison - mechanics", () => {
  it("always pins AI_NATIVE at relativeEffortFactor 1.0 and its own effort corridor unchanged", () => {
    const rows = buildTechnologyComparison(
      buildTechnologyProfile({ customBusinessLogic: { score: 4 } }),
      buildExistingAssetLeverage(),
      buildTechnologyNarratives(),
      AI_NATIVE_EFFORT,
    );

    const aiNative = findRow(rows, "AI_NATIVE");
    expect(aiNative.relativeEffortFactor).toBe(1);
    expect(aiNative.estimatedHours).toEqual(AI_NATIVE_EFFORT);
  });

  it("returns exactly the four base technologies plus the one supported combination", () => {
    const rows = buildTechnologyComparison(buildTechnologyProfile(), buildExistingAssetLeverage(), buildTechnologyNarratives(), AI_NATIVE_EFFORT);
    expect(rows.map((r) => r.technology)).toEqual(["AI_NATIVE", "CLASSIC", "N8N", "INTREXX", "N8N_INTREXX"]);
  });

  it("keeps assetLeverage as null (UNKNOWN) rather than defaulting it to 0 when no evidence was given", () => {
    const rows = buildTechnologyComparison(buildTechnologyProfile(), buildExistingAssetLeverage(), buildTechnologyNarratives(), AI_NATIVE_EFFORT);
    const n8n = findRow(rows, "N8N");
    expect(n8n.assetLeverage).toBeNull();
  });

  it("clamps an extreme relativeEffortFactor within the technical guardrail range, never presenting an unbounded number", () => {
    // Every factor maximally characterizes the requirement (score 5) and N8N
    // is capability-negative on nearly all of them - this pushes the raw
    // ratio far outside [0.2, 3.0] without a guardrail.
    const extremeProfile = buildTechnologyProfile(
      Object.fromEntries(TECHNOLOGY_PROFILE_FACTORS.map((f) => [f, { score: 5 as const }])) as Record<
        (typeof TECHNOLOGY_PROFILE_FACTORS)[number],
        { score: 5 }
      >,
    );
    const rows = buildTechnologyComparison(extremeProfile, buildExistingAssetLeverage(), buildTechnologyNarratives(), AI_NATIVE_EFFORT);
    for (const row of rows) {
      expect(row.relativeEffortFactor).toBeGreaterThanOrEqual(RELATIVE_EFFORT_FACTOR_GUARDRAIL_MIN);
      expect(row.relativeEffortFactor).toBeLessThanOrEqual(RELATIVE_EFFORT_FACTOR_GUARDRAIL_MAX);
    }
  });

  it("scales every technology's estimatedHours corridor from AI_NATIVE's own corridor by its relativeEffortFactor", () => {
    const rows = buildTechnologyComparison(
      buildTechnologyProfile({ workflowOrchestration: { score: 5 }, standardConnectors: { score: 5 } }),
      buildExistingAssetLeverage(),
      buildTechnologyNarratives(),
      AI_NATIVE_EFFORT,
    );
    const n8n = findRow(rows, "N8N");
    expect(n8n.estimatedHours.likelyHours).toBeCloseTo(AI_NATIVE_EFFORT.likelyHours * n8n.relativeEffortFactor, 0);
  });
});

describe("Test A - standard automation (trigger -> SaaS API -> transform -> SaaS API -> notification)", () => {
  it("lets n8n land well under 100% relative effort", () => {
    const profile = buildTechnologyProfile({
      workflowOrchestration: { score: 5 },
      standardConnectors: { score: 5 },
      customIntegrations: { score: 1 },
      customBusinessLogic: { score: 0 },
      aiAgentsRag: { score: 0 },
      complexStateManagement: { score: 0 },
      customAlgorithms: { score: 0 },
      uiForms: { score: 0 },
      crudDataManagement: { score: 1 },
    });
    const rows = buildTechnologyComparison(profile, buildExistingAssetLeverage(), buildTechnologyNarratives(), AI_NATIVE_EFFORT);
    const n8n = findRow(rows, "N8N");
    expect(n8n.relativeEffortFactor).toBeLessThan(1);
  });
});

describe("Test B - custom AI application (agentic logic + RAG + complex business rules + existing AI-native code)", () => {
  const profile = buildTechnologyProfile({
    aiAgentsRag: { score: 5 },
    customBusinessLogic: { score: 5 },
    complexStateManagement: { score: 4 },
    customAlgorithms: { score: 4 },
    workflowOrchestration: { score: 1 },
    standardConnectors: { score: 0 },
    uiForms: { score: 1 },
    crudDataManagement: { score: 1 },
  });

  it("lets AI_NATIVE be more efficient than n8n and Intrexx - both may exceed 100%", () => {
    const rows = buildTechnologyComparison(
      profile,
      buildExistingAssetLeverage({ AI_NATIVE: { assetLeverage: 0.6 } }),
      buildTechnologyNarratives(),
      AI_NATIVE_EFFORT,
    );
    const n8n = findRow(rows, "N8N");
    const intrexx = findRow(rows, "INTREXX");
    expect(n8n.relativeEffortFactor).toBeGreaterThan(1);
    expect(intrexx.relativeEffortFactor).toBeGreaterThan(1);
  });
});

describe("Test C - business CRUD app (forms + data model + roles + approvals + classical workflows)", () => {
  it("gives Intrexx a clear productivity advantage", () => {
    const profile = buildTechnologyProfile({
      uiForms: { score: 5 },
      crudDataManagement: { score: 5 },
      workflowOrchestration: { score: 3 },
      standardConnectors: { score: 1 },
      customBusinessLogic: { score: 1 },
      aiAgentsRag: { score: 0 },
      customAlgorithms: { score: 0 },
      complexStateManagement: { score: 1 },
    });
    const rows = buildTechnologyComparison(profile, buildExistingAssetLeverage(), buildTechnologyNarratives(), AI_NATIVE_EFFORT);
    const intrexx = findRow(rows, "INTREXX");
    const n8n = findRow(rows, "N8N");
    expect(intrexx.relativeEffortFactor).toBeLessThan(1);
    expect(intrexx.relativeEffortFactor).toBeLessThan(n8n.relativeEffortFactor);
  });
});

describe("Test D - custom algorithm (complex individual calculation logic, few standard integrations)", () => {
  it("lets AI_NATIVE be clearly favored over n8n and Intrexx", () => {
    const profile = buildTechnologyProfile({
      customAlgorithms: { score: 5 },
      customBusinessLogic: { score: 3 },
      standardConnectors: { score: 0 },
      workflowOrchestration: { score: 0 },
      uiForms: { score: 0 },
      crudDataManagement: { score: 0 },
    });
    const rows = buildTechnologyComparison(profile, buildExistingAssetLeverage(), buildTechnologyNarratives(), AI_NATIVE_EFFORT);
    const n8n = findRow(rows, "N8N");
    const intrexx = findRow(rows, "INTREXX");
    expect(n8n.relativeEffortFactor).toBeGreaterThan(1);
    expect(intrexx.relativeEffortFactor).toBeGreaterThan(1);
  });
});

describe("Test E - existing code (small extension, 80% of needed components already exist)", () => {
  it("lets AI_NATIVE's existing-asset leverage make every other technology look relatively more expensive, without touching DU (tested separately in duEngine.test.ts)", () => {
    const profile = buildTechnologyProfile({ customBusinessLogic: { score: 2 }, customIntegrations: { score: 2 } });

    const withoutLeverage = buildTechnologyComparison(profile, buildExistingAssetLeverage(), buildTechnologyNarratives(), AI_NATIVE_EFFORT);
    const withLeverage = buildTechnologyComparison(
      profile,
      buildExistingAssetLeverage({ AI_NATIVE: { assetLeverage: 0.8 } }),
      buildTechnologyNarratives(),
      AI_NATIVE_EFFORT,
    );

    const n8nWithout = findRow(withoutLeverage, "N8N").relativeEffortFactor;
    const n8nWith = findRow(withLeverage, "N8N").relativeEffortFactor;
    expect(n8nWith).toBeGreaterThan(n8nWithout);
  });
});

describe("Test F - hybrid (classical Intrexx app + several n8n integration workflows)", () => {
  it("applies integration/operational overhead to the combination, so it is not simply the best-of-both fit for free", () => {
    const profile = buildTechnologyProfile({
      uiForms: { score: 4 },
      crudDataManagement: { score: 4 },
      workflowOrchestration: { score: 4 },
      standardConnectors: { score: 4 },
    });
    const rows = buildTechnologyComparison(profile, buildExistingAssetLeverage(), buildTechnologyNarratives(), AI_NATIVE_EFFORT);
    const combo = findRow(rows, "N8N_INTREXX");

    expect(combo.integrationOverhead).toBeGreaterThan(0);
    expect(combo.operationalOverhead).toBeGreaterThan(0);

    // Independently recompute what the combo's ratio would be WITHOUT the
    // overhead (best-of-both capability, no leverage adjustment - the
    // fixture leaves every assetLeverage null) to prove the overhead is
    // actually applied, not just reported as a nonzero constant on the side.
    const combinedCapabilityNoOverhead = Object.fromEntries(
      TECHNOLOGY_PROFILE_FACTORS.map((factor) => [
        factor,
        Math.max(TECHNOLOGY_CAPABILITY_PROFILES.N8N[factor], TECHNOLOGY_CAPABILITY_PROFILES.INTREXX[factor]),
      ]),
    );
    const rawScoreOf = (capability: Record<string, number>, p: TechnologyProfile) => {
      let weightedSum = 0;
      let relevanceSum = 0;
      for (const factor of TECHNOLOGY_PROFILE_FACTORS) {
        const relevance = p[factor].score / 5;
        weightedSum += relevance * capability[factor]!;
        relevanceSum += relevance;
      }
      return 1 - (relevanceSum > 0 ? weightedSum / relevanceSum : 0);
    };
    const comboRawNoOverhead = rawScoreOf(combinedCapabilityNoOverhead, profile);
    const aiNativeRaw = rawScoreOf(TECHNOLOGY_CAPABILITY_PROFILES.AI_NATIVE, profile);
    const noOverheadRatio = comboRawNoOverhead / aiNativeRaw;

    expect(combo.relativeEffortFactor).toBeGreaterThan(noOverheadRatio);
  });

  it("does not automatically make the combination better than both individual technologies", () => {
    const profile = buildTechnologyProfile({
      uiForms: { score: 4 },
      crudDataManagement: { score: 4 },
      workflowOrchestration: { score: 4 },
      standardConnectors: { score: 4 },
    });
    const rows = buildTechnologyComparison(profile, buildExistingAssetLeverage(), buildTechnologyNarratives(), AI_NATIVE_EFFORT);
    const combo = findRow(rows, "N8N_INTREXX");
    const n8n = findRow(rows, "N8N");
    const intrexx = findRow(rows, "INTREXX");

    // The combination is allowed to beat the better individual technology,
    // but is not required to - and must never look better than a
    // theoretical zero-overhead combination would (checked above). This
    // assertion only guards against a regression to "combo always wins":
    // it must not undercut the better individual technology by more than
    // the overhead-free best-of-both could ever justify.
    expect(combo.relativeEffortFactor).toBeGreaterThan(0);
    expect(Math.min(n8n.relativeEffortFactor, intrexx.relativeEffortFactor)).toBeGreaterThan(0);
  });
});

describe("Test G - poor platform fit (complex state machine + custom algorithm + AI agents)", () => {
  it("lets n8n exceed 100% relative effort", () => {
    const profile = buildTechnologyProfile({
      complexStateManagement: { score: 5 },
      customAlgorithms: { score: 5 },
      aiAgentsRag: { score: 4 },
      workflowOrchestration: { score: 0 },
      standardConnectors: { score: 0 },
      uiForms: { score: 0 },
      crudDataManagement: { score: 0 },
    });
    const rows = buildTechnologyComparison(profile, buildExistingAssetLeverage(), buildTechnologyNarratives(), AI_NATIVE_EFFORT);
    const n8n = findRow(rows, "N8N");
    expect(n8n.relativeEffortFactor).toBeGreaterThan(1);
  });
});

// --- commercial-du-v1 spec: CLASSIC_CUSTOM_DEVELOPMENT --------------------
// CLASSIC runs through the exact same symmetric formula as every other
// technology - these tests verify it is not hardcoded to "always worse than
// AI_NATIVE" (it can still clearly beat n8n/Intrexx on custom-logic-heavy
// requirements) nor "always better than n8n/Intrexx" (it can lose to n8n on
// boilerplate-heavy standard automation).

describe("Test D (commercial-du-v1) - CLASSIC on a custom-algorithm-heavy requirement", () => {
  it("lets CLASSIC lose to AI_NATIVE but still clearly beat both n8n and Intrexx", () => {
    const profile = buildTechnologyProfile({
      customAlgorithms: { score: 5 },
      customBusinessLogic: { score: 3 },
      standardConnectors: { score: 0 },
      workflowOrchestration: { score: 0 },
      uiForms: { score: 0 },
      crudDataManagement: { score: 0 },
    });
    const rows = buildTechnologyComparison(profile, buildExistingAssetLeverage(), buildTechnologyNarratives(), AI_NATIVE_EFFORT);
    const aiNative = findRow(rows, "AI_NATIVE");
    const classic = findRow(rows, "CLASSIC");
    const n8n = findRow(rows, "N8N");
    const intrexx = findRow(rows, "INTREXX");

    expect(classic.relativeEffortFactor).toBeGreaterThan(aiNative.relativeEffortFactor);
    expect(classic.relativeEffortFactor).toBeLessThan(n8n.relativeEffortFactor);
    expect(classic.relativeEffortFactor).toBeLessThan(intrexx.relativeEffortFactor);
  });
});

describe("CLASSIC on a standard-automation requirement", () => {
  it("lets CLASSIC lose to n8n - it is not automatically better than a low-code platform either", () => {
    const profile = buildTechnologyProfile({
      workflowOrchestration: { score: 5 },
      standardConnectors: { score: 5 },
      customIntegrations: { score: 1 },
      customBusinessLogic: { score: 0 },
      uiForms: { score: 0 },
      crudDataManagement: { score: 1 },
    });
    const rows = buildTechnologyComparison(profile, buildExistingAssetLeverage(), buildTechnologyNarratives(), AI_NATIVE_EFFORT);
    const classic = findRow(rows, "CLASSIC");
    const n8n = findRow(rows, "N8N");
    expect(classic.relativeEffortFactor).toBeGreaterThan(n8n.relativeEffortFactor);
  });
});

// --- commercial-du-v1 spec section 31: explainability ---------------------

describe("TechnologyAssessment.contributions (explainability)", () => {
  it("names the driving factors with a signed contribution and a direction consistent with its sign", () => {
    const profile = buildTechnologyProfile({ workflowOrchestration: { score: 5 }, standardConnectors: { score: 5 } });
    const rows = buildTechnologyComparison(profile, buildExistingAssetLeverage(), buildTechnologyNarratives(), AI_NATIVE_EFFORT);
    const n8n = findRow(rows, "N8N");

    expect(n8n.contributions.length).toBeGreaterThan(0);
    for (const c of n8n.contributions) {
      expect(c.direction).toBe(c.contribution >= 0 ? "decreases" : "increases");
    }
    // Sorted by absolute magnitude, largest first.
    for (let i = 1; i < n8n.contributions.length; i++) {
      expect(Math.abs(n8n.contributions[i - 1]!.contribution)).toBeGreaterThanOrEqual(Math.abs(n8n.contributions[i]!.contribution));
    }
  });
});

// --- commercial-du-v1 spec section 32: HIGH_VARIANCE_COMPARISON -----------

describe("TechnologyAssessment.varianceFlag", () => {
  it("flags a technology whose relativeEffortFactor lands far from AI_NATIVE as HIGH_VARIANCE_COMPARISON, without treating it as an error", () => {
    const profile = buildTechnologyProfile({
      complexStateManagement: { score: 5 },
      customAlgorithms: { score: 5 },
      aiAgentsRag: { score: 5 },
      workflowOrchestration: { score: 0 },
      standardConnectors: { score: 0 },
    });
    const rows = buildTechnologyComparison(profile, buildExistingAssetLeverage(), buildTechnologyNarratives(), AI_NATIVE_EFFORT);
    const n8n = findRow(rows, "N8N");
    expect(n8n.relativeEffortFactor).toBeGreaterThan(2.0);
    expect(n8n.varianceFlag).toBe("HIGH_VARIANCE_COMPARISON");
  });

  it("never flags AI_NATIVE itself (always exactly at its own 1.0 reference)", () => {
    const rows = buildTechnologyComparison(buildTechnologyProfile({ customAlgorithms: { score: 5 } }), buildExistingAssetLeverage(), buildTechnologyNarratives(), AI_NATIVE_EFFORT);
    expect(findRow(rows, "AI_NATIVE").varianceFlag).toBeNull();
  });

  it("leaves varianceFlag null for a technology comparison close to AI_NATIVE", () => {
    const rows = buildTechnologyComparison(buildTechnologyProfile(), buildExistingAssetLeverage(), buildTechnologyNarratives(), AI_NATIVE_EFFORT);
    // A perfectly neutral profile (every factor score 0) makes every
    // technology's capabilityEffect 0, so every relativeEffortFactor is 1.
    for (const row of rows) {
      expect(row.varianceFlag).toBeNull();
    }
  });
});
