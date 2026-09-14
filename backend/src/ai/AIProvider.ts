// The AIProvider abstraction (spec section 2). The application is never
// hard-coupled to a specific LLM vendor - AnthropicProvider is today's
// implementation, and a future KonturosProvider can implement this same
// interface without touching git access, DU mapping, or pricing.
//
// Architecture rule: the AIProvider analyzes and scores. It never decides
// "this requirement is worth 10 DU" - it returns per-dimension scores, and
// the deterministic DU Engine (scoring/duEngine.ts) turns those into a DU
// class, count, and price.

import type {
  DimensionScores,
  ImpactAnalysis,
  Requirement,
  RepositoryContext,
  RepositoryProfile,
} from "../domain/types.js";

export interface RepositoryIdentity {
  repositoryUrl: string;
  branch: string;
  commitSha: string;
}

export interface AIProvider {
  /** Semantic understanding of the repository - languages, frameworks, services, evidence-backed findings. */
  analyzeRepository(
    repository: RepositoryIdentity,
    context: RepositoryContext,
  ): Promise<RepositoryProfile>;

  /** Compares the requirement against the repository profile: what exists, what must change, what's new. */
  analyzeRequirement(
    requirement: Requirement,
    profile: RepositoryProfile,
    context: RepositoryContext,
  ): Promise<ImpactAnalysis>;

  /** Scores all eight dimensions (1-5 each) with rationale, evidence, and confidence. Never computes DU directly. */
  scoreRequirement(
    requirement: Requirement,
    profile: RepositoryProfile,
    impact: ImpactAnalysis,
    context: RepositoryContext,
  ): Promise<DimensionScores>;
}

export class AIProviderError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AIProviderError";
    if (cause !== undefined) this.cause = cause;
  }
}
