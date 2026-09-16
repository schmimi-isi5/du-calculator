import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getAIProvider", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("throws a clear AIProviderError when no API key is configured, instead of silently proceeding", async () => {
    const { getAIProvider } = await import("./getAIProvider.js");
    const { AIProviderError } = await import("./AIProvider.js");

    expect(() => getAIProvider()).toThrow(AIProviderError);
    expect(() => getAIProvider()).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("getAIProviderForModel", () => {
  const keysToRestore = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "GOOGLE_AI_API_KEY",
    "QWEN_API_KEY",
  ] as const;
  const originalValues = Object.fromEntries(keysToRestore.map((k) => [k, process.env[k]]));

  beforeEach(() => {
    vi.resetModules();
    for (const key of keysToRestore) delete process.env[key];
  });

  afterEach(() => {
    for (const key of keysToRestore) {
      const original = originalValues[key];
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });

  it("throws provider_unavailable for a cloud provider with no API key configured", async () => {
    const { getAIProviderForModel } = await import("./getAIProvider.js");
    const { getModelById } = await import("../domain/models.js");
    const { AIProviderError } = await import("./AIProvider.js");

    const entry = getModelById("deepseek-v41-flash")!;
    try {
      getAIProviderForModel(entry);
      expect.unreachable("expected getAIProviderForModel to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as InstanceType<typeof AIProviderError>).code).toBe("provider_unavailable");
    }
  });

  it("builds a provider instance for Ollama without requiring any API key", async () => {
    const { getAIProviderForModel } = await import("./getAIProvider.js");
    const { getModelById } = await import("../domain/models.js");

    const entry = getModelById("qwen3-coder-local")!;
    expect(() => getAIProviderForModel(entry)).not.toThrow();
  });

  it("returns the same cached instance for two models of the same provider", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { getAIProviderForModel } = await import("./getAIProvider.js");
    const { getModelById } = await import("../domain/models.js");

    const opus = getAIProviderForModel(getModelById("claude-opus-5")!);
    const sonnet = getAIProviderForModel(getModelById("claude-sonnet-5")!);
    expect(opus).toBe(sonnet);
  });
});
