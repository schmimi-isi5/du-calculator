import { describe, expect, it } from "vitest";
import {
  AUTO_MODEL_ID,
  buildEffectiveRegistry,
  buildOpenRouterEntries,
  findByProviderAndApiModel,
  getModelById,
  isModelConfigured,
  isSelectableModel,
  listAvailableModels,
  MODEL_REGISTRY,
  NoAvailableModelError,
  resolveAutoModel,
  resolveDefaultModel,
  type ProviderCredentials,
} from "./models.js";

const NO_CREDENTIALS: ProviderCredentials = {
  anthropic: false,
  openai: false,
  deepseek: false,
  google: false,
  qwen: false,
  openrouter: false,
};

const ALL_CREDENTIALS: ProviderCredentials = {
  anthropic: true,
  openai: true,
  deepseek: true,
  google: true,
  qwen: true,
  openrouter: true,
};

describe("MODEL_REGISTRY", () => {
  it("has a unique id for every entry", () => {
    const ids = MODEL_REGISTRY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes every model requested for the multi-LLM architecture", () => {
    const ids = MODEL_REGISTRY.map((m) => m.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "deepseek-v41-flash",
        "gpt-6-astra",
        "gpt-5.6-luna",
        "gemini-3.8-flash",
        "claude-fable-5",
        "claude-sonnet-5",
        "qwen3-coder-next",
        "qwen3-coder-local",
      ]),
    );
  });

  it("marks exactly the local Ollama model as local", () => {
    const localIds = MODEL_REGISTRY.filter((m) => m.local).map((m) => m.id);
    expect(localIds).toEqual(["qwen3-coder-local"]);
  });

  it("gives the local model zero API cost", () => {
    const local = getModelById("qwen3-coder-local")!;
    expect(local.inputPricePerMillion).toBe(0);
    expect(local.outputPricePerMillion).toBe(0);
  });
});

describe("getModelById / findByProviderAndApiModel", () => {
  it("finds a known entry by id", () => {
    expect(getModelById("deepseek-v41-flash")?.provider).toBe("deepseek");
  });

  it("returns undefined for an unknown id", () => {
    expect(getModelById("no-such-model")).toBeUndefined();
  });

  it("finds an entry by (provider, apiModel) - the pair the usage log actually stores", () => {
    const entry = findByProviderAndApiModel("deepseek", "deepseek-flash");
    expect(entry?.id).toBe("deepseek-v41-flash");
  });

  it("returns undefined for an unlisted (provider, apiModel) pair", () => {
    expect(findByProviderAndApiModel("openai", "gpt-3.5-turbo")).toBeUndefined();
  });
});

describe("isModelConfigured", () => {
  it("never requires a credential for the local Ollama model", () => {
    const local = getModelById("qwen3-coder-local")!;
    expect(isModelConfigured(local, NO_CREDENTIALS)).toBe(true);
  });

  it("requires the matching provider credential for every cloud model", () => {
    const deepseek = getModelById("deepseek-v41-flash")!;
    expect(isModelConfigured(deepseek, NO_CREDENTIALS)).toBe(false);
    expect(isModelConfigured(deepseek, { ...NO_CREDENTIALS, deepseek: true })).toBe(true);
  });
});

describe("listAvailableModels / isSelectableModel", () => {
  it("with no credentials, only the local model is available", () => {
    const available = listAvailableModels(NO_CREDENTIALS);
    expect(available.map((m) => m.id)).toEqual(["qwen3-coder-local"]);
  });

  it("with every credential configured, every enabled model is available", () => {
    const available = listAvailableModels(ALL_CREDENTIALS);
    expect(available.length).toBe(MODEL_REGISTRY.filter((m) => m.enabled).length);
  });

  it("AUTO_MODEL_ID is always selectable, regardless of credentials", () => {
    expect(isSelectableModel(AUTO_MODEL_ID, NO_CREDENTIALS)).toBe(true);
  });

  it("rejects a model id whose provider isn't configured", () => {
    expect(isSelectableModel("deepseek-v41-flash", NO_CREDENTIALS)).toBe(false);
    expect(isSelectableModel("deepseek-v41-flash", { ...NO_CREDENTIALS, deepseek: true })).toBe(true);
  });

  it("rejects non-string and unknown values", () => {
    expect(isSelectableModel(undefined, ALL_CREDENTIALS)).toBe(false);
    expect(isSelectableModel("not-a-model", ALL_CREDENTIALS)).toBe(false);
  });
});

