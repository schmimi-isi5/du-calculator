// Core domain model for the ISIFIVE DU Calculator.
//
// Naming mirrors the German business vocabulary from the product spec
// (Development Unit / DU) while keeping identifiers in English, matching
// the rest of the codebase.

export type RepositoryStatus =
  | "NOT_ANALYZED"
  | "CLONING"
  | "ANALYZING"
  | "SNAPSHOT_CREATED"
  | "ERROR";

export type ScoringStatus =
  | "NOT_STARTED"
  | "ANALYZING"
  | "NEEDS_CLARIFICATION"
  | "SCORED"
  | "ASSESSMENT_WITH_ASSUMPTIONS"
  | "DECOMPOSITION_REQUIRED"
  | "ERROR";

export type EvidenceStatus = "VERIFIED" | "INFERRED" | "UNKNOWN";

/** Narrative AI text that must be produced in both languages side by side. */
export interface LocalizedText {
  en: string;
  de: string;
}

export interface Evidence {
  file: string;
  reason: string;
}

export interface RepositoryFinding {
  finding: string;
  status: EvidenceStatus;
  evidence: Evidence[];
}

/**
 * The AI's semantic understanding of the repository. Produced by
 * AIProvider.analyzeRepository from the filtered RepositoryContext -
 * never hand-written or hard-coded.
 */
export interface RepositoryProfile {
  summary: string;
  languages: string[];
  frameworks: string[];
  services: string[];
  dataModels: string[];
  integrations: string[];
  aiComponents: string[];
  tests: string[];
  deployment: string[];
  findings: RepositoryFinding[];
}

/**
 * Result of cloning and reading a real repository. Only ever set to
 * SNAPSHOT_CREATED once the clone, file listing, and repository profile
 * have all actually succeeded.
 */
export interface RepositorySnapshot {
  id: string;
  repositoryUrl: string;
  branch: string;
  status: RepositoryStatus;
  commitSha: string | null;
  analyzedAt: string | null;
  fileTree: string[];
  profile: RepositoryProfile | null;
  errorMessage: string | null;
}

/**
 * A row in the "already analyzed, pick me to reuse" list. Deliberately
 * excludes the (large) file excerpts and full profile - the picker only
 * needs enough to let someone recognize and choose a repository.
 */
export interface RepositorySnapshotSummary {
  id: string;
  repositoryUrl: string;
  branch: string;
  status: RepositoryStatus;
  commitSha: string | null;
  analyzedAt: string | null;
  profileSummary: string | null;
}

/**
 * The filtered, budget-bounded view of a repository that is actually sent
 * to the AIProvider. Never the raw, unfiltered repository.
 */
export interface RepositoryContext {
  /** Every tracked file that survived the exclusion filter (spec section 4). */
  fileTree: string[];
  /** Content of the subset of fileTree we could afford to read, keyed by path. */
  fileExcerpts: Record<string, string>;
  /** Priority files that were filtered/ranked but dropped due to the character budget. */
  omittedFileCount: number;
}

export interface Requirement {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  constraints: string[];
}

export interface ImpactAnalysis {
  existing: string[];
  reusable: string[];
  modify: string[];
  create: string[];
  dataChanges: string[];
  integrations: string[];
  tests: string[];
  risks: string[];
  openQuestions: string[];
}

/** The eight scoring dimensions, in the fixed order defined by the spec. */
export const DIMENSION_KEYS = [
  "functionalScope",
  "technicalComplexity",
  "dataIntegration",
  "aiComplexity",
  "automation",
  "testingQA",
  "deploymentOperations",
  "uncertaintyRisk",
] as const;

export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export interface DimensionScore {
  score: 1 | 2 | 3 | 4 | 5;
  /** One-sentence, compact read of this dimension - the "summary per scoring parameter". */
  summary: LocalizedText;
  /** The detailed reasoning behind the score - the "Einzelauswertung". */
  rationale: LocalizedText;
  evidence: Evidence[];
  confidence: number; // 0.0 - 1.0
  missingInformation: string[];
  /** KnownFact ids this score relied on. */
  factsUsed: string[];
  /** Assumption ids this score relied on - more of these should lower confidence, never raise the score. */
  assumptionsUsed: string[];
  /** Risks that remain even after facts/assumptions were applied. */
  unresolvedRisks: string[];
}

