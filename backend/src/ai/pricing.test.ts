import { describe, expect, it } from "vitest";
import { estimateCostUsd, resolvePricing, type UsageTokens } from "./pricing.js";

const noCache: UsageTokens = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  cacheReadTokens: 0,
};

describe("resolvePricing", () => {
  it("finds a known Anthropic model", () => {
    expect(resolvePricing("anthropic", "claude-opus-5", null)).toEqual({ inputPerMTok: 5, outputPerMTok: 25 });
  });

  it("finds a known OpenAI model", () => {
    expect(resolvePricing("openai", "gpt-5", null)).toEqual({ inputPerMTok: 1.25, outputPerMTok: 10 });
  });

  it("returns 0/0 for local regardless of model or custom pricing", () => {
    expect(resolvePricing("local", "anything", { inputPerMTok: 99, outputPerMTok: 99 })).toEqual({
      inputPerMTok: 0,
      outputPerMTok: 0,
    });
  });

  it("falls back to custom pricing for an unlisted OpenRouter model", () => {
    expect(resolvePricing("openrouter", "deepseek/deepseek-chat", { inputPerMTok: 0.3, outputPerMTok: 1.2 })).toEqual(
      { inputPerMTok: 0.3, outputPerMTok: 1.2 },
    );
  });

  it("returns null for an unlisted model with no custom pricing - never guesses", () => {
    expect(resolvePricing("openrouter", "deepseek/deepseek-chat", null)).toBeNull();
    expect(resolvePricing("openai", "some-future-model", null)).toBeNull();
  });

  it("falls back to the central Model Registry for a provider with no legacy static price table", () => {
    // "deepseek-flash" is the registry's apiModel for id "deepseek-v41-flash" -
    // pricing.ts must never duplicate that number, only look it up.
    expect(resolvePricing("deepseek", "deepseek-flash", null)).toEqual({ inputPerMTok: 0.28, outputPerMTok: 0.42 });
  });

  it("prices the local Ollama model at zero via the registry, same as the dedicated local-provider case", () => {
    expect(resolvePricing("ollama", "qwen3-coder:30b", null)).toEqual({ inputPerMTok: 0, outputPerMTok: 0 });
  });

  it("returns null for a registry provider's unlisted apiModel", () => {
    expect(resolvePricing("google", "gemini-1.0-pro", null)).toBeNull();
  });
});

describe("estimateCostUsd", () => {
  it("prices plain input/output tokens at the model's base rate", () => {
    const cost = estimateCostUsd("anthropic", "claude-opus-5", {
      ...noCache,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(5 + 25, 6);
  });

  it("applies Anthropic's cache write/read multipliers", () => {
    const cost = estimateCostUsd("anthropic", "claude-opus-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheWrite5mTokens: 1_000_000,
      cacheWrite1hTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    });
    // 5 * 1.25 (5m write) + 5 * 2 (1h write) + 5 * 0.1 (read)
    expect(cost).toBeCloseTo(6.25 + 10 + 0.5, 6);
  });

  it("applies OpenAI's milder cache-read discount and no write surcharge", () => {
    const cost = estimateCostUsd("openai", "gpt-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(1.25 * 0.5, 6);
  });

  it("returns null instead of a fabricated number when the price is unknown", () => {
    expect(estimateCostUsd("openrouter", "some/unknown-model", noCache)).toBeNull();
  });

  it("is always 0 for local models even with cache activity", () => {
    const cost = estimateCostUsd("local", "llama3.1", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheWrite5mTokens: 1_000_000,
      cacheWrite1hTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    });
    expect(cost).toBe(0);
  });
});