describe("resolveDefaultModel", () => {
  it("uses DEFAULT_LLM_MODEL when configured and available", () => {
    expect(resolveDefaultModel(ALL_CREDENTIALS, "gemini-3.8-flash", false)).toBe("gemini-3.8-flash");
  });

  it("ignores a configured default that isn't available and falls through the chain", () => {
    expect(resolveDefaultModel({ ...NO_CREDENTIALS, google: true }, "deepseek-v41-flash", false)).toBe(
      "gemini-3.8-flash",
    );
  });

  it("walks DeepSeek -> Luna -> Gemini -> local Qwen when nothing is configured explicitly", () => {
    expect(resolveDefaultModel(ALL_CREDENTIALS, null, false)).toBe("deepseek-v41-flash");
    expect(resolveDefaultModel({ ...NO_CREDENTIALS, openai: true }, null, false)).toBe("gpt-5.6-luna");
  });

  it("falls back to the always-available local model when no cloud provider is configured", () => {
    expect(resolveDefaultModel(NO_CREDENTIALS, null, false)).toBe("qwen3-coder-local");
  });

  it("never picks a premium model as the zero-config default unless explicitly allowed", () => {
    // Only Anthropic is configured, which for this deployment has nothing
    // but premium models - without opting in, the free local model must
    // win instead; only once allowed does the configured premium model
    // outrank the local fallback.
    const onlyAnthropic = { ...NO_CREDENTIALS, anthropic: true };
    expect(resolveDefaultModel(onlyAnthropic, null, false)).toBe("qwen3-coder-local");
    expect(resolveDefaultModel(onlyAnthropic, null, true)).toBe("claude-fable-5");
  });

  it("never throws NoAvailableModelError in practice, since the local model always needs no credential", () => {
    // NoAvailableModelError exists for defense in depth (see its own
    // constructor message) - with today's registry it's unreachable from
    // resolveDefaultModel because the local model is always "configured".
    expect(() => resolveDefaultModel(NO_CREDENTIALS, null, false)).not.toThrow();
  });
});

describe("resolveAutoModel", () => {
  it("routes a large context to Gemini 3.8 Flash", () => {
    const modelId = resolveAutoModel(
      { qualityLevel: "standard", isLargeContext: true, localOnly: false },
      ALL_CREDENTIALS,
      false,
    );
    expect(modelId).toBe("gemini-3.8-flash");
  });

  it("routes a thorough/complex task to GPT-6 Astra only when premium fallback is allowed", () => {
    const criteria = { qualityLevel: "thorough" as const, isLargeContext: false, localOnly: false };
    expect(resolveAutoModel(criteria, ALL_CREDENTIALS, true)).toBe("gpt-6-astra");
  });

  it("degrades to the default fallback chain when the rule's pick isn't available", () => {
    const criteria = { qualityLevel: "thorough" as const, isLargeContext: false, localOnly: false };
    // GPT-6 Astra (the "thorough" rule's pick) isn't configured here, and
    // premium fallback is off - falls through to the same default chain
    // resolveDefaultModel uses.
    const withoutOpenAI = { ...ALL_CREDENTIALS, openai: false };
    expect(resolveAutoModel(criteria, withoutOpenAI, false)).toBe("deepseek-v41-flash");
  });

  it("routes a quick/simple task to GPT-5.6 Luna", () => {
    const criteria = { qualityLevel: "quick" as const, isLargeContext: false, localOnly: false };
    expect(resolveAutoModel(criteria, ALL_CREDENTIALS, false)).toBe("gpt-5.6-luna");
  });

  it("routes a standard task to DeepSeek V4.1 Flash", () => {
    const criteria = { qualityLevel: "standard" as const, isLargeContext: false, localOnly: false };
    expect(resolveAutoModel(criteria, ALL_CREDENTIALS, false)).toBe("deepseek-v41-flash");
  });

  it("always forces the local model when localOnly is set, regardless of other criteria", () => {
    const criteria = { qualityLevel: "thorough" as const, isLargeContext: true, localOnly: true };
    expect(resolveAutoModel(criteria, ALL_CREDENTIALS, true)).toBe("qwen3-coder-local");
  });

  it("resolves localOnly to the local model even with zero cloud credentials configured", () => {
    const criteria = { qualityLevel: "standard" as const, isLargeContext: false, localOnly: true };
    expect(resolveAutoModel(criteria, NO_CREDENTIALS, false)).toBe("qwen3-coder-local");
  });
});

