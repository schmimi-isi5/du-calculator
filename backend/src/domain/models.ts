// The central Model Registry (spec: "Model Registry" in the LLM Service
// architecture). Every model the app can ever call is declared exactly once
// here - id, provider, wire-level API model string, display metadata, and
// pricing. Nothing outside this file may hard-code a model or API-model
// string; everywhere else refers to a model only by its registry `id`.
//
// Pure and config-free by design: whether a model is actually usable right
// now depends on which provider credentials are configured (an operational
// concern - see ai/providerAvailability.ts), so every function here that
// needs that answer takes it as an explicit `ProviderCredentials` argument
// instead of reading `config` itself. That keeps this module trivially unit
// -testable (see models.test.ts) and keeps "pure domain logic vs. runtime
// configuration" cleanly separated, consistent with domain/qualityLevels.ts.

import type { AIProviderName, QualityLevel } from "./types.js";

export type ModelCategory = "premium" | "balanced" | "budget" | "cost-performance" | "coding" | "local";

export interface ModelRegistryEntry {
  id: string;
  provider: AIProviderName;
  /** The literal string sent to the provider's API - never duplicated as a string anywhere outside this file. */
  apiModel: string;
  displayName: string;
  description: string;
  category: ModelCategory;
  enabled: boolean;
  local: boolean;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  contextWindow?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

// Prices are USD/MTok, mirroring ai/pricing.ts ModelPricing - kept here as
// the single source of truth for every model declared below; ai/pricing.ts
// falls back to this registry for any (provider, apiModel) it has no
// legacy static price for (see resolvePricing() there).
export const MODEL_REGISTRY: ModelRegistryEntry[] = [
  {
    id: "deepseek-v41-flash",
    provider: "deepseek",
    apiModel: "deepseek-flash",
    displayName: "DeepSeek V4.1 Flash",
    description: "Günstig · Coding. Bevorzugtes günstiges Coding-Modell.",
    category: "cost-performance",
    enabled: true,
    local: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 128_000,
    inputPricePerMillion: 0.28,
    outputPricePerMillion: 0.42,
  },
  {
    id: "gpt-6-astra",
    provider: "openai",
    apiModel: "gpt-6-astra",
    displayName: "GPT-6 Astra",
    description: "Premium · maximale Qualität. Für besonders komplexe Coding-, Architektur- und Agent-Aufgaben.",
    category: "premium",
    enabled: true,
    local: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 256_000,
    inputPricePerMillion: 5,
    outputPricePerMillion: 20,
  },
  {
    id: "gpt-5.6-luna",
    provider: "openai",
    apiModel: "gpt-5.6-luna",
    displayName: "GPT-5.6 Luna",
    description: "Sehr günstig · schnell. Für günstige Standardanfragen mit hohem Request-Volumen.",
    category: "budget",
    enabled: true,
    local: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 128_000,
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
  },
  {
    id: "gemini-3.8-flash",
    provider: "google",
    apiModel: "gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    description: "Balanced · großer Kontext. Für große Kontexte, Coding und agentische Aufgaben.",
    category: "balanced",
    enabled: true,
    local: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 1_000_000,
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 1.2,
  },
  {
    id: "claude-fable-5",
    provider: "anthropic",
    apiModel: "claude-fable-5",
    displayName: "Claude Fable 5",
    description: "Premium.",
    category: "premium",
    enabled: true,
    local: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 200_000,
    inputPricePerMillion: 10,
    outputPricePerMillion: 50,
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    apiModel: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    description: "Balanced · ~60% günstiger als Opus 5/Fable 5, für die meisten Anforderungen ausreichend.",
    category: "balanced",
    enabled: true,
    local: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 200_000,
    inputPricePerMillion: 2,
    outputPricePerMillion: 10,
  },
  {
    id: "claude-opus-5",
    provider: "anthropic",
    apiModel: "claude-opus-5",
    displayName: "Claude Opus 5",
    description: "Premium · höchste Qualität, teuerstes Anthropic-Modell.",
    category: "premium",
    enabled: true,
    local: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 200_000,
    inputPricePerMillion: 5,
    outputPricePerMillion: 25,
  },
  {
    id: "qwen3-coder-next",
    provider: "qwen",
    apiModel: "qwen3-coder-next",
    displayName: "Qwen3 Coder Next",
    description: "Coding.",
    category: "coding",
    enabled: true,
    local: false,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 256_000,
    inputPricePerMillion: 0.4,
    outputPricePerMillion: 1.6,
  },
  {
    id: "qwen3-coder-local",
    provider: "ollama",
    apiModel: "qwen3-coder:30b",
    displayName: "Qwen3 Coder 30B – Local",
    description: "Lokal · keine API-Kosten.",
    category: "local",
    enabled: true,
    local: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 32_000,
    // Local: API cost is always 0 - this is the API cost, not the actual
    // total cost of ownership (electricity, hardware, ...). See section 11.
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
  },
];

/**
 * OpenRouter is a gateway to hundreds of upstream models, not a fixed
 * catalog like the other providers - there is no sensible fixed list of
 * OpenRouter entries to hard-code here. Instead, the operator names exactly
 * the OpenRouter model slugs they want selectable (OPENROUTER_MODELS, see
 * config.ts), and this turns each into a registry entry at request time.
 * Deliberately has no price fields: OpenRouter's per-model pricing varies by
 * upstream provider and isn't fixed/verifiable from here - see
 * ai/pricing.ts, which already treats "openrouter" as a no-fixed-price
 * provider for exactly this reason.
 */
export function buildOpenRouterEntries(modelSlugs: string[]): ModelRegistryEntry[] {
  return modelSlugs.map((slug) => ({
    id: slug,
    provider: "openrouter",
    apiModel: slug,
    displayName: humanizeOpenRouterSlug(slug),
    description: "Über OpenRouter - Preis variiert je nach zugrunde liegendem Modell.",
    category: "balanced",
    enabled: true,
    local: false,
    supportsTools: true,
    supportsStructuredOutput: true,
  }));
}

function humanizeOpenRouterSlug(slug: string): string {
  const name = slug.includes("/") ? slug.slice(slug.indexOf("/") + 1) : slug;
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

/** The full set of models this deployment could offer - curated entries plus the operator's configured OpenRouter models. */
export function buildEffectiveRegistry(openRouterModelSlugs: string[]): ModelRegistryEntry[] {
  return [...MODEL_REGISTRY, ...buildOpenRouterEntries(openRouterModelSlugs)];
}

/** Pseudo model id, never a MODEL_REGISTRY entry - resolved to a concrete id by resolveAutoModel() before any AI call. */
export const AUTO_MODEL_ID = "auto";

export function getModelById(id: string, registry: ModelRegistryEntry[] = MODEL_REGISTRY): ModelRegistryEntry | undefined {
  return registry.find((m) => m.id === id);
}

/** Finds the registry entry a logged (provider, apiModel) pair refers to - used by ai/pricing.ts to price calls by the raw string the API actually returned. */
export function findByProviderAndApiModel(
  provider: AIProviderName,
  apiModel: string,
  registry: ModelRegistryEntry[] = MODEL_REGISTRY,
): ModelRegistryEntry | undefined {
  return registry.find((m) => m.provider === provider && m.apiModel === apiModel);
}

/**
 * Whether the credentials this deployment has configured are sufficient to
 * actually call this model. Ollama needs no API key - "configured" for it
 * just means the app knows a base URL to try (always true; a hardcoded
 * localhost default exists), NOT that the server is currently reachable -
 * reachability is a live, runtime concern (see ai/ollamaStatus.ts), not a
 * configuration one.
 */
export interface ProviderCredentials {
  anthropic: boolean;
  openai: boolean;
  deepseek: boolean;
  google: boolean;
  qwen: boolean;
  openrouter: boolean;
}

export function isModelConfigured(entry: ModelRegistryEntry, credentials: ProviderCredentials): boolean {
  switch (entry.provider) {
    case "ollama":
      return true;
    case "anthropic":
      return credentials.anthropic;
    case "openai":
      return credentials.openai;
    case "deepseek":
      return credentials.deepseek;
    case "google":
      return credentials.google;
    case "qwen":
      return credentials.qwen;
    case "openrouter":
      return credentials.openrouter;
    default:
      // "local": the legacy single-active-provider path, not part of the
      // registry-driven multi-model flow.
      return false;
  }
}

/** Enabled models this deployment can actually call right now. */
export function listAvailableModels(
  credentials: ProviderCredentials,
  registry: ModelRegistryEntry[] = MODEL_REGISTRY,
): ModelRegistryEntry[] {
  return registry.filter((m) => m.enabled && isModelConfigured(m, credentials));
}

/** True for `AUTO_MODEL_ID` or any id `listAvailableModels` would return - the full set of values a client may legally send as `model`. */
export function isSelectableModel(
  value: unknown,
  credentials: ProviderCredentials,
  registry: ModelRegistryEntry[] = MODEL_REGISTRY,
): value is string {
  if (typeof value !== "string") return false;
  if (value === AUTO_MODEL_ID) return true;
  return listAvailableModels(credentials, registry).some((m) => m.id === value);
}

// Models expensive enough that they must never be picked silently - neither
// as the zero-config default nor as an Auto-mode fallback - unless an
// operator explicitly opts in (config.allowPremiumAutoFallback).
const PREMIUM_MODEL_IDS = new Set(["gpt-6-astra", "claude-fable-5", "claude-opus-5"]);

// DeepSeek V4.1 Flash -> GPT-5.6 Luna -> Gemini 3.8 Flash -> local Qwen -
// the order a zero-config default or Auto-mode fallback walks when the
// preferred pick isn't configured. The local model is always last: it's
// free and always "configured" (no API key needed), so it's the guaranteed
// final rung of the ladder rather than a preference on its own. Premium
// models are spliced in just above it, and only when `allowPremiumFallback`
// is set - an operator has to opt in before an expensive model is ever
// picked automatically, but once they have, a configured premium model
// still wins over silently falling back to a (possibly weaker) local model.
const NON_PREMIUM_CLOUD_FALLBACK = ["deepseek-v41-flash", "gpt-5.6-luna", "gemini-3.8-flash"];
const PREMIUM_FALLBACK_ORDER = ["gpt-6-astra", "claude-fable-5", "claude-opus-5"];
const LOCAL_FALLBACK_ID = "qwen3-coder-local";

export class NoAvailableModelError extends Error {
  constructor() {
    super(
      "No LLM model is available. Configure at least one provider API key (or OLLAMA_BASE_URL for a local model).",
    );
    this.name = "NoAvailableModelError";
  }
}

/**
 * The model a request falls back to when it doesn't explicitly choose one:
 * DEFAULT_LLM_MODEL if configured and available, else the first available
 * model in the fallback order. Throws NoAvailableModelError if literally
 * nothing is configured - callers turn that into a user-facing error rather
 * than silently picking an arbitrary model.
 */
export function resolveDefaultModel(
  credentials: ProviderCredentials,
  configuredDefaultId: string | null,
  allowPremiumFallback: boolean,
  registry: ModelRegistryEntry[] = MODEL_REGISTRY,
): string {
  const available = listAvailableModels(credentials, registry);
  const availableIds = new Set(available.map((m) => m.id));

  if (configuredDefaultId && availableIds.has(configuredDefaultId)) return configuredDefaultId;

  const order = [
    ...NON_PREMIUM_CLOUD_FALLBACK,
    ...(allowPremiumFallback ? PREMIUM_FALLBACK_ORDER : []),
    LOCAL_FALLBACK_ID,
  ];
  const fallback = order.find((id) => availableIds.has(id));
  if (fallback) return fallback;

  // Nothing in the preferred order is available either - fall back to
  // whatever else is configured (excluding premium unless opted in) before
  // giving up entirely.
  const anyNonPremium = available.find((m) => allowPremiumFallback || !PREMIUM_MODEL_IDS.has(m.id));
  if (anyNonPremium) return anyNonPremium.id;

  throw new NoAvailableModelError();
}

/**
 * Signals the deterministic Auto-routing rule table can use today, from
 * information this app already has at the point a model must be chosen.
 * Deliberately minimal - see the file comment on AUTO_ROUTING_RULES for how
 * to extend this once more signals (prompt length, file counts, failed
 * tests, ...) become available.
 */
export interface AutoRoutingCriteria {
  qualityLevel: QualityLevel;
  /** True once the repository context handed to the AI call is large (see RepositoryContextBuilder's budget) - a proxy for "needs a big context window". */
  isLargeContext: boolean;
  /** True when the request must never leave this machine - forces the local model regardless of every other rule, with no cloud fallback. */
  localOnly: boolean;
}

interface AutoRoutingRule {
  description: string;
  matches: (criteria: AutoRoutingCriteria) => boolean;
  modelId: string;
}

// Deterministic, rule-based routing (spec section 8: "KEIN LLM soll darüber
// entscheiden, welches andere LLM verwendet wird"). Rules are evaluated in
// order; the first match wins. Extend this list - do not add branching
// logic elsewhere - as more criteria become available (file count, prompt
// length, token count, task type, failed tests, retry count, repo size,
// tool use, ...); each becomes one more field on AutoRoutingCriteria and one
// more rule here.
const AUTO_ROUTING_RULES: AutoRoutingRule[] = [
  {
    description: "local/private -> local Qwen, no exceptions",
    matches: (c) => c.localOnly,
    modelId: "qwen3-coder-local",
  },
  {
    description: "large context -> Gemini 3.8 Flash",
    matches: (c) => c.isLargeContext,
    modelId: "gemini-3.8-flash",
  },
  {
    description: "thorough/complex task -> GPT-6 Astra",
    matches: (c) => c.qualityLevel === "thorough",
    modelId: "gpt-6-astra",
  },
  {
    description: "quick/simple task -> GPT-5.6 Luna",
    matches: (c) => c.qualityLevel === "quick",
    modelId: "gpt-5.6-luna",
  },
  {
    description: "standard coding task -> DeepSeek V4.1 Flash",
    matches: () => true,
    modelId: "deepseek-v41-flash",
  },
];

/**
 * Resolves AUTO_MODEL_ID to a concrete, available model id. Never falls
 * back to a cloud model when `criteria.localOnly` is set - if the local
 * model isn't configured/available in that case, this throws rather than
 * silently choosing a cloud provider (spec section 9).
 */
export function resolveAutoModel(
  criteria: AutoRoutingCriteria,
  credentials: ProviderCredentials,
  allowPremiumFallback: boolean,
  registry: ModelRegistryEntry[] = MODEL_REGISTRY,
): string {
  if (criteria.localOnly) {
    const local = getModelById("qwen3-coder-local", registry);
    if (!local || !local.enabled || !isModelConfigured(local, credentials)) {
      throw new NoAvailableModelError();
    }
    return local.id;
  }

  const availableIds = new Set(listAvailableModels(credentials, registry).map((m) => m.id));
  const rule = AUTO_ROUTING_RULES.find((r) => r.matches(criteria) && availableIds.has(r.modelId));
  if (rule) return rule.modelId;

  // The rule table's pick isn't configured - degrade to the same
  // zero-config default fallback chain rather than failing outright.
  return resolveDefaultModel(credentials, null, allowPremiumFallback, registry);
}
