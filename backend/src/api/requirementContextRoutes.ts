import type { Response } from "express";
import { Router } from "express";
import { AIProviderError } from "../ai/AIProvider.js";
import { currentModelRegistry, currentProviderCredentials } from "../ai/providerAvailability.js";
import {
  AUTO_MODEL_ID,
  getModelById,
  isSelectableModel,
  listAvailableModels,
  NoAvailableModelError,
} from "../domain/models.js";
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
import {
  applyChallengeProposalAction,
  ChallengeProposalNotFoundError,
  checkChallengeApprovalGate,
  evaluateApprovalStatus,
  type ChallengeProposalAction,
} from "../scoring/requirementChallengeEngine.js";
import { store } from "../store/PostgresScoringStore.js";
import { asyncHandler } from "./asyncHandler.js";
import { errorCause } from "./errorCause.js";
import { parseRequirement } from "./requirementInput.js";
import {
  RequirementContextError,
  runContextResolution,
  runRequirementChallenge,
  type ModelSelection,
} from "./requirementContextService.js";

export const requirementContextRouter = Router();

const ASSUMPTION_ACTIONS: readonly AssumptionAction[] = ["CONFIRM", "REJECT", "EDIT"];
const CHALLENGE_PROPOSAL_ACTIONS: readonly ChallengeProposalAction[] = ["ACCEPT", "REJECT", "EDIT"];
const DEFAULT_MODEL_SELECTION: ModelSelection = { kind: "default" };

