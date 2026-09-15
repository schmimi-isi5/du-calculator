import type { Response } from "express";
import { Router } from "express";
import { config } from "../config.js";
import { selectableModelsFor } from "../domain/models.js";
import { aiUsageStore } from "../store/AIUsageStore.js";
import { asyncHandler } from "./asyncHandler.js";
import { defaultModelForActiveProvider } from "./requirementContextService.js";

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

aiUsageRouter.get("/models", (_req, res) => {
  const defaultModel = defaultModelForActiveProvider();
  res.status(200).json({
    provider: config.aiProvider,
    models: selectableModelsFor(config.aiProvider, defaultModel),
    default: defaultModel,
  });
});
