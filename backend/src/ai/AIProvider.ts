// The AIProvider abstraction (spec section 2). The application is never
// hard-coupled to a specific LLM vendor - AnthropicProvider is today's
// implementation, and a future KonturosProvider can implement this same
// interface without touching git access, DU mapping, or pricing.
//
// Architecture rule: the AIProvider analyzes and scores. It never decides
// "this requirement is worth 10 DU" - it returns per-dimension scores, and
// the deterministic DU Engine (scoring/duEngine.ts) turns those into a DU
// class, count, and price. Likewise, the AIProvider classifies information
// and proposes assumptions/clarifications - it never decides on its own
// whether to ask the user; that gating is deterministic application logic
// (scoring/clarificationGate.ts).

import type {
  Assumption,
  Clarification,
  ContextResolutionOutput,
  KnownFact,
  QualityLevel,
  Requirement,
  RepositoryContext,
  RepositoryProfile,
  RepositorySnapshotMode,
  RequirementAssessment,
} from "../domain/types.js";

export interface RepositoryIdentity {
  repositoryUrl: string;
  branch: string;
  commitSha: string;
}

/** What the app already knows about a requirement, passed into later AI calls so they build on it instead of re-deriving it. */
export interface ResolvedRequirementKnowledge {
  knownFacts: KnownFact[];
  assumptions: Assumption[];
}

/**
 * Which domain record(s) a call was for - threaded through to the AI usage
 * log (see ai/usageTracker.ts) purely for traceability ("which requirement
 * cost how much"); never used for AI behavior. snapshotId is always known;
 * the others are populated once they exist.
 */
export interface UsageContext {
  snapshotId: string;
  requirementContextId?: string;
  scoringId?: string;
}

export interface AIProvider {
  /** Semantic understanding of the repository - languages, frameworks, services, evidence-backed findings. */
  analyzeRepository(
    repository: RepositoryIdentity,
    context: RepositoryContext,
    usage: UsageContext,
  ): Promise<RepositoryProfile>;

  /**
   * Normalizes the requirement, extracts known facts (requirement + repository
   * evidence), and for every remaining information gap: attempts
   * self-resolution, proposes a plausible assumption where defensible, and
   * classifies what's left. Previously answered clarifications are passed in
   * as an additional, authoritative source (spec section 4, source #3).
   * Never invents facts not present in the requirement or repository.
   */
  resolveRequirementContext(
    requirement: Requirement,
    profile: RepositoryProfile,
    context: RepositoryContext,
    answeredClarifications: Clarification[],
    qualityLevel: QualityLevel,
    model: string,
    usage: UsageContext,
    mode?: RepositorySnapshotMode,
  ): Promise<ContextResolutionOutput>;

  /**
   * Compares the requirement against the repository profile (what exists,
   * what must change, what's new) and scores all eight dimensions (1-5
   * each, with a bilingual summary, bilingual detailed rationale, evidence,
   * confidence, and the facts/assumptions each score relied on) in one
   * call, plus one bilingual overall assessment synthesizing all eight.
   * Never computes DU directly. Merged into a single call - scoring always
   * needed the impact analysis as input, so splitting it into two
   * sequential AI calls only doubled latency without buying independence.
   */
  assessRequirement(
    requirement: Requirement,
    profile: RepositoryProfile,
    context: RepositoryContext,
    knowledge: ResolvedRequirementKnowledge,
    qualityLevel: QualityLevel,
    model: string,
    usage: UsageContext,
    mode?: RepositorySnapshotMode,
  ): Promise<RequirementAssessment>;
}

// Typed error classification (spec section 13) - lets calling code (and
// future programmatic handling, e.g. Auto-mode fallback decisions) branch
// on *kind* of failure instead of parsing message strings. See
// ai/llmErrors.ts for where each provider's SDK errors get mapped to one of
// these.
export type LLMErrorCode =
  | "authentication_error"
  | "rate_limit"
  | "timeout"
  | "provider_unavailable"
  | "model_unavailable"
  | "invalid_request"
  | "context_too_large"
  | "unknown_provider_error";

export class AIProviderError extends Error {
  readonly code: LLMErrorCode;

  constructor(message: string, code: LLMErrorCode = "unknown_provider_error", cause?: unknown) {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}