describe("buildOpenRouterEntries", () => {
  it("creates one enabled, non-local registry entry per configured slug", () => {
    const entries = buildOpenRouterEntries(["anthropic/claude-3.7-sonnet", "mistralai/mixtral-8x22b-instruct"]);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.provider === "openrouter" && e.enabled && !e.local)).toBe(true);
  });

  it("uses the slug itself as both id and apiModel - never a second hard-coded string", () => {
    const [entry] = buildOpenRouterEntries(["deepseek/deepseek-r1"]);
    expect(entry!.id).toBe("deepseek/deepseek-r1");
    expect(entry!.apiModel).toBe("deepseek/deepseek-r1");
  });

  it("humanizes the slug's model segment into a display name", () => {
    const [entry] = buildOpenRouterEntries(["mistralai/mixtral-8x22b-instruct"]);
    expect(entry!.displayName).toBe("Mixtral 8x22b Instruct");
  });

  it("humanizes a slug with no provider prefix the same way", () => {
    const [entry] = buildOpenRouterEntries(["some-model-name"]);
    expect(entry!.displayName).toBe("Some Model Name");
  });

  it("declares no price fields - OpenRouter pricing varies per upstream model and is never guessed here", () => {
    const [entry] = buildOpenRouterEntries(["openai/gpt-4o"]);
    expect(entry!.inputPricePerMillion).toBeUndefined();
    expect(entry!.outputPricePerMillion).toBeUndefined();
  });

  it("returns an empty list for no configured slugs", () => {
    expect(buildOpenRouterEntries([])).toEqual([]);
  });
});

describe("buildEffectiveRegistry", () => {
  it("appends the configured OpenRouter models to the curated registry without altering it", () => {
    const registry = buildEffectiveRegistry(["anthropic/claude-3.7-sonnet"]);
    expect(registry.length).toBe(MODEL_REGISTRY.length + 1);
    expect(registry.slice(0, MODEL_REGISTRY.length)).toEqual(MODEL_REGISTRY);
    expect(registry.at(-1)?.id).toBe("anthropic/claude-3.7-sonnet");
  });

  it("is available once OPENROUTER_API_KEY-equivalent credentials are set, unavailable otherwise", () => {
    const registry = buildEffectiveRegistry(["anthropic/claude-3.7-sonnet"]);
    const entry = getModelById("anthropic/claude-3.7-sonnet", registry)!;
    expect(isModelConfigured(entry, NO_CREDENTIALS)).toBe(false);
    expect(isModelConfigured(entry, ALL_CREDENTIALS)).toBe(true);
  });

  it("lets an OpenRouter model be resolved via getModelById/listAvailableModels/isSelectableModel when passed the effective registry", () => {
    const registry = buildEffectiveRegistry(["anthropic/claude-3.7-sonnet"]);
    expect(isSelectableModel("anthropic/claude-3.7-sonnet", ALL_CREDENTIALS, registry)).toBe(true);
    expect(isSelectableModel("anthropic/claude-3.7-sonnet", NO_CREDENTIALS, registry)).toBe(false);
    expect(listAvailableModels(ALL_CREDENTIALS, registry).map((m) => m.id)).toContain("anthropic/claude-3.7-sonnet");
  });

  it("never makes an OpenRouter model selectable against the default (curated-only) registry", () => {
    // A caller that forgets to pass the effective registry falls back to
    // MODEL_REGISTRY, where OpenRouter models never appear - this is the
    // guarantee that catches that mistake instead of silently ignoring it.
    expect(isSelectableModel("anthropic/claude-3.7-sonnet", ALL_CREDENTIALS)).toBe(false);
  });
});
