// Single place that decides which AIProvider implementation is active,
// selected by the AI_PROVIDER environment variable (see config.ts):
// "anthropic" (default), "openai", "openrouter", or "local" - the latter
// three all backed by OpenAICompatibleProvider, distinguished only by
// baseURL/model. Swapping in a future KonturosProvider means adding a
// branch here - no other module imports a concrete provider class directly.

import { AnthropicProvider } from "./AnthropicProvider.js";
import type { AIProvider } from "./AIProvider.js";
import { AIProviderError } from "./AIProvider.js";
import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider.js";
import { config } from "../config.js";
import type { ModelRegistryEntry } from "../domain/models.js";
import type { AIProviderName } from "../domain/types.js";

const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const LOCAL_DEFAULT_BASE_URL = "http://localhost:11434/v1"; // Ollama's OpenAI-compatible endpoint

let cached: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (cached) return cached;

  switch (config.aiProvider) {
    case "anthropic": {
      if (!config.anthropicApiKey) {
        throw new AIProviderError(
          "No AI provider is configured. Set ANTHROPIC_API_KEY in the backend environment to enable AI-based analysis.",
        );
      }
      cached = new AnthropicProvider(config.anthropicApiKey, config.aiModel ?? undefined);
      break;
    }
    case "openai": {
      if (!config.openaiApiKey) {
        throw new AIProviderError("AI_PROVIDER=openai requires OPENAI_API_KEY to be set.");
      }
      if (!config.aiModel) {
        throw new AIProviderError("AI_PROVIDER=openai requires AI_MODEL to be set (e.g. \"gpt-5\").");
      }
      cached = new OpenAICompatibleProvider({
        providerName: "openai",
        apiKey: config.openaiApiKey,
        baseURL: config.aiBaseUrl ?? undefined,
        model: config.aiModel,
      });
      break;
    }
    case "openrouter": {
      if (!config.openrouterApiKey) {
        throw new AIProviderError("AI_PROVIDER=openrouter requires OPENROUTER_API_KEY to be set.");
      }
      if (!config.aiModel) {
        throw new AIProviderError(
          'AI_PROVIDER=openrouter requires AI_MODEL to be set (e.g. "deepseek/deepseek-chat").',
        );
      }
      cached = new OpenAICompatibleProvider({
        providerName: "openrouter",
        apiKey: config.openrouterApiKey,
        baseURL: config.aiBaseUrl ?? OPENROUTER_DEFAULT_BASE_URL,
        model: config.aiModel,
      });
      break;
    }
    case "local": {
      if (!config.aiModel) {
        throw new AIProviderError('AI_PROVIDER=local requires AI_MODEL to be set (e.g. "llama3.1").');
      }
      cached = new OpenAICompatibleProvider({
        providerName: "local",
        apiKey: config.localAiApiKey ?? "not-needed",
        baseURL: config.aiBaseUrl ?? LOCAL_DEFAULT_BASE_URL,
        model: config.aiModel,
      });
      break;
    }
  }

  return cached;
}

// ---------------------------------------------------------------------------
// Model Registry-driven resolution (multi-LLM architecture)
// ---------------------------------------------------------------------------
//
// One AIProvider instance per distinct registry `provider` value, created on
// first use and reused for every model of that provider (they share the
// same credentials/baseURL - only the per-call `model` argument differs,
// and every AIProvider method already takes that as an explicit parameter).
// This is deliberately independent of the legacy getAIProvider() singleton
// above: a deployment can have AI_PROVIDER=anthropic configured for
// repository analysis while simultaneously offering DeepSeek/OpenAI/Google/
// Qwen/Ollama models for per-requirement selection, because each provider's
// availability here depends only on its own credential, never on
// config.aiProvider.

const providerInstances = new Map<AIProviderName, AIProvider>();

function buildProviderInstance(provider: AIProviderName): AIProvider {
  switch (provider) {
    case "anthropic": {
      if (!config.anthropicApiKey) {
        throw new AIProviderError(
          "ANTHROPIC_API_KEY is not configured - cannot use an Anthropic model.",
          "provider_unavailable",
        );
      }
      return new AnthropicProvider(config.anthropicApiKey);
    }
    case "openai": {
      if (!config.openaiApiKey) {
        throw new AIProviderError("OPENAI_API_KEY is not configured - cannot use an OpenAI model.", "provider_unavailable");
      }
      return new OpenAICompatibleProvider({ providerName: "openai", apiKey: config.openaiApiKey, model: config.aiModel ?? "" });
    }
    case "deepseek": {
      if (!config.deepseekApiKey) {
        throw new AIProviderError("DEEPSEEK_API_KEY is not configured - cannot use a DeepSeek model.", "provider_unavailable");
      }
      return new OpenAICompatibleProvider({
        providerName: "deepseek",
        apiKey: config.deepseekApiKey,
        baseURL: config.deepseekBaseUrl,
        model: "",
      });
    }
    case "google": {
      if (!config.googleApiKey) {
        throw new AIProviderError("GOOGLE_AI_API_KEY is not configured - cannot use a Gemini model.", "provider_unavailable");
      }
      return new OpenAICompatibleProvider({
        providerName: "google",
        apiKey: config.googleApiKey,
        baseURL: config.googleBaseUrl,
        model: "",
      });
    }
    case "qwen": {
      if (!config.qwenApiKey) {
        throw new AIProviderError("QWEN_API_KEY is not configured - cannot use a Qwen model.", "provider_unavailable");
      }
      return new OpenAICompatibleProvider({ providerName: "qwen", apiKey: config.qwenApiKey, baseURL: config.qwenBaseUrl, model: "" });
    }
    case "ollama": {
      return new OpenAICompatibleProvider({
        providerName: "ollama",
        apiKey: "not-needed",
        baseURL: `${config.ollamaBaseUrl.replace(/\/$/, "")}/v1`,
        model: "",
      });
    }
    case "openrouter":
    case "local":
      // Legacy single-pointer providers - not reachable through the
      // registry (domain/models.ts MODEL_REGISTRY has no entries for them).
      throw new AIProviderError(`"${provider}" is not a Model Registry provider.`, "model_unavailable");
  }
}

/** Resolves the AIProvider instance for a Model Registry entry (spec: LLM Service provider resolution). One instance is cached per provider, not per model. */
export function getAIProviderForModel(entry: ModelRegistryEntry): AIProvider {
  const existing = providerInstances.get(entry.provider);
  if (existing) return existing;

  const instance = buildProviderInstance(entry.provider);
  providerInstances.set(entry.provider, instance);
  return instance;
}
