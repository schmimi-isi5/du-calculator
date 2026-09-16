// Bridges the pure Model Registry (domain/models.ts) to the runtime
// environment: which provider credentials this deployment actually has
// configured. Kept as the one place that reads `config` for this purpose,
// so domain/models.ts stays config-free and unit-testable.

import { config } from "../config.js";
import type { ProviderCredentials } from "../domain/models.js";

export function currentProviderCredentials(): ProviderCredentials {
  return {
    anthropic: config.anthropicApiKey !== null,
    openai: config.openaiApiKey !== null,
    deepseek: config.deepseekApiKey !== null,
    google: config.googleApiKey !== null,
    qwen: config.qwenApiKey !== null,
  };
}
