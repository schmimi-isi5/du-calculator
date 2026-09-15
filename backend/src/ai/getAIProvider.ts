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
