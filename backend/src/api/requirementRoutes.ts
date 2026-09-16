import { Router } from "express";
import { AIProviderError } from "../ai/AIProvider.js";
import { getAIProviderForModel } from "../ai/getAIProvider.js";
import { currentModelRegistry } from "../ai/providerAvailability.js";
import { config } from "../config.js";
import { getModelById } from "../domain/models.js";
import type { ImpactAnalysis, ScoringResult } from "../domain/types.js";
import { logger } from "../logging.js";
import { activeAssumptions } from "../scoring/clarificationGate.js";
import { computeDuResult, determineScoringStatus } from "../scoring/duEngine.js";
import { store } from "../store/PostgresScoringStore.js";
import { asyncHandler } from "./asyncHandler.js";
import { errorCause } from "./errorCause.js";

export const requirementRouter = Router();

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;

requirementRouter.post("/score", asyncHandler(async (req, res) => {
  const { contextId } = req.body ?? {};

  if (typeof contextId !== "string" || contextId.length === 0) {
    res.status(400).json({ error: "contextId is required." });
    return;
  }

  const requirementContext = await store.getRequirementContext(contextId);
  if (!requirementContext) {
    res.status(404).json({ error: "Requirement context not found." });
    return;
  }
  if (requirementContext.status !== "RESOLVED") {
    res.status(400).json({
      error:
        requirementContext.status === "AWAITING_CLARIFICATION"
          ? "This requirement still has open clarification questions. Answer them before scoring."
          : "Requirement context is not ready for scoring.",
    });
    return;
  }

  const { snapshotId, requirement } = requirementContext;
  const snapshot = await store.getSnapshot(snapshotId);
  if (!snapshot || snapshot.status !== "SNAPSHOT_CREATED" || !snapshot.profile) {
    res.status(400).json({ error: "Repository has not been successfully analyzed yet." });
    return;
  }

  const context = await store.getRepositoryContext(snapshotId);
  if (!context) {
    res
      .status(409)
      .json({ error: "Repository context is not available for this snapshot. Re-analyze the repository." });
    return;
  }

  const result: ScoringResult = {
    id: store.createScoringId(),
    snapshotId,
    requirementContextId: contextId,
    requirement,
    qualityLevel: requirementContext.qualityLevel,
    model: requirementContext.model,
    status: "ANALYZING",
    impactAnalysis: null,
    dimensionScores: null,
    confidence: null,
    duResult: null,
    overallAssessment: null,
    assumptionsUsed: [],
    openQuestions: [],
    errorMessage: null,
    scoredAt: null,
  };
  await store.saveScoringResult(result);

  try {
    const modelEntry = getModelById(requirementContext.model, currentModelRegistry());
    if (!modelEntry) {
      throw new AIProviderError(`Unknown model "${requirementContext.model}".`, "model_unavailable");
    }
    const aiProvider = getAIProviderForModel(modelEntry);
    const knowledge = {
      knownFacts: requirementContext.knownFacts,
      assumptions: requirementContext.assumptions,
    };
    const availableAssumptionIds = new Set(activeAssumptions(requirementContext.assumptions).map((a) => a.id));
    const usageContext = { snapshotId, requirementContextId: contextId, scoringId: result.id };

    const assessment = await aiProvider.assessRequirement(
      requirement,
      snapshot.profile,
      context,
      knowledge,
      requirementContext.qualityLevel,
      requirementContext.model,
      usageContext,
    );
    const engineResult = computeDuResult(assessment.dimensions, config.pricePerDU, config.hoursPerDU);

    // Only assumptions that are actually still active may count - a score
    // that cites a rejected assumption's id is a modeling bug, not a valid
    // "assumption used".
    const assumptionsUsed = Array.from(
      new Set(
        Object.values(assessment.dimensions)
          .flatMap((d) => d.assumptionsUsed)
          .filter((id) => availableAssumptionIds.has(id)),
      ),
    );

    result.impactAnalysis = assessment.impactAnalysis;
    result.dimensionScores = assessment.dimensions;
    result.overallAssessment = assessment.overallAssessment;
    result.assumptionsUsed = assumptionsUsed;
    result.confidence = {
      overallConfidence: engineResult.overallConfidence,
      confidenceLevel: engineResult.confidenceLevel,
    };
    result.scoredAt = new Date().toISOString();
    result.status = determineScoringStatus(engineResult, assumptionsUsed.length);

    if (result.status === "NEEDS_CLARIFICATION") {
      result.duResult = null;
      result.openQuestions = collectOpenQuestions(assessment.impactAnalysis, assessment.dimensions);
    } else {
      result.duResult = engineResult;
    }
  } catch (err) {
    result.status = "ERROR";
    result.errorMessage = describeError(err);
    logger.error("Requirement scoring failed", {
      scoringId: result.id,
      contextId,
      error: result.errorMessage,
      cause: errorCause(err),
    });
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

function collectOpenQuestions(impact: ImpactAnalysis, scores: ScoringResult["dimensionScores"]): string[] {
  const fromImpact = impact.openQuestions;
  const fromDimensions = scores ? Object.values(scores).flatMap((s) => s.missingInformation) : [];
  return Array.from(new Set([...fromImpact, ...fromDimensions]));
}

function describeError(err: unknown): string {
  if (err instanceof AIProviderError) return err.message;
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred while scoring the requirement.";
}
