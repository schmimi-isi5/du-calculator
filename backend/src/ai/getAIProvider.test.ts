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
