// Single place that decides which AIProvider implementation is active.
// Swapping in a future KonturosProvider means adding a branch here - no
// other module imports AnthropicProvider directly.

import { AnthropicProvider } from "./AnthropicProvider.js";
import type { AIProvider } from "./AIProvider.js";
import { AIProviderError } from "./AIProvider.js";
import { config } from "../config.js";

let cached: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (cached) return cached;

  if (!config.anthropicApiKey) {
    throw new AIProviderError(
      "No AI provider is configured. Set ANTHROPIC_API_KEY in the backend environment to enable AI-based analysis.",
    );
  }

  cached = new AnthropicProvider(config.anthropicApiKey);
  return cached;
}
