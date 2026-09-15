import type { Response } from "express";
import { Router } from "express";
import { AIProviderError } from "../ai/AIProvider.js";
import { DEFAULT_QUALITY_LEVEL, isQualityLevel } from "../domain/qualityLevels.js";
import type { QualityLevel, Requirement, RequirementContext } from "../domain/types.js";
import { logger } from "../logging.js";
import {
  applyAssumptionAction,
  applyClarificationAnswer,
  AssumptionNotFoundError,
  ClarificationNotFoundError,
  type AssumptionAction,
} from "../scoring/clarificationGate.js";
import { store } from "../store/PostgresScoringStore.js";
import { asyncHandler } from "./asyncHandler.js";
import { errorCause } from "./errorCause.js";
import { parseRequirement } from "./requirementInput.js";
import { RequirementContextError, runContextResolution } from "./requirementContextService.js";

export const requirementContextRouter = Router();

const ASSUMPTION_ACTIONS: readonly AssumptionAction[] = ["CONFIRM", "REJECT", "EDIT"];

// Runs (or re-runs) resolution and responds, sharing one error-handling
// path for the three endpoints below that can trigger it.
async function resolveAndRespond(
  res: Response,
  snapshotId: string,
  requirement: Requirement,
  existing: RequirementContext | null,
  qualityLevel: QualityLevel = DEFAULT_QUALITY_LEVEL,
) {
  try {
    const context = await runContextResolution(snapshotId, requirement, existing, qualityLevel);
    res.status(200).json(context);
  } catch (err) {
    if (err instanceof RequirementContextError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof AIProviderError) {
      logger.error("Requirement context resolution failed", {
        snapshotId,
        error: err.message,
        cause: errorCause(err),
      });
      res.status(200).json({
        id: existing?.id ?? store.createRequirementContextId(),
        snapshotId,
        requirement,
        qualityLevel: existing?.qualityLevel ?? qualityLevel,
        normalization: existing?.normalization ?? null,
        knownFacts: existing?.knownFacts ?? [],
        assumptions: existing?.assumptions ?? [],
        missingInformation: existing?.missingInformation ?? [],
        clarifications: existing?.clarifications ?? [],
        status: "ERROR",
        resolutionRounds: existing?.resolutionRounds ?? 0,
        errorMessage: err.message,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    throw err;
  }
}

requirementContextRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { snapshotId, requirement: requirementInput, qualityLevel: qualityLevelInput } = req.body ?? {};

    if (typeof snapshotId !== "string" || snapshotId.length === 0) {
      res.status(400).json({ error: "snapshotId is required." });
      return;
    }

    let requirement;
    try {
      requirement = parseRequirement(requirementInput);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid requirement." });
      return;
    }

    let qualityLevel: QualityLevel = DEFAULT_QUALITY_LEVEL;
    if (qualityLevelInput !== undefined) {
      if (!isQualityLevel(qualityLevelInput)) {
        res.status(400).json({ error: "qualityLevel must be one of: quick, standard, thorough." });
        return;
      }
      qualityLevel = qualityLevelInput;
    }

    await resolveAndRespond(res, snapshotId, requirement, null, qualityLevel);
  }),
);

requirementContextRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: "id is required." });
      return;
    }
    const context = await store.getRequirementContext(id);
    if (!context) {
      res.status(404).json({ error: "Requirement context not found." });
      return;
    }
    res.status(200).json(context);
  }),
);

interface ClarificationAnswerInput {
  clarificationId: string;
  answer: string;
}

function parseAnswers(body: unknown): ClarificationAnswerInput[] | null {
  const answers = (body as { answers?: unknown } | undefined)?.answers;
  if (!Array.isArray(answers) || answers.length === 0) return null;

  const parsed: ClarificationAnswerInput[] = [];
  for (const entry of answers) {
    const clarificationId = (entry as { clarificationId?: unknown })?.clarificationId;
    const answer = (entry as { answer?: unknown })?.answer;
    if (typeof clarificationId !== "string" || clarificationId.length === 0) return null;
    if (typeof answer !== "string" || answer.trim().length === 0) return null;
    parsed.push({ clarificationId, answer: answer.trim() });
  }
  return parsed;
}

// Answers one or more pending clarifications from the same round together,
// so a round with e.g. 3 open questions triggers exactly one re-resolution
// call instead of up to three sequential ones - and so answering one
// question can never appear to discard drafts still being typed for another
// pending question in the same round (see spec: "Dialog statt
// Fragenkatalog" - a round is answered as a unit).
requirementContextRouter.post(
  "/:id/clarifications/answer",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "id is required." });
      return;
    }

    const answers = parseAnswers(req.body);
    if (!answers) {
      res.status(400).json({ error: "answers must be a non-empty array of { clarificationId, answer }." });
      return;
    }

    const context = await store.getRequirementContext(id);
    if (!context) {
      res.status(404).json({ error: "Requirement context not found." });
      return;
    }

    let updated = context;
    try {
      for (const { clarificationId, answer } of answers) {
        updated = applyClarificationAnswer(updated, clarificationId, answer);
      }
    } catch (err) {
      if (err instanceof ClarificationNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
    // Persist the answers immediately so they are never lost even if the
    // subsequent re-resolution call fails.
    await store.saveRequirementContext(updated);

    await resolveAndRespond(res, context.snapshotId, context.requirement, updated);
  }),
);

requirementContextRouter.post(
  "/:id/assumptions/:assumptionId",
  asyncHandler(async (req, res) => {
    const { id, assumptionId } = req.params;
    const { action, editedText } = req.body ?? {};

    if (!id || !assumptionId) {
      res.status(400).json({ error: "id and assumptionId are required." });
      return;
    }
    if (typeof action !== "string" || !ASSUMPTION_ACTIONS.includes(action as AssumptionAction)) {
      res.status(400).json({ error: `action must be one of: ${ASSUMPTION_ACTIONS.join(", ")}.` });
      return;
    }

    const context = await store.getRequirementContext(id);
    if (!context) {
      res.status(404).json({ error: "Requirement context not found." });
      return;
    }

    let updated;
    try {
      updated = applyAssumptionAction(
        context,
        assumptionId,
        action as AssumptionAction,
        typeof editedText === "string" ? editedText : undefined,
      );
    } catch (err) {
      if (err instanceof AssumptionNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid assumption action." });
      return;
    }

    // Deliberately does NOT re-run AI resolution here (that would spend AI
    // credits on every click): a rejected/edited assumption is immediately
    // excluded from/updated for the next /score call, which reads this
    // context fresh. The user re-scores explicitly when ready.
    await store.saveRequirementContext(updated);
    res.status(200).json(updated);
  }),
);
