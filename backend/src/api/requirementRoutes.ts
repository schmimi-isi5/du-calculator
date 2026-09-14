import { Router } from "express";
import { AIProviderError } from "../ai/AIProvider.js";
import { getAIProvider } from "../ai/getAIProvider.js";
import { config } from "../config.js";
import type { DimensionScores, ImpactAnalysis, Requirement, ScoringResult } from "../domain/types.js";
import { logger } from "../logging.js";
import { computeDuResult } from "../scoring/duEngine.js";
import { repositoryContextCache } from "../store/RepositoryContextCache.js";
import { store } from "../store/PostgresScoringStore.js";
import { asyncHandler } from "./asyncHandler.js";

export const requirementRouter = Router();

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;

requirementRouter.post("/score", asyncHandler(async (req, res) => {
  const { snapshotId, requirement: requirementInput } = req.body ?? {};

  if (typeof snapshotId !== "string" || snapshotId.length === 0) {
    res.status(400).json({ error: "snapshotId is required." });
    return;
  }

  const snapshot = await store.getSnapshot(snapshotId);
  if (!snapshot) {
    res.status(404).json({ error: "Repository snapshot not found." });
    return;
  }
  if (snapshot.status !== "SNAPSHOT_CREATED" || !snapshot.profile) {
    res.status(400).json({ error: "Repository has not been successfully analyzed yet." });
    return;
  }

  const context = repositoryContextCache.get(snapshotId);
  if (!context) {
    res
      .status(409)
      .json({ error: "Repository context is no longer available in this session. Re-analyze the repository." });
    return;
  }

  let requirement: Requirement;
  try {
    requirement = parseRequirement(requirementInput);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid requirement." });
    return;
  }

  const result: ScoringResult = {
    id: store.createScoringId(),
    snapshotId,
    requirement,
    status: "ANALYZING",
    impactAnalysis: null,
    dimensionScores: null,
    confidence: null,
    duResult: null,
    overallAssessment: null,
    openQuestions: [],
    errorMessage: null,
    scoredAt: null,
  };
  await store.saveScoringResult(result);

  try {
    const aiProvider = getAIProvider();
    const impactAnalysis = await aiProvider.analyzeRequirement(requirement, snapshot.profile, context);
    const scoringOutput = await aiProvider.scoreRequirement(requirement, snapshot.profile, impactAnalysis, context);
    const engineResult = computeDuResult(scoringOutput.dimensions, config.pricePerDU);

    result.impactAnalysis = impactAnalysis;
    result.dimensionScores = scoringOutput.dimensions;
    result.overallAssessment = scoringOutput.overallAssessment;
    result.confidence = {
      overallConfidence: engineResult.overallConfidence,
      confidenceLevel: engineResult.confidenceLevel,
    };
    result.scoredAt = new Date().toISOString();

    if (engineResult.confidenceLevel === "LOW") {
      result.status = "NEEDS_CLARIFICATION";
      result.duResult = null;
      result.openQuestions = collectOpenQuestions(impactAnalysis, scoringOutput.dimensions);
    } else if (engineResult.duClass === "XXL") {
      result.status = "DECOMPOSITION_REQUIRED";
      result.duResult = engineResult;
    } else {
      result.status = "SCORED";
      result.duResult = engineResult;
    }
  } catch (err) {
    result.status = "ERROR";
    result.errorMessage = describeError(err);
    logger.error("Requirement scoring failed", { scoringId: result.id, snapshotId, error: result.errorMessage });
  }

  await store.saveScoringResult(result);
  res.status(200).json(result);
}));

// Registered before "/:id" - otherwise Express would match "history" as an :id.
requirementRouter.get("/history", asyncHandler(async (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_HISTORY_LIMIT) : DEFAULT_HISTORY_LIMIT;

  const entries = await store.listScoringResults(limit);
  res.status(200).json(entries);
}));

requirementRouter.get("/:id", asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "id is required." });
    return;
  }
  const result = await store.getScoringResult(id);
  if (!result) {
    res.status(404).json({ error: "Scoring result not found." });
    return;
  }
  res.status(200).json(result);
}));

function parseRequirement(input: unknown): Requirement {
  if (typeof input !== "object" || input === null) {
    throw new Error("requirement is required.");
  }
  const value = input as Record<string, unknown>;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const description = typeof value.description === "string" ? value.description.trim() : "";

  if (!title) throw new Error("requirement.title is required.");
  if (!description) throw new Error("requirement.description is required.");

  return {
    title,
    description,
    acceptanceCriteria: toStringArray(value.acceptanceCriteria),
    constraints: toStringArray(value.constraints),
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

function collectOpenQuestions(impact: ImpactAnalysis, scores: DimensionScores): string[] {
  const fromImpact = impact.openQuestions;
  const fromDimensions = Object.values(scores).flatMap((s) => s.missingInformation);
  return Array.from(new Set([...fromImpact, ...fromDimensions]));
}

function describeError(err: unknown): string {
  if (err instanceof AIProviderError) return err.message;
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred while scoring the requirement.";
}