// Runs (or re-runs) resolution and responds, sharing one error-handling
// path for the three endpoints below that can trigger it.
async function resolveAndRespond(
  res: Response,
  snapshotId: string,
  requirement: Requirement,
  existing: RequirementContext | null,
  qualityLevel: QualityLevel = DEFAULT_QUALITY_LEVEL,
  modelSelection: ModelSelection = DEFAULT_MODEL_SELECTION,
  privacyMode?: "local-only",
) {
  try {
    const context = await runContextResolution(snapshotId, requirement, existing, qualityLevel, modelSelection, privacyMode);
    res.status(200).json(context);
  } catch (err) {
    if (err instanceof RequirementContextError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof NoAvailableModelError) {
      res.status(503).json({ error: err.message });
      return;
    }
    if (err instanceof AIProviderError) {
      logger.error("Requirement context resolution failed", {
        snapshotId,
        error: err.message,
        code: err.code,
        cause: errorCause(err),
      });
      res.status(200).json({
        id: existing?.id ?? store.createRequirementContextId(),
        snapshotId,
        requirement,
        qualityLevel: existing?.qualityLevel ?? qualityLevel,
        model: existing?.model ?? (modelSelection.kind === "explicit" ? modelSelection.modelId : "unknown"),
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
    const {
      snapshotId,
      requirement: requirementInput,
      qualityLevel: qualityLevelInput,
      model: modelInput,
      privacyMode: privacyModeInput,
    } = req.body ?? {};

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

    let privacyMode: "local-only" | undefined;
    if (privacyModeInput !== undefined) {
      if (privacyModeInput !== "local-only") {
        res.status(400).json({ error: 'privacyMode must be "local-only" if provided.' });
        return;
      }
      privacyMode = "local-only";
    }

    // "auto" (spec section 8) and "no model given at all" (section 7,
    // default) are resolved to a concrete registry id inside
    // runContextResolution, which is the one place that has the repository
    // context Auto-routing needs - see requirementContextService.ts
    // resolveModelSelection. An explicit choice is validated here so an
    // unusable model is rejected before any AI call is made.
    let modelSelection: ModelSelection = DEFAULT_MODEL_SELECTION;
    if (modelInput === AUTO_MODEL_ID) {
      modelSelection = { kind: "auto" };
    } else if (modelInput !== undefined) {
      const credentials = currentProviderCredentials();
      const registry = currentModelRegistry();
      if (!isSelectableModel(modelInput, credentials, registry)) {
        res.status(400).json({
          error: `model must be "${AUTO_MODEL_ID}" or one of: ${listAvailableModels(credentials, registry)
            .map((m) => m.id)
            .join(", ")}.`,
        });
        return;
      }
      const entry = getModelById(modelInput, registry);
      if (privacyMode === "local-only" && !entry?.local) {
        res.status(400).json({ error: "privacyMode=local-only forbids choosing a cloud model explicitly." });
        return;
      }
      modelSelection = { kind: "explicit", modelId: modelInput };
    }

    await resolveAndRespond(res, snapshotId, requirement, null, qualityLevel, modelSelection, privacyMode);
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

function toOptionalStringArray(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const items = value.map((entry) => (typeof entry === "string" ? entry.trim() : null));
  if (items.some((entry) => entry === null)) return null;
  return (items as string[]).filter((entry) => entry.length > 0);
}

// Lets the user review/correct the title and AI-derived acceptance
// criteria/constraints (see requirementContextService.ts
// applyNormalizationToRequirement, which auto-fills them from the AI's
// normalization on the first resolution round) before scoring - a plain data
// update, deliberately NOT an AI call, so reviewing/editing costs nothing
// and never re-triggers resolution (same reasoning as the assumption-action
// endpoint below: the user re-scores explicitly when ready).
requirementContextRouter.patch(
  "/:id/requirement",
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

    const { title, acceptanceCriteria, constraints } = req.body ?? {};
    if (title !== undefined && (typeof title !== "string" || title.trim().length === 0)) {
      res.status(400).json({ error: "title must be a non-empty string if provided." });
      return;
    }
    const parsedAcceptanceCriteria = toOptionalStringArray(acceptanceCriteria);
    if (parsedAcceptanceCriteria === null) {
      res.status(400).json({ error: "acceptanceCriteria must be an array of strings if provided." });
      return;
    }
    const parsedConstraints = toOptionalStringArray(constraints);
    if (parsedConstraints === null) {
      res.status(400).json({ error: "constraints must be an array of strings if provided." });
      return;
    }

    const nextRequirement = {
      ...context.requirement,
      title: title !== undefined ? (title as string).trim() : context.requirement.title,
      acceptanceCriteria: parsedAcceptanceCriteria ?? context.requirement.acceptanceCriteria,
      constraints: parsedConstraints ?? context.requirement.constraints,
    };
    const withRequirement: RequirementContext = {
      ...context,
      requirement: nextRequirement,
      updatedAt: new Date().toISOString(),
    };
    // A manual edit changes the draft, so an already-APPROVED context must
    // not silently stay APPROVED (spec section 40: editing after approval
    // invalidates it) - approvedRequirement itself is left untouched here;
    // a fresh explicit /approve call is required to refreeze it.
    const updated: RequirementContext = {
      ...withRequirement,
      approvalStatus: evaluateApprovalStatus(withRequirement),
    };

    await store.saveRequirementContext(updated);
    res.status(200).json(updated);
  }),
);

// Runs the Requirement Challenge AI call (spec: requirement-challenge-v1) -
// separates the underlying goal from any proposed technical solution and
// proposes optimization/clarification proposals. Requires the context to be
// fully RESOLVED first (no open clarifications from normalization).
requirementContextRouter.post(
  "/:id/challenge",
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

    try {
      const updated = await runRequirementChallenge(context);
      res.status(200).json(updated);
    } catch (err) {
      if (err instanceof RequirementContextError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof AIProviderError) {
        logger.error("Requirement challenge failed", {
          requirementContextId: id,
          error: err.message,
          code: err.code,
          cause: errorCause(err),
        });
        res.status(502).json({ error: err.message });
        return;
      }
      throw err;
    }
  }),
);

// Records the user's ACCEPT/REJECT/EDIT decision on one Challenge proposal.
// Never re-runs the AI (mirrors the assumption-action endpoint above) - the
// working requirement and approval status are recomputed deterministically.
requirementContextRouter.post(
  "/:id/challenge/proposals/:proposalId",
  asyncHandler(async (req, res) => {
    const { id, proposalId } = req.params;
    const { action, editedText } = req.body ?? {};

    if (!id || !proposalId) {
      res.status(400).json({ error: "id and proposalId are required." });
      return;
    }
    if (typeof action !== "string" || !CHALLENGE_PROPOSAL_ACTIONS.includes(action as ChallengeProposalAction)) {
      res.status(400).json({ error: `action must be one of: ${CHALLENGE_PROPOSAL_ACTIONS.join(", ")}.` });
      return;
    }

    const context = await store.getRequirementContext(id);
    if (!context) {
      res.status(404).json({ error: "Requirement context not found." });
      return;
    }

    let updated: RequirementContext;
    try {
      updated = applyChallengeProposalAction(
        context,
        proposalId,
        action as ChallengeProposalAction,
        typeof editedText === "string" ? editedText : undefined,
      );
    } catch (err) {
      if (err instanceof ChallengeProposalNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid challenge proposal action." });
      return;
    }

    await store.saveRequirementContext(updated);
    res.status(200).json(updated);
  }),
);

// Explicit approval gate (spec section 38-40): freezes the current working
// requirement as approvedRequirement, the only version /score is allowed to
// read. Rejected with 400 + reasons if the gate does not pass - the AI is
// never allowed to auto-approve on the user's behalf.
requirementContextRouter.post(
  "/:id/approve",
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

    const gate = checkChallengeApprovalGate(context);
    if (!gate.canApprove) {
      res.status(400).json({ error: "Freigabe nicht möglich.", reasons: gate.reasons });
      return;
    }

    const updated: RequirementContext = {
      ...context,
      approvalStatus: "APPROVED",
      approvedRequirement: { ...context.requirement },
      updatedAt: new Date().toISOString(),
    };
    await store.saveRequirementContext(updated);
    res.status(200).json(updated);
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
