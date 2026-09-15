import type { Response } from "express";
import { Router } from "express";
import { AIProviderError } from "../ai/AIProvider.js";
import type { Requirement, RequirementContext } from "../domain/types.js";
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
) {
  try {
    const context = await runContextResolution(snapshotId, requirement, existing);
    res.status(200).json(context);
  } catch (err) {
    if (err instanceof RequirementContextError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof AIProviderError) {
      logger.error("Requirement context resolution failed", { snapshotId, error: err.message });
      res.status(200).json({
        id: existing?.id ?? store.createRequirementContextId(),
        snapshotId,
        requirement,
        normalization: existing?.normalization ?? null,
        knownFacts: existing?.knownFacts ?? [],
        assumptions: existing?.assumptions ?? [],
        missingInformation: existing?.missingInformation ?? [],
        clarifications: existing?.clarifications ?? [],
        status: "ERROR",
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
    const { snapshotId, requirement: requirementInput } = req.body ?? {};

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

    await resolveAndRespond(res, snapshotId, requirement, null);
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

requirementContextRouter.post(
  "/:id/clarifications/:clarificationId/answer",
  asyncHandler(async (req, res) => {
    const { id, clarificationId } = req.params;
    const { answer } = req.body ?? {};

    if (!id || !clarificationId) {
      res.status(400).json({ error: "id and clarificationId are required." });
      return;
    }
    if (typeof answer !== "string" || answer.trim().length === 0) {
      res.status(400).json({ error: "answer is required." });
      return;
    }

    const context = await store.getRequirementContext(id);
    if (!context) {
      res.status(404).json({ error: "Requirement context not found." });
      return;
    }

    let updated;
    try {
      updated = applyClarificationAnswer(context, clarificationId, answer.trim());
    } catch (err) {
      if (err instanceof ClarificationNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
    // Persist the answer immediately so it is never lost even if the
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
