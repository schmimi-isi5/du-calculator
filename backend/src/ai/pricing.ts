// Per-model $/MTok rates for turning raw token counts into a cost figure for
// the usage dashboard. Rates change over time and per provider - this table
// is a snapshot, not a live source; verify against the provider's current
// pricing page before trusting a number here for a model not yet listed.
//
// Providers without a fixed public price list (OpenRouter passes through
// whatever the underlying model charges; a local/self-hosted model has no
// per-token bill at all) intentionally return `null` from resolvePricing()
// rather than a guessed number - the usage log and dashboard show those
// calls as "cost unknown" instead of a fabricated $0 or an invented rate.
import type { AIProviderName } from "../domain/types.js";

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

// Cache economics are provider-specific, not a universal constant - Anthropic
// charges a write surcharge and a 0.1x read rate; OpenAI has no separate
// write charge and a milder read discount. Getting this wrong would silently
// misprice every cached call, so it is keyed by provider rather than
// hardcoded once. OpenRouter/local default to no discount (1x) since neither
// has one fixed, verifiable cache economics - better to slightly overstate
// than to invent a discount that may not apply to the underlying model.
interface CacheMultipliers {
  write5m: number;
  write1h: number;
  read: number;
}

const CACHE_MULTIPLIERS: Record<AIProviderName, CacheMultipliers> = {
  anthropic: { write5m: 1.25, write1h: 2, read: 0.1 },
  openai: { write5m: 1, write1h: 1, read: 0.5 },
  openrouter: { write5m: 1, write1h: 1, read: 1 },
  local: { write5m: 1, write1h: 1, read: 1 },
};

const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  "claude-fable-5-1": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-mythos-5-1": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

// Approximate, current at time of writing - OpenAI's own pricing page is
// authoritative; update this table when it drifts.
const OPENAI_PRICING: Record<string, ModelPricing> = {
  "gpt-5": { inputPerMTok: 1.25, outputPerMTok: 10 },
  "gpt-5-mini": { inputPerMTok: 0.25, outputPerMTok: 2 },
  "gpt-5-nano": { inputPerMTok: 0.05, outputPerMTok: 0.4 },
  "gpt-4.1": { inputPerMTok: 2, outputPerMTok: 8 },
  "gpt-4.1-mini": { inputPerMTok: 0.4, outputPerMTok: 1.6 },
  "gpt-4o": { inputPerMTok: 2.5, outputPerMTok: 10 },
  "gpt-4o-mini": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
};

function lookupStaticPricing(provider: AIProviderName, model: string): ModelPricing | null {
  if (provider === "anthropic") return ANTHROPIC_PRICING[model] ?? null;
  if (provider === "openai") return OPENAI_PRICING[model] ?? null;
  // OpenRouter: no fixed table (thousands of models, prices vary per
  // upstream provider and change independently of this app). Local: no
  // per-token billing at all. Both fall through to the custom-price
  // override below, or "unknown".
  return null;
}

export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
  /** Tokens written to a 5-minute-TTL cache entry this call. */
  cacheWrite5mTokens: number;
  /** Tokens written to a 1-hour-TTL cache entry this call. */
  cacheWrite1hTokens: number;
  /** Tokens read from any cache entry this call. */
  cacheReadTokens: number;
}

/**
 * Resolves the $/MTok rates to use for a (provider, model) pair: the static
 * table first, then a user-supplied custom rate (for OpenRouter/local models
 * this app has no fixed price for), else null ("unknown", never guessed).
 */
export function resolvePricing(
  provider: AIProviderName,
  model: string,
  customPricing: ModelPricing | null,
): ModelPricing | null {
  if (provider === "local") return { inputPerMTok: 0, outputPerMTok: 0 };
  return lookupStaticPricing(provider, model) ?? customPricing;
}

/** Returns the cost in USD for one call's token usage, or null if the (provider, model) has no known price. */
export function estimateCostUsd(
  provider: AIProviderName,
  model: string,
  tokens: UsageTokens,
  customPricing: ModelPricing | null = null,
): number | null {
  const pricing = resolvePricing(provider, model, customPricing);
  if (!pricing) return null;
  const cache = CACHE_MULTIPLIERS[provider];

  const regularInputCost = (tokens.inputTokens / 1_000_000) * pricing.inputPerMTok;
  const cacheWrite5mCost = (tokens.cacheWrite5mTokens / 1_000_000) * pricing.inputPerMTok * cache.write5m;
  const cacheWrite1hCost = (tokens.cacheWrite1hTokens / 1_000_000) * pricing.inputPerMTok * cache.write1h;
  const cacheReadCost = (tokens.cacheReadTokens / 1_000_000) * pricing.inputPerMTok * cache.read;
  const outputCost = (tokens.outputTokens / 1_000_000) * pricing.outputPerMTok;

  return regularInputCost + cacheWrite5mCost + cacheWrite1hCost + cacheReadCost + outputCost;
}
