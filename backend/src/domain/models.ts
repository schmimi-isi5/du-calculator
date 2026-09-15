// Which model a run may pick, per provider. Deliberately curated rather
// than "any string the user types": every model listed here has been
// verified to accept the exact request shape AnthropicProvider always
// sends (adaptive thinking + the full low-max output_config.effort range,
// see domain/qualityLevels.ts). Claude Haiku 4.5 and pre-4.7 Anthropic
// models are excluded on purpose - they use a different thinking API
// (budget_tokens) and/or don't support "xhigh" effort, which the
// "thorough" quality level relies on; adding them means adding a second
// request-shape branch in AnthropicProvider, not just a new list entry.

import type { AIProviderName } from "./types.js";

export interface SelectableModel {
  id: string;
  label: string;
  description: string;
}

export const ANTHROPIC_SELECTABLE_MODELS: SelectableModel[] = [
  {
    id: "claude-opus-5",
    label: "Claude Opus 5",
    description: "Höchste Qualität, teuerstes Modell.",
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    description: "~60% günstiger als Opus 5, für die meisten Anforderungen ausreichend.",
  },
];

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

/**
 * The models a run may pick from, for the currently configured provider.
 * Only "anthropic" has a curated list (see the file comment above) -
 * openai/openrouter/local each run exactly one operator-configured model
 * (AI_MODEL), so there is nothing to choose between at request time.
 */
export function selectableModelsFor(provider: AIProviderName, configuredModel: string): SelectableModel[] {
  if (provider === "anthropic") return ANTHROPIC_SELECTABLE_MODELS;
  return [{ id: configuredModel, label: configuredModel, description: "Über AI_MODEL konfiguriert." }];
}

export function isSelectableAnthropicModel(value: unknown): value is string {
  return typeof value === "string" && ANTHROPIC_SELECTABLE_MODELS.some((m) => m.id === value);
}
