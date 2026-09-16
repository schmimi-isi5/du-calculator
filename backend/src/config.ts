// Central environment configuration. Fails fast at startup on missing/malformed
// required configuration (DATABASE_URL) - AI provider credentials are the
// one exception, checked lazily by getAIProvider(), since cloning a
// repository does not require an AI call.

import type { AIProviderName } from "./domain/types.js";

// The legacy single-active-provider pointer (see ai/getAIProvider.ts
// getAIProvider()) only ever supports these four - "deepseek" | "google" |
// "qwen" | "ollama" are registry-native providers (domain/models.ts),
// configured independently and never selected via AI_PROVIDER.
export type LegacyAIProviderName = Extract<AIProviderName, "anthropic" | "openai" | "openrouter" | "local">;

const AI_PROVIDERS: readonly LegacyAIProviderName[] = ["anthropic", "openai", "openrouter", "local"];

function parseAIProvider(): LegacyAIProviderName {
  const raw = process.env.AI_PROVIDER || "anthropic";
  if (!AI_PROVIDERS.includes(raw as LegacyAIProviderName)) {
    throw new Error(`Invalid AI_PROVIDER: "${raw}" must be one of: ${AI_PROVIDERS.join(", ")}.`);
  }
  return raw as LegacyAIProviderName;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${name}: "${raw}" must be a positive integer.`);
  }
  return value;
}

function parsePriceEnv(name: string, fallback: number | null): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${name}: "${raw}" must be a non-negative number.`);
  }
  return value;
}

export const config = {
  port: parseIntEnv("PORT", 4000),
  databaseUrl: requireEnv("DATABASE_URL"),
  pricePerDU: parsePriceEnv("PRICE_PER_DU", 300),
  gitCloneTimeoutMs: parseIntEnv("GIT_CLONE_TIMEOUT_MS", 60_000),
  gitMaxRepoFiles: parseIntEnv("GIT_MAX_REPO_FILES", 5000),

  // Which AIProvider implementation is active (see ai/getAIProvider.ts) and
  // its credentials/settings. AI_MODEL is optional for "anthropic" (defaults
  // to claude-opus-5, preserving prior behavior) and required for every
  // other provider - there is no universally sensible default model for an
  // arbitrary OpenAI-compatible endpoint.
  aiProvider: parseAIProvider(),
  aiModel: process.env.AI_MODEL || null,
  aiBaseUrl: process.env.AI_BASE_URL || null,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
  openaiApiKey: process.env.OPENAI_API_KEY || null,
  openrouterApiKey: process.env.OPENROUTER_API_KEY || null,
  localAiApiKey: process.env.LOCAL_AI_API_KEY || null,

  // Only consulted for providers with no fixed price list (OpenRouter,
  // local) - see ai/pricing.ts. Leave unset to log tokens with cost "unknown"
  // rather than a guessed number.
  aiCustomInputPricePerMTok: parsePriceEnv("AI_CUSTOM_INPUT_PRICE_PER_MTOK", null),
  aiCustomOutputPricePerMTok: parsePriceEnv("AI_CUSTOM_OUTPUT_PRICE_PER_MTOK", null),

  // Multi-LLM Model Registry (domain/models.ts) - each provider below is
  // independently configured and selectable per request, decoupled from the
  // single AI_PROVIDER pointer above. A provider with no API key set here
  // simply has no available models in the registry (see
  // ai/providerAvailability.ts) rather than failing startup - exactly like
  // the existing lazy ANTHROPIC_API_KEY check.
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || null,
  googleApiKey: process.env.GOOGLE_AI_API_KEY || null,
  qwenApiKey: process.env.QWEN_API_KEY || null,
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
  googleBaseUrl: process.env.GOOGLE_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/",
  qwenBaseUrl: process.env.QWEN_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  // No API key required - Ollama serves locally. Never hard-code the
  // address; see spec section 5.
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",

  // The model a request falls back to when it doesn't choose one explicitly
  // (domain/models.ts resolveDefaultModel). Unset means "use the built-in
  // fallback order" rather than a hard-coded id.
  defaultLlmModel: process.env.DEFAULT_LLM_MODEL || null,
  // GPT-6 Astra / Claude Fable 5 / Claude Opus 5 are excluded from the
  // zero-config default and from Auto-mode fallback by default (spec
  // section 7/8) - an operator opts in explicitly, they are never picked
  // silently just because they happen to be configured.
  allowPremiumAutoFallback: process.env.LLM_ALLOW_PREMIUM_FALLBACK === "true",
};
