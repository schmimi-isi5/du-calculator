import { describe, expect, it } from "vitest";
import { ImpactAnalysisSchema } from "./schemas.js";

const BASE_IMPACT_ANALYSIS = {
  existing: [],
  reusable: [],
  modify: [],
  create: [],
  dataChanges: [],
  integrations: [],
  tests: [],
  risks: [],
  openQuestions: [],
};

describe("ImpactAnalysisSchema suggestedDecomposition", () => {
  it("accepts the common case: an empty array", () => {
    const result = ImpactAnalysisSchema.safeParse({ ...BASE_IMPACT_ANALYSIS, suggestedDecomposition: [] });
    expect(result.success).toBe(true);
  });

  it("accepts a populated list of candidate sub-requirements", () => {
    const result = ImpactAnalysisSchema.safeParse({
      ...BASE_IMPACT_ANALYSIS,
      suggestedDecomposition: [
        { title: "Ingestion pipeline", description: "Index new customer messages asynchronously." },
        { title: "Retrieval and deduplication", description: "Retrieve and deduplicate historical messages." },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.suggestedDecomposition).toHaveLength(2);
  });

  it("rejects a candidate missing a required field", () => {
    const result = ImpactAnalysisSchema.safeParse({
      ...BASE_IMPACT_ANALYSIS,
      suggestedDecomposition: [{ title: "Ingestion pipeline" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing suggestedDecomposition entirely", () => {
    const result = ImpactAnalysisSchema.safeParse(BASE_IMPACT_ANALYSIS);
    expect(result.success).toBe(false);
  });
});