export type DimensionScores = Record<DimensionKey, DimensionScore>;

/** Raw output of AIProvider.scoreRequirement, before the deterministic DU Engine runs. */
export interface ScoringOutput {
  dimensions: DimensionScores;
  overallAssessment: LocalizedText;
}

/** Impact analysis and scoring produced together in one AI call - see AIProvider.assessRequirement. */
export interface RequirementAssessment {
  impactAnalysis: ImpactAnalysis;
  dimensions: DimensionScores;
  overallAssessment: LocalizedText;
}

export type DuClass = "XS" | "S" | "M" | "L" | "XL" | "XXL";

export interface DuResult {
  weightedScore: number;
  duClass: DuClass;
  developmentUnits: number | null; // null when duClass is XXL
  price: number | null; // null when developmentUnits is null or no price configured
  overallConfidence: number;
  confidenceLevel: "HIGH" | "MEDIUM" | "LOW";
}

export interface ConfidenceAssessment {
  overallConfidence: number;
  confidenceLevel: "HIGH" | "MEDIUM" | "LOW";
}

export interface ScoringResult {
  id: string;
  snapshotId: string;
  /** The resolved RequirementContext this assessment was scored from - the audit trail back to facts/assumptions used. */
  requirementContextId: string | null;
  requirement: Requirement;
  status: ScoringStatus;
  impactAnalysis: ImpactAnalysis | null;
  dimensionScores: DimensionScores | null;
  /** Always populated once scoring finishes, even when duResult is withheld for low confidence. */
  confidence: ConfidenceAssessment | null;
  /** The final DU estimate. Null while not yet scored, on error, and withheld when confidence is LOW. */
  duResult: DuResult | null;
  /** Cross-dimension narrative: how the 8 scores together characterize scope/complexity/risk. */
  overallAssessment: LocalizedText | null;
  /** Union of assumption ids referenced by any dimension score - "this assessment relied on N assumptions". */
  assumptionsUsed: string[];
  openQuestions: string[];
  errorMessage: string | null;
  scoredAt: string | null;
}

