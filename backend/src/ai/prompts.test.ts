import { describe, expect, it } from "vitest";
import type { RepositoryContext, RepositoryProfile, Requirement } from "../domain/types.js";
import { buildAssessmentPrompt, buildContextResolutionPrompt, buildRequirementChallengePrompt } from "./prompts.js";

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

describe("buildRequirementChallengePrompt", () => {
  const knowledge = { knownFacts: [], assumptions: [] };
  const normalized: Requirement = { ...REQUIREMENT, acceptanceCriteria: ["AC 1"], constraints: ["Must use Postgres"] };

  it("never mentions DU/hours/price/percentage numbers - Requirement Challenge runs before all five calculation models", () => {
    const prompt = buildRequirementChallengePrompt(REQUIREMENT, normalized, PROFILE, CONTEXT, knowledge, [], "standard");
    expect(prompt.system).toContain("no Development Unit count, no hours, no percentage effort/cost savings, no price, and no technology-fit percentage");
  });

  it("includes the greenfield note only when mode is GREENFIELD", () => {
    const existingSystem = buildRequirementChallengePrompt(REQUIREMENT, normalized, PROFILE, CONTEXT, knowledge, [], "standard", "EXISTING_SYSTEM");
    const greenfield = buildRequirementChallengePrompt(REQUIREMENT, normalized, PROFILE, CONTEXT, knowledge, [], "standard", "GREENFIELD");

    expect(existingSystem.system).not.toContain("GREENFIELD mode");
    expect(greenfield.system).toContain("GREENFIELD mode");
  });

  it("carries the goal-vs-solution and no-technology-bias rules", () => {
    const prompt = buildRequirementChallengePrompt(REQUIREMENT, normalized, PROFILE, CONTEXT, knowledge, [], "standard");
    expect(prompt.system).toContain("Separate the business goal from any proposed technical solution");
    expect(prompt.system).toContain("never have a standing preference for or against AI-native development, classical development, n8n, Intrexx");
  });

  it("lists all 8 challenge types", () => {
    const prompt = buildRequirementChallengePrompt(REQUIREMENT, normalized, PROFILE, CONTEXT, knowledge, [], "standard");
    for (const type of ["UNCLEAR", "ASSUMPTION", "SOLUTION_CONSTRAINT", "OPTIMIZATION", "CONFLICT", "SCOPE_REDUCTION", "REUSE_OPPORTUNITY", "ACCEPTANCE_IMPROVEMENT"]) {
      expect(prompt.system).toContain(type);
    }
  });

  it("shows both the original and normalized requirement, distinctly labeled", () => {
    const original: Requirement = { ...REQUIREMENT, description: "Original wording with a vector database." };
    const prompt = buildRequirementChallengePrompt(original, normalized, PROFILE, CONTEXT, knowledge, [], "standard");
    expect(prompt.volatile).toContain("ORIGINAL REQUIREMENT");
    expect(prompt.volatile).toContain("Original wording with a vector database.");
    expect(prompt.volatile).toContain("NORMALIZED REQUIREMENT");
  });

  it("tells the AI not to re-propose a REJECTED proposal without new evidence", () => {
    const rejected = {
      type: "SOLUTION_CONSTRAINT" as const,
      title: "t",
      originalText: "Vektordatenbank",
      issue: "issue",
      proposedChange: "change",
      rationale: "rationale",
      evidence: [],
      expectedImpact: { scope: "SAME" as const, complexity: "SAME" as const, maintainability: "SAME" as const, reuse: "SAME" as const, implementationFreedom: "SAME" as const },
      confidence: 0.5,
      id: "p1",
      status: "REJECTED" as const,
      editedChange: null,
      decidedAt: "now",
      createdAt: "now",
    };
    const prompt = buildRequirementChallengePrompt(REQUIREMENT, normalized, PROFILE, CONTEXT, knowledge, [rejected], "standard");
    expect(prompt.volatile).toContain("[REJECTED]");
    expect(prompt.volatile).toContain("Vektordatenbank");
    expect(prompt.system).toContain("Do not repeat a proposal that was already REJECTED");
  });
});
