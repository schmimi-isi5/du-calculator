// Deterministic orchestration for the Assumption & Clarification Engine.
//
// The AI classifies information and proposes assumptions/clarifications
// (see ai/prompts.ts buildContextResolutionPrompt); this module is the only
// place that decides what happens with that classification - which items
// become an actual question, how many, in what order, and how user answers
// or assumption decisions update the persisted RequirementContext. None of
// this calls an LLM: it is pure, deterministic, and fully unit-testable,
// mirroring how scoring/duEngine.ts owns the DU math.

import { randomUUID } from "node:crypto";
import type {
  Assumption,
  Clarification,
  ContextResolutionOutput,
  KnownFact,
  MissingInformation,
  RequirementContext,
} from "../domain/types.js";

/** Standard dialog size (spec section 11): ask a handful of prioritized questions, never a questionnaire. */
export const MAX_CLARIFICATIONS_PER_ROUND = 3;

export interface ResolvedContextParts {
  knownFacts: KnownFact[];
  assumptions: Assumption[];
  missingInformation: MissingInformation[];
  clarifications: Clarification[];
}

/**
 * Assigns app-owned ids to the AI's raw output and builds the prioritized,
 * capped clarification dialog from whatever it classified
 * CLARIFICATION_REQUIRED. This is the only place a "question to the user"
 * gets created - the AI proposes classifications, this function decides how
 * many actually become a Clarification.
 */
export function buildResolvedContextParts(
  output: ContextResolutionOutput,
  existingClarifications: Clarification[] = [],
): ResolvedContextParts {
  const knownFacts: KnownFact[] = output.knownFacts.map((fact) => ({ ...fact, id: randomUUID() }));
  const assumptions: Assumption[] = output.assumptions.map((assumption) => ({
    ...assumption,
    id: randomUUID(),
    status: "ACTIVE",
  }));
  const missingInformation: MissingInformation[] = output.missingInformation.map((info) => ({
    ...info,
    id: randomUUID(),
  }));

  const answeredQuestions = new Set(
    existingClarifications.filter((c) => c.status === "ANSWERED").map((c) => c.question),
  );

  const candidates = missingInformation.filter(
    (info) => info.classification === "CLARIFICATION_REQUIRED" && !answeredQuestions.has(info.question),
  );

  // Priority: highest potential DU impact first: a tie is broken by keeping
  // the AI's own emission order stable (Array.sort is stable in Node/V8).
  const prioritized = [...candidates].sort((a, b) => b.potentialScoreImpact - a.potentialScoreImpact);

  const newClarifications: Clarification[] = prioritized.slice(0, MAX_CLARIFICATIONS_PER_ROUND).map((info, index) => ({
    id: randomUUID(),
    missingInformationId: info.id,
    question: info.question,
    priority: index + 1,
    status: "PENDING",
    answer: null,
    answeredAt: null,
  }));

  // Previously answered clarifications remain part of the record (audit
  // trail); only PENDING ones are ever replaced by a fresh round.
  const carriedOver = existingClarifications.filter((c) => c.status !== "PENDING");

  return {
    knownFacts,
    assumptions,
    missingInformation,
    clarifications: [...carriedOver, ...newClarifications],
  };
}

export function hasPendingClarifications(context: Pick<RequirementContext, "clarifications">): boolean {
  return context.clarifications.some((c) => c.status === "PENDING");
}

export function pendingClarifications(context: Pick<RequirementContext, "clarifications">): Clarification[] {
  return context.clarifications
    .filter((c) => c.status === "PENDING")
    .sort((a, b) => a.priority - b.priority);
}

/** Assumptions that may actually be used for scoring - excludes anything the user rejected or that a newer round superseded. */
export function activeAssumptions(assumptions: Assumption[]): Assumption[] {
  return assumptions.filter((a) => a.status === "ACTIVE" || a.status === "CONFIRMED");
}

export class ClarificationNotFoundError extends Error {}
export class AssumptionNotFoundError extends Error {}

/** Pure update: records a user's answer to one pending clarification. Does not itself re-run AI resolution - the caller does that with the returned context. */
export function applyClarificationAnswer(
  context: RequirementContext,
  clarificationId: string,
  answer: string,
): RequirementContext {
  const target = context.clarifications.find((c) => c.id === clarificationId);
  if (!target) {
    throw new ClarificationNotFoundError(`Clarification ${clarificationId} not found on this context.`);
  }

  const now = new Date().toISOString();
  return {
    ...context,
    clarifications: context.clarifications.map((c) =>
      c.id === clarificationId ? { ...c, status: "ANSWERED", answer, answeredAt: now } : c,
    ),
    updatedAt: now,
  };
}

export type AssumptionAction = "CONFIRM" | "REJECT" | "EDIT";

/** Pure update: applies a user decision to one assumption (spec section 16). */
export function applyAssumptionAction(
  context: RequirementContext,
  assumptionId: string,
  action: AssumptionAction,
  editedText?: string,
): RequirementContext {
  const target = context.assumptions.find((a) => a.id === assumptionId);
  if (!target) {
    throw new AssumptionNotFoundError(`Assumption ${assumptionId} not found on this context.`);
  }
  if (action === "EDIT" && (!editedText || editedText.trim().length === 0)) {
    throw new Error("editedText is required for the EDIT action.");
  }

  return {
    ...context,
    assumptions: context.assumptions.map((a) => {
      if (a.id !== assumptionId) return a;
      if (action === "CONFIRM") return { ...a, status: "CONFIRMED" };
      if (action === "REJECT") return { ...a, status: "REJECTED" };
      return { ...a, status: "CONFIRMED", assumption: editedText!.trim() };
    }),
    updatedAt: new Date().toISOString(),
  };
}
