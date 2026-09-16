import type { Response } from "express";
import { Router } from "express";
import { currentProviderCredentials } from "../ai/providerAvailability.js";
import { config } from "../config.js";
import { AUTO_MODEL_ID, isModelConfigured, MODEL_REGISTRY } from "../domain/models.js";
import { aiUsageStore } from "../store/AIUsageStore.js";
import { asyncHandler } from "./asyncHandler.js";
import { defaultModelId } from "./requirementContextService.js";

const OLLAMA_STATUS_TIMEOUT_MS = 3000;

export const aiUsageRouter = Router();

const DEFAULT_LOG_LIMIT = 200;
const MAX_LOG_LIMIT = 1000;

/** Parses and validates the shared from/to range query params; sends a 400 and returns null if invalid. */
function parseRange(fromRaw: unknown, toRaw: unknown, res: Response): { from: Date; to: Date } | null {
  if (typeof fromRaw !== "string" || typeof toRaw !== "string") {
    res.status(400).json({ error: "from and to query parameters (ISO timestamps) are required." });
    return null;
  }

  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    res.status(400).json({ error: "from and to must be valid ISO timestamps." });
    return null;
  }
  if (from >= to) {
    res.status(400).json({ error: "from must be before to." });
    return null;
  }
  return { from, to };
}

aiUsageRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const range = parseRange(req.query.from, req.query.to, res);
    if (!range) return;

    const summary = await aiUsageStore.getUsageSummary(range);
    res.status(200).json(summary);
  }),
);

aiUsageRouter.get(
  "/log",
  asyncHandler(async (req, res) => {
    const range = parseRange(req.query.from, req.query.to, res);
    if (!range) return;

    const rawLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LOG_LIMIT) : DEFAULT_LOG_LIMIT;

    const entries = await aiUsageStore.listUsageLog(range, limit);
    res.status(200).json(entries);
  }),
);

aiUsageRouter.get("/config", (_req, res) => {
  res.status(200).json({
    provider: config.aiProvider,
    model: config.aiModel ?? "(provider default)",
  });
});

// The full Model Registry (spec: Model Registry), each entry annotated with
// whether THIS deployment can actually call it right now - `available`
// reflects configuration (an API key present, or "ollama" needing none),
// not live reachability, which the frontend checks separately via
// /ollama-status for the local model specifically (spec section 10: "Ein
// nicht verfügbares lokales Modell soll in der UI entsprechend markiert
// werden").
aiUsageRouter.get("/models", (_req, res) => {
  const credentials = currentProviderCredentials();
  res.status(200).json({
    autoModelId: AUTO_MODEL_ID,
    models: MODEL_REGISTRY.filter((m) => m.enabled).map((m) => ({ ...m, available: isModelConfigured(m, credentials) })),
    default: defaultModelId(),
  });
});

// Live reachability check for the local Ollama server (spec section 10) -
// deliberately not part of /models above, since it's a network call with
// its own latency/failure mode and the registry entry's "available" flag
// must stay a cheap, synchronous, configuration-only check.
aiUsageRouter.get(
  "/ollama-status",
  asyncHandler(async (_req, res) => {
    try {
      const response = await fetch(`${config.ollamaBaseUrl.replace(/\/$/, "")}/api/tags`, {
        signal: AbortSignal.timeout(OLLAMA_STATUS_TIMEOUT_MS),
      });
      if (!response.ok) {
        res.status(200).json({ reachable: false, models: [] });
        return;
      }
      const body = (await response.json()) as { models?: { name?: string }[] };
      const models = Array.isArray(body.models) ? body.models.map((m) => m.name).filter((n): n is string => !!n) : [];
      res.status(200).json({ reachable: true, models });
    } catch {
      res.status(200).json({ reachable: false, models: [] });
    }
  }),
);
