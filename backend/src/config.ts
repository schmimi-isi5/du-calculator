// Central environment configuration. Fails fast at startup on missing/malformed
// required configuration (DATABASE_URL) - AI provider credentials are the
// one exception, checked lazily by getAIProvider(), since cloning a
// repository does not require an AI call.

import type { AIProviderName } from "./domain/types.js";

const AI_PROVIDERS: readonly AIProviderName[] = ["anthropic", "openai", "openrouter", "local"];

function parseAIProvider(): AIProviderName {
  const raw = process.env.AI_PROVIDER || "anthropic";
  if (!AI_PROVIDERS.includes(raw as AIProviderName)) {
    throw new Error(`Invalid AI_PROVIDER: "${raw}" must be one of: ${AI_PROVIDERS.join(", ")}.`);
  }
  return raw as AIProviderName;
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
};
