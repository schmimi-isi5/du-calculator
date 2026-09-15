// Shared by every AIProvider implementation: turns one call's raw token
// counts into a priced, persisted AIUsageRecord. Kept out of each provider
// so pricing/logging logic lives in exactly one place.

import type { AIProviderName } from "../domain/types.js";
import type { UsageContext } from "./AIProvider.js";
import { aiUsageStore } from "../store/AIUsageStore.js";
import { config } from "../config.js";
import { estimateCostUsd, type UsageTokens } from "./pricing.js";
import { logger } from "../logging.js";

export async function recordUsage(
  provider: AIProviderName,
  model: string,
  operation: string,
  tokens: UsageTokens,
  usage: UsageContext,
): Promise<void> {
  const customPricing =
    config.aiCustomInputPricePerMTok !== null && config.aiCustomOutputPricePerMTok !== null
      ? { inputPerMTok: config.aiCustomInputPricePerMTok, outputPerMTok: config.aiCustomOutputPricePerMTok }
      : null;

  const costUsd = estimateCostUsd(provider, model, tokens, customPricing);

  try {
    await aiUsageStore.recordUsage({
      provider,
      model,
      operation,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      cacheCreationInputTokens: tokens.cacheWrite5mTokens + tokens.cacheWrite1hTokens,
      cacheReadInputTokens: tokens.cacheReadTokens,
      costUsd,
      snapshotId: usage.snapshotId,
      requirementContextId: usage.requirementContextId ?? null,
      scoringId: usage.scoringId ?? null,
    });
  } catch (err) {
    // Usage logging must never break the actual AI call it's observing -
    // the request already succeeded by the time this runs.
    logger.error("Failed to record AI usage", { provider, model, operation, error: String(err) });
  }
}
