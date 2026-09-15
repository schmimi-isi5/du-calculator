import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_SELECTABLE_MODELS,
  DEFAULT_ANTHROPIC_MODEL,
  isSelectableAnthropicModel,
  selectableModelsFor,
} from "./models.js";

describe("selectableModelsFor", () => {
  it("returns the curated Anthropic list for the anthropic provider", () => {
    expect(selectableModelsFor("anthropic", DEFAULT_ANTHROPIC_MODEL)).toBe(ANTHROPIC_SELECTABLE_MODELS);
  });

  it("returns a single entry built from the configured model for non-Anthropic providers", () => {
    expect(selectableModelsFor("openai", "gpt-5")).toEqual([
      { id: "gpt-5", label: "gpt-5", description: "Über AI_MODEL konfiguriert." },
    ]);
    expect(selectableModelsFor("local", "qwen3.6:27b-coding")).toEqual([
      { id: "qwen3.6:27b-coding", label: "qwen3.6:27b-coding", description: "Über AI_MODEL konfiguriert." },
    ]);
  });
});

describe("isSelectableAnthropicModel", () => {
  it("accepts every id in the curated Anthropic list", () => {
    for (const model of ANTHROPIC_SELECTABLE_MODELS) {
      expect(isSelectableAnthropicModel(model.id)).toBe(true);
    }
  });

  it("rejects models not in the curated list", () => {
    expect(isSelectableAnthropicModel("claude-haiku-4-5-20251001")).toBe(false);
    expect(isSelectableAnthropicModel("gpt-5")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isSelectableAnthropicModel(undefined)).toBe(false);
    expect(isSelectableAnthropicModel(42)).toBe(false);
    expect(isSelectableAnthropicModel(null)).toBe(false);
  });
});
