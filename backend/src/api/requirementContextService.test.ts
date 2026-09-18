import { describe, expect, it } from "vitest";
import type { Requirement, RequirementNormalization } from "../domain/types.js";
import { applyNormalizationToRequirement, resolveModelSelection } from "./requirementContextService.js";

function buildRequirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    title: "Platzhalter-Titel",
    description: "Kunden sollen ihre Rechnungen online einsehen können.",
    acceptanceCriteria: [],
    constraints: [],
    ...overrides,
  };
}

function buildNormalization(overrides: Partial<RequirementNormalization> = {}): RequirementNormalization {
  return {
    suggestedTitle: "Online-Rechnungseinsicht für Kunden",
    objective: "",
    businessGoal: "",
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    acceptanceCriteria: [],
    technicalConstraints: [],
    mentionedSystems: [],
    mentionedDataSources: [],
    mentionedIntegrations: [],
    mentionedExistingComponents: [],
    assumptionsAlreadyContainedInRequirement: [],
    unresolvedInformation: [],
    ...overrides,
  };
}

describe("applyNormalizationToRequirement", () => {
  it("replaces the placeholder title with the AI's suggestedTitle", () => {
    const result = applyNormalizationToRequirement(buildRequirement(), buildNormalization());
    expect(result.title).toBe("Online-Rechnungseinsicht für Kunden");
  });

  it("keeps the requirement's own title if suggestedTitle is blank", () => {
    const result = applyNormalizationToRequirement(
      buildRequirement({ title: "Bestehender Titel" }),
      buildNormalization({ suggestedTitle: "  " }),
    );
    expect(result.title).toBe("Bestehender Titel");
  });

  it("never touches the description", () => {
    const requirement = buildRequirement();
    const result = applyNormalizationToRequirement(requirement, buildNormalization());
    expect(result.description).toBe(requirement.description);
  });

  it("merges AI-derived acceptance criteria with any manually provided ones, without duplicates", () => {
    const requirement = buildRequirement({ acceptanceCriteria: ["Rechnung ist als PDF herunterladbar"] });
    const normalization = buildNormalization({
      acceptanceCriteria: ["Rechnung ist als PDF herunterladbar", "Nur der jeweilige Kunde sieht seine eigenen Rechnungen"],
    });
    const result = applyNormalizationToRequirement(requirement, normalization);
    expect(result.acceptanceCriteria).toEqual([
      "Rechnung ist als PDF herunterladbar",
      "Nur der jeweilige Kunde sieht seine eigenen Rechnungen",
    ]);
  });

  it("merges AI-derived constraints with the user's manually typed ones, without duplicates", () => {
    const requirement = buildRequirement({ constraints: ["DSGVO-konform"] });
    const normalization = buildNormalization({ technicalConstraints: ["DSGVO-konform", "Muss ins bestehende Kundenportal passen"] });
    const result = applyNormalizationToRequirement(requirement, normalization);
    expect(result.constraints).toEqual(["DSGVO-konform", "Muss ins bestehende Kundenportal passen"]);
  });
});

// resolveAutoModel/resolveDefaultModel themselves are exhaustively covered
// in domain/models.test.ts - what's specific to resolveModelSelection is
// the *dispatch* contract: an explicit choice must never be second-guessed,
// regardless of quality level, context size, or privacy mode. This is the
// guarantee behind spec section 13's "kein automatischer Wechsel auf einen
// anderen Cloud-Provider" for manual selection.
describe("resolveModelSelection", () => {
  it("returns an explicit choice verbatim, ignoring quality level and context size", async () => {
    await expect(
      resolveModelSelection({ kind: "explicit", modelId: "gpt-6-astra" }, "quick", false, undefined),
    ).resolves.toBe("gpt-6-astra");
    await expect(
      resolveModelSelection({ kind: "explicit", modelId: "gpt-6-astra" }, "thorough", true, undefined),
    ).resolves.toBe("gpt-6-astra");
  });

  it("never substitutes a different model for an explicit choice, even under privacyMode=local-only", async () => {
    // requirementContextRoutes.ts is responsible for rejecting an explicit
    // non-local pick before this function is ever called with
    // privacyMode=local-only - this function's own contract is simply: an
    // explicit choice is never overridden, by anything.
    await expect(
      resolveModelSelection({ kind: "explicit", modelId: "claude-sonnet-5" }, "standard", false, "local-only"),
    ).resolves.toBe("claude-sonnet-5");
  });
});
