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
  ImpactAnalysis,
  KnownFact,
  Requirement,
  RepositoryContext,
  RepositoryProfile,
  ScoringOutput,
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

export interface AIProvider {
  /** Semantic understanding of the repository - languages, frameworks, services, evidence-backed findings. */
  analyzeRepository(
    repository: RepositoryIdentity,
    context: RepositoryContext,
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
  ): Promise<ContextResolutionOutput>;

  /** Compares the requirement against the repository profile: what exists, what must change, what's new. */
  analyzeRequirement(
    requirement: Requirement,
    profile: RepositoryProfile,
    context: RepositoryContext,
    knowledge: ResolvedRequirementKnowledge,
  ): Promise<ImpactAnalysis>;

  /**
   * Scores all eight dimensions (1-5 each) with a bilingual summary,
   * bilingual detailed rationale, evidence, confidence, and the facts/
   * assumptions each score relied on, plus one bilingual overall assessment
   * synthesizing all eight. Never computes DU directly.
   */
  scoreRequirement(
    requirement: Requirement,
    profile: RepositoryProfile,
    impact: ImpactAnalysis,
    context: RepositoryContext,
    knowledge: ResolvedRequirementKnowledge,
  ): Promise<ScoringOutput>;
}

export class AIProviderError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AIProviderError";
    if (cause !== undefined) this.cause = cause;
  }
}