/** One row of the requirement -> DU decision history list (spec: traceable history). */
export interface ScoringHistoryEntry {
  id: string;
  snapshotId: string;
  repositoryUrl: string;
  branch: string;
  requirementTitle: string;
  status: ScoringStatus;
  duClass: DuClass | null;
  developmentUnits: number | null;
  price: number | null;
  overallConfidence: number | null;
  confidenceLevel: "HIGH" | "MEDIUM" | "LOW" | null;
  scoredAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Assumption & Clarification Engine
//
// Core principle: a missing piece of information is not automatically a
// question for the user. It is only a question when its uncertainty would
// materially change scope, architecture, risk, acceptance, or the DU result
// - and only after the requirement, its acceptance criteria, prior
// clarification answers, and the repository have all failed to resolve it.
// Everything else becomes a documented, confidence-scored Assumption
// instead. See ai/prompts.ts (buildContextResolutionPrompt) for where these
// rules are actually enforced - this module only defines the shapes.
// ---------------------------------------------------------------------------

/** Where a piece of information sits on the certainty spectrum (spec section 3). */
export type InformationClass =
  | "FACT"
  | "DERIVED"
  | "ASSUMPTION"
  | "CLARIFICATION_REQUIRED"
  | "UNKNOWN_NON_BLOCKING";

export type KnownFactSource =
  | "REQUIREMENT"
  | "ACCEPTANCE_CRITERIA"
  | "CLARIFICATION_ANSWER"
  | "REPOSITORY"
  | "DERIVED";

/** Something explicitly stated or verified - never invented. */
export interface KnownFact {
  id: string;
  topic: string;
  fact: string;
  source: KnownFactSource;
  evidence: Evidence[];
}

export type AssumptionCriticality = "LOW" | "MEDIUM" | "HIGH";
export type AssumptionStatus = "ACTIVE" | "CONFIRMED" | "REJECTED" | "SUPERSEDED";

/** A plausible, explicitly-flagged stand-in for something not otherwise resolvable. Never presented as a FACT. */
export interface Assumption {
  id: string;
  topic: string;
  assumption: string;
  reason: string;
  /** Free-text citations - "Requirement", "Acceptance Criteria", or a repository file path. */
  basis: string[];
  confidence: number;
  affectedDimensions: DimensionKey[];
  /** 0 = negligible, 1 = could move one dimension by ~1 point, 2 = could move several dimensions or the DU class. */
  potentialScoreImpact: 0 | 1 | 2;
  criticality: AssumptionCriticality;
  status: AssumptionStatus;
}

/** A detected information gap, already classified - the clarification gate's raw material. */
export interface MissingInformation {
  id: string;
  topic: string;
  question: string;
  classification: InformationClass;
  potentialScoreImpact: 0 | 1 | 2;
  affectedDimensions: DimensionKey[];
  reasoning: string;
}

export type ClarificationStatus = "PENDING" | "ANSWERED" | "SKIPPED";

/** A prioritized, decision-oriented question actually put to the user - the last resort, not the default. */
export interface Clarification {
  id: string;
  missingInformationId: string;
  question: string;
  priority: number;
  status: ClarificationStatus;
  answer: string | null;
  answeredAt: string | null;
}

export interface ClarificationAnswer {
  clarificationId: string;
  answer: string;
}

/** Structured extraction of the raw requirement text - no facts invented, only organized. */
export interface RequirementNormalization {
  objective: string;
  businessGoal: string;
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  acceptanceCriteria: string[];
  technicalConstraints: string[];
  mentionedSystems: string[];
  mentionedDataSources: string[];
  mentionedIntegrations: string[];
  mentionedExistingComponents: string[];
  assumptionsAlreadyContainedInRequirement: string[];
  unresolvedInformation: string[];
}

/** Raw AIProvider.resolveRequirementContext output, before the app assigns ids and runs the clarification gate. */
export interface ContextResolutionOutput {
  normalization: RequirementNormalization;
  knownFacts: Omit<KnownFact, "id">[];
  assumptions: Omit<Assumption, "id" | "status">[];
  missingInformation: Omit<MissingInformation, "id">[];
}

export type RequirementContextStatus = "AWAITING_CLARIFICATION" | "RESOLVED" | "ERROR";

/**
 * The living, persisted state of "what do we know about this requirement" -
 * normalization, facts, assumptions, missing information, and the
 * clarification dialog. Impact analysis and scoring are only run once this
 * reaches RESOLVED (no pending clarifications).
 */
export interface RequirementContext {
  id: string;
  snapshotId: string;
  requirement: Requirement;
  normalization: RequirementNormalization | null;
  knownFacts: KnownFact[];
  assumptions: Assumption[];
  missingInformation: MissingInformation[];
  clarifications: Clarification[];
  status: RequirementContextStatus;
  /** How many resolution rounds have run - see scoring/clarificationGate.ts MAX_RESOLUTION_ROUNDS. */
  resolutionRounds: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// AI usage & cost tracking
// ---------------------------------------------------------------------------

export type AIProviderName = "anthropic" | "openai" | "openrouter" | "local";

/** One logged AI API call: what it cost, in tokens and (where the price is known) dollars. */
export interface AIUsageRecord {
  id: string;
  provider: AIProviderName;
  model: string;
  /** Which AIProvider method this call was for, e.g. "scoreRequirement". */
  operation: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** null when the (provider, model) has no known price (e.g. an unlisted OpenRouter model) - never a guessed number. */
  costUsd: number | null;
  /** Which domain record(s) this call was for - see ai/AIProvider.ts UsageContext. */
  snapshotId: string | null;
  requirementContextId: string | null;
  scoringId: string | null;
  createdAt: string;
}

/** One row of the detailed usage log, with a human-readable label resolved from whichever domain record the call belongs to. */
export interface AIUsageLogEntry extends AIUsageRecord {
  /** The requirement title (requirementContextId/scoringId) or repository URL (snapshotId only) this call was for, or null if the referenced record no longer exists. */
  label: string | null;
}

export interface AIUsageBreakdownEntry {
  key: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number | null;
}

export interface AIUsageSummary {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Sum of costUsd across calls with a known price; null if none had one. */
  costUsd: number | null;
  /** Count of calls whose cost could not be determined (unknown model price). */
  unknownCostRequestCount: number;
  byModel: AIUsageBreakdownEntry[];
  byOperation: AIUsageBreakdownEntry[];
}
