import { Router } from "express";
import { config } from "../config.js";
import { aiUsageStore } from "../store/AIUsageStore.js";
import { asyncHandler } from "./asyncHandler.js";

export const aiUsageRouter = Router();

aiUsageRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const fromRaw = req.query.from;
    const toRaw = req.query.to;

    if (typeof fromRaw !== "string" || typeof toRaw !== "string") {
      res.status(400).json({ error: "from and to query parameters (ISO timestamps) are required." });
      return;
    }

    const from = new Date(fromRaw);
    const to = new Date(toRaw);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      res.status(400).json({ error: "from and to must be valid ISO timestamps." });
      return;
    }
    if (from >= to) {
      res.status(400).json({ error: "from must be before to." });
      return;
    }

    const summary = await aiUsageStore.getUsageSummary({ from, to });
    res.status(200).json(summary);
  }),
);

aiUsageRouter.get("/config", (_req, res) => {
  res.status(200).json({
    provider: config.aiProvider,
    model: config.aiModel ?? "(provider default)",
  });
});
