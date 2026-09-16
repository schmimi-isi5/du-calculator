// Einstellungen tab: lets an operator see which LLM providers are
// configured and change the default model without an env var change +
// redeploy. Deliberately does NOT accept API keys or any other secret
// through this API - those stay in the environment (see env.example) and
// are only ever reported here as "configured: true/false", never echoed.

import { Router } from "express";
import { currentModelRegistry, currentProviderCredentials } from "../ai/providerAvailability.js";
import { AUTO_MODEL_ID, isModelConfigured, isSelectableModel } from "../domain/models.js";
import type { AIProviderName } from "../domain/types.js";
import { getSetting, setSetting, clearSetting, SETTINGS_KEYS } from "../store/AppSettingsStore.js";
import { asyncHandler } from "./asyncHandler.js";
import { defaultModelId } from "./requirementContextService.js";

export const settingsRouter = Router();

// Which env var configures each provider's credential - shown so an
// operator knows what to set, never the value itself. "local" is the
// legacy AI_PROVIDER pointer, not a registry-native provider - excluded here.
const PROVIDER_INFO: { id: Exclude<AIProviderName, "local">; envVar: string }[] = [
  { id: "anthropic", envVar: "ANTHROPIC_API_KEY" },
  { id: "openai", envVar: "OPENAI_API_KEY" },
  { id: "deepseek", envVar: "DEEPSEEK_API_KEY" },
  { id: "google", envVar: "GOOGLE_AI_API_KEY" },
  { id: "qwen", envVar: "QWEN_API_KEY" },
  { id: "openrouter", envVar: "OPENROUTER_API_KEY + OPENROUTER_MODELS" },
  { id: "ollama", envVar: "OLLAMA_BASE_URL (kein API-Key nötig)" },
];

async function buildSettingsSnapshot() {
  const credentials = currentProviderCredentials();
  const registry = currentModelRegistry();
  const override = await getSetting(SETTINGS_KEYS.defaultModelId);

  return {
    autoModelId: AUTO_MODEL_ID,
    defaultModelId: await defaultModelId(),
    defaultModelOverride: override,
    models: registry.filter((m) => m.enabled).map((m) => ({ ...m, available: isModelConfigured(m, credentials) })),
    providers: PROVIDER_INFO.map((p) => ({
      id: p.id,
      envVar: p.envVar,
      configured: p.id === "ollama" ? true : credentials[p.id as keyof typeof credentials],
    })),
  };
}

settingsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.status(200).json(await buildSettingsSnapshot());
  }),
);

settingsRouter.put(
  "/default-model",
  asyncHandler(async (req, res) => {
    const { modelId } = req.body ?? {};

    if (modelId === null) {
      await clearSetting(SETTINGS_KEYS.defaultModelId);
      res.status(200).json(await buildSettingsSnapshot());
      return;
    }

    if (typeof modelId !== "string" || modelId === AUTO_MODEL_ID) {
      res.status(400).json({ error: 'modelId must be a concrete model id, or null to clear the override ("auto" is not a valid default - that is a separate, per-request routing mode).' });
      return;
    }

    const credentials = currentProviderCredentials();
    const registry = currentModelRegistry();
    if (!isSelectableModel(modelId, credentials, registry)) {
      const availableIds = registry.filter((m) => m.enabled && isModelConfigured(m, credentials)).map((m) => m.id);
      res.status(400).json({ error: `modelId must be one of the currently available models: ${availableIds.join(", ")}.` });
      return;
    }

    await setSetting(SETTINGS_KEYS.defaultModelId, modelId);
    res.status(200).json(await buildSettingsSnapshot());
  }),
);
