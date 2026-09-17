import { describe, expect, it } from "vitest";
import type { RepositoryContext, RepositoryProfile, Requirement } from "../domain/types.js";
import { buildAssessmentPrompt, buildContextResolutionPrompt } from "./prompts.js";

const REQUIREMENT: Requirement = {
  title: "Test requirement",
  description: "A test requirement description.",
  acceptanceCriteria: [],
  constraints: [],
};

const PROFILE: RepositoryProfile = {
  summary: "test",
  languages: [],
  frameworks: [],
  services: [],
  dataModels: [],
  integrations: [],
  aiComponents: [],
  tests: [],
  deployment: [],
  findings: [],
};

const CONTEXT: RepositoryContext = { fileTree: [], fileExcerpts: {}, omittedFileCount: 0 };

describe("buildContextResolutionPrompt - GREENFIELD mode", () => {
  it("includes the greenfield note only when mode is GREENFIELD", () => {
    const existingSystem = buildContextResolutionPrompt(REQUIREMENT, PROFILE, CONTEXT, [], "standard", "EXISTING_SYSTEM");
    const greenfield = buildContextResolutionPrompt(REQUIREMENT, PROFILE, CONTEXT, [], "standard", "GREENFIELD");

    expect(existingSystem.system).not.toContain("GREENFIELD mode");
    expect(greenfield.system).toContain("GREENFIELD mode");
    expect(greenfield.system).toContain("existingAssetLeverage must be null");
  });

  it("defaults to EXISTING_SYSTEM behavior when mode is omitted", () => {
    const noMode = buildContextResolutionPrompt(REQUIREMENT, PROFILE, CONTEXT, [], "standard");
    expect(noMode.system).not.toContain("GREENFIELD mode");
  });
});

describe("buildAssessmentPrompt - GREENFIELD mode", () => {
  const knowledge = { knownFacts: [], assumptions: [] };

  it("includes the greenfield note only when mode is GREENFIELD", () => {
    const existingSystem = buildAssessmentPrompt(REQUIREMENT, PROFILE, CONTEXT, knowledge, "standard", "EXISTING_SYSTEM");
    const greenfield = buildAssessmentPrompt(REQUIREMENT, PROFILE, CONTEXT, knowledge, "standard", "GREENFIELD");

    expect(existingSystem.system).not.toContain("GREENFIELD mode");
    expect(greenfield.system).toContain("GREENFIELD mode");
  });

  it("always includes the CLASSIC_CUSTOM_DEVELOPMENT anti-bias rule", () => {
    const prompt = buildAssessmentPrompt(REQUIREMENT, PROFILE, CONTEXT, knowledge, "standard");
    expect(prompt.system).toContain("CLASSIC_CUSTOM_DEVELOPMENT");
  });

  it("always includes the direct cost, implementation novelty, and reusable innovation rules", () => {
    const prompt = buildAssessmentPrompt(REQUIREMENT, PROFILE, CONTEXT, knowledge, "standard");
    expect(prompt.system).toContain("Direct costs (directCosts)");
    expect(prompt.system).toContain("Implementation novelty (implementationNovelty)");
    expect(prompt.system).toContain("Reusable innovation / IP (reusableInnovationIp)");
  });

  it("instructs the AI to produce bottom-up Work Packages, never an independent total", () => {
    const prompt = buildAssessmentPrompt(REQUIREMENT, PROFILE, CONTEXT, knowledge, "standard");
    expect(prompt.system).toContain("effortWorkBreakdown");
    expect(prompt.system).toContain("Work Packages");
    expect(prompt.system).toContain("Do NOT give one holistic total for the requirement");
    expect(prompt.system).not.toContain("Independent AI-native effort estimate");
  });

  it("tells GREENFIELD Work Packages to have empty repositoryEvidence", () => {
    const greenfield = buildAssessmentPrompt(REQUIREMENT, PROFILE, CONTEXT, knowledge, "standard", "GREENFIELD");
    expect(greenfield.system).toContain("Every Work Package's repositoryEvidence must be an empty array");
  });
});
