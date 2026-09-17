// Core domain model for the ISIFIVE DU Calculator.
//
// Naming mirrors the German business vocabulary from the product spec
// (Development Unit / DU) while keeping identifiers in English, matching
// the rest of the codebase.
//
// Four models are kept strictly separate and must never be conflated:
//   A) DU Model       - scope/complexity/risk of the deliverable (duEngine.ts)
//   B) Technology Fit  - how well AI_NATIVE/N8N/INTREXX fit THIS requirement's
//                        technical shape (domain/technology.ts, scoring/technologyFitEngine.ts)
//   C) Effort Model    - AI_NATIVE's own human-effort corridor (scoring/effortEstimator.ts)
//   D) Pricing Model   - commercial price, decoupled from production effort (scoring/pricingEngine.ts)

import type { TechnologyId, TechnologyKey, TechnologyProfileFactor } from "./technology.js";

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

/** A candidate piece to split a too-broad requirement into - see ImpactAnalysis.suggestedDecomposition. */
export interface SuggestedSubRequirement {
  title: string;
  description: string;
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
  /** Usually empty - populated only when the AI judges the requirement's scope broad enough to warrant splitting into smaller, independently estimable pieces. Never implies a DU class; the AI never sees one. */
  suggestedDecomposition: SuggestedSubRequirement[];
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

/**
 * @deprecated Superseded by EffortEstimate (a min/likely/max corridor
 * instead of a single number) - kept only so a DuResult read from a row
 * scored before this change (calculationModelVersion absent) still
 * type-checks. Never produced by new scoring calls.
 */
export interface ImplementationEstimate {
  estimatedHours: number;
  rationale: LocalizedText;
}

// ---------------------------------------------------------------------------
// Technology Fit Model (Model B) - see domain/technology.ts for the factor
// list, the per-technology CapabilityProfile hypotheses, and the overhead/
// guardrail constants. This section only defines what the AI outputs; the
// deterministic fit math lives in scoring/technologyFitEngine.ts.
// ---------------------------------------------------------------------------

/** The AI's assessment of one TechnologyProfileFactor for this specific requirement - see domain/schemas.ts TechnologyProfileFactorSchema. */
export interface TechnologyProfileFactorScore {
  /** 0 = practically not relevant to this requirement, 5 = very strongly characterizes it. */
  score: 0 | 1 | 2 | 3 | 4 | 5;
  rationale: string;
  evidence: Evidence[];
  confidence: number;
}

/** One score per TechnologyProfileFactor (domain/technology.ts TECHNOLOGY_PROFILE_FACTORS), describing the requirement's technical shape - independent of any technology's suitability for it. */
export type TechnologyProfile = Record<TechnologyProfileFactor, TechnologyProfileFactorScore>;

/**
 * How much a given production method can lean on what already exists in
 * this repository (services, APIs, data models, auth, UI components, tests,
 * CI/CD, workflows, prompts/agents, ...). Never invented: assetLeverage is
 * null (UNKNOWN) rather than 0 when the repository simply gives no evidence
 * either way for that technology (e.g. n8n/Intrexx assets are rarely
 * visible in a git repository) - null is "we don't know", not "we verified
 * there is none". Deliberately kept OUT of the DU Model: reuse that only
 * makes ISIFIVE's own production faster must never reduce the DU count
 * (see ai/prompts.ts REUSE_RULE) - this field feeds the Effort/Technology
 * Fit models only.
 */
export interface ExistingAssetLeverage {
  technology: TechnologyId;
  /** 0.0-1.0, or null when the repository gives no evidence either way for this technology. */
  assetLeverage: number | null;
  rationale: string;
  evidence: Evidence[];
  confidence: number;
}

/** The AI's qualitative read on one technology for this requirement - narrative only, never a source of the computed relativeEffortFactor. */
export interface TechnologyNarrative {
  technology: TechnologyId;
  advantages: string[];
  disadvantages: string[];
}

/**
 * AI_NATIVE's own human-effort estimate for this requirement, as a range
 * rather than a false-precision single number - see domain/schemas.ts
 * EffortEstimateSchema for the full contract on what this counts (human
 * analysis/briefing/review/correction/testing/deployment time, NOT "the AI
 * runs for N hours"). This is the Effort Model's (Model C) sole output, and
 * the baseline every other technology's estimatedHours is scaled from (see
 * scoring/technologyFitEngine.ts).
 */
export interface EffortEstimate {
  minHours: number;
  likelyHours: number;
  maxHours: number;
  confidence: number;
  rationale: LocalizedText;
}

/** Impact analysis and scoring produced together in one AI call - see AIProvider.assessRequirement. */
export interface RequirementAssessment {
  impactAnalysis: ImpactAnalysis;
  dimensions: DimensionScores;
  overallAssessment: LocalizedText;
  effortEstimate: EffortEstimate;
  technologyProfile: TechnologyProfile;
  existingAssetLeverage: ExistingAssetLeverage[];
  technologyNarratives: TechnologyNarrative[];
}

export type DuClass = "XS" | "S" | "M" | "L" | "XL" | "XXL";

/**
 * @deprecated Superseded by EffortEstimate + TechnologyAssessment
 * (technology-fit-v2) - the totalHours/promptingHours split this represents
 * was found to be fachlich nicht belastbar (a high aiComplexity score does
 * not necessarily mean more prompting time). Kept only so a DuResult read
 * from a row scored before this change still type-checks; never produced by
 * new scoring calls. See DuResult.calculationModelVersion.
 */
export interface TimeEstimate {
  totalHours: number;
  developmentHours: number;
  promptingHours: number;
  rationale: LocalizedText;
  referenceHoursFromDU: number;
  hoursPerDU: number;
  hasSignificantDeviationFromDuReference: boolean;
}

export type AlternativeApproachId = "classicalDevelopment" | "n8n" | "intrexx" | "n8nIntrexxCombined";

/**
 * @deprecated Superseded by TechnologyAssessment (technology-fit-v2) - this
 * shape's relativeEffort formula (`1 - fitScore * 0.7`) could only ever
 * reduce effort relative to classicalDevelopment, structurally incapable of
 * modeling a technology that costs MORE than AI-native custom development.
 * Kept only so a DuResult read from a row scored before this change still
 * type-checks; never produced by new scoring calls.
 */
export interface AlternativeApproachEstimate {
  id: AlternativeApproachId;
  label: string;
  relativeEffort: number;
  estimatedHours: number;
  rationale: string;
}

/** How the commercial price is derived - see scoring/pricingEngine.ts. Independent of which technology the comparison favors; always priced against ISIFIVE's own AI-native delivery. */
export type PricingStrategy = "HOURLY" | "DU_FIXED_PRICE";

/**
 * One row of the technology comparison - AI_NATIVE (pinned to
 * relativeEffortFactor 1.0, the reference every other row is scaled
 * against) plus every other modeled technology and supported combination.
 * relativeEffortFactor, fit, and estimatedHours are all computed
 * deterministically (scoring/technologyFitEngine.ts) from TechnologyProfile
 * + the technology's CapabilityProfile + its ExistingAssetLeverage +, for
 * combinations, integration/operational overhead - never asked of the AI
 * directly, so the number is reproducible and auditable. advantages/
 * disadvantages are the AI's own qualitative read (TechnologyNarrative);
 * evidence/rationale are assembled from the AI's per-factor and
 * asset-leverage evidence, never invented.
 */
export interface TechnologyAssessment {
  technology: TechnologyKey;
  label: string;
  /** 0.0-1.0, higher = better fit for this requirement's technical shape. Descriptive only - see relativeEffortFactor for the actual effort comparison. */
  fit: number;
  fitConfidence: number;
  /** 0.0-1.0, or null when no technology in this row has repository evidence either way (UNKNOWN, never assumed 0). Combinations average their members' known values. */
  assetLeverage: number | null;
  assetLeverageConfidence: number | null;
  /** 0 for a single technology; > 0 only for a combination row (domain/technology.ts COMBINATION_INTEGRATION_OVERHEAD/COMBINATION_OPERATIONAL_OVERHEAD). */
  integrationOverhead: number;
  operationalOverhead: number;
  /**
   * This technology's effort relative to AI_NATIVE's own EffortEstimate -
   * 1.0 for AI_NATIVE by construction, but otherwise free to land above OR
   * below 1.0 depending on the actual requirement (clamped only by the
   * technical guardrail in domain/technology.ts, not by an assumed ceiling
   * on how much a platform can help or hurt).
   */
  relativeEffortFactor: number;
  estimatedHours: { minHours: number; likelyHours: number; maxHours: number };
  advantages: string[];
  disadvantages: string[];
  evidence: Evidence[];
  /** Short, deterministically generated explanation naming the requirement characteristics that drove this technology's fit - not free-form AI prose, so it stays traceable to the actual computation. */
  rationale: string;
}

export interface DuResult {
  weightedScore: number;
  duClass: DuClass;
  /** null for XXL - no artificially precise extrapolated count is produced; decomposition into smaller, separately estimable requirements is recommended instead (see determineScoringStatus). */
  developmentUnits: number | null;
  price: number | null; // null when no price is computable under pricingStrategy (e.g. DU_FIXED_PRICE with developmentUnits null) or no price configured
  pricingStrategy: PricingStrategy;
  overallConfidence: number;
  confidenceLevel: "HIGH" | "MEDIUM" | "LOW";
  /** True only for XXL - developmentUnits is null and decomposition is recommended regardless of any other field here (see scoring/duEngine.ts determineScoringStatus). */
  isRoughEstimate: boolean;
  /** Absent (legacy-v1) for a DuResult computed before this change - see calculationModelVersion. */
  effortEstimate?: EffortEstimate;
  technologyComparison?: TechnologyAssessment[];
  /** Absent means this DuResult was computed by the pre-technology-fit engine ("legacy-v1") - only timeEstimate/alternativeApproaches are populated in that case, never effortEstimate/technologyComparison. */
  calculationModelVersion?: "technology-fit-v2";
  /** @deprecated legacy-v1 only - see TimeEstimate. */
  timeEstimate?: TimeEstimate;
  /** @deprecated legacy-v1 only - see AlternativeApproachEstimate. */
  alternativeApproaches?: AlternativeApproachEstimate[];
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
  /** Which quality level (see QualityLevel) this run was scored at - part of the audit trail for "why was this X DU". */
  qualityLevel: QualityLevel;
  /** Which model actually produced this assessment - see domain/models.ts. */
  model: string;
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
 * How thoroughly one pass (resolution + assessment) is run - chosen once
 * when a requirement is first submitted and then fixed for that
 * RequirementContext's whole lifetime (every clarification round and the
 * final scoring reuse it), so a run never drifts between depths partway
 * through. See domain/qualityLevels.ts for what each level actually tunes.
 */
export type QualityLevel = "quick" | "standard" | "thorough";

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
  qualityLevel: QualityLevel;
  /** Which model this context is resolved with - see domain/models.ts. Fixed once chosen, same as qualityLevel. */
  model: string;
  normalization: RequirementNormalization | null;
  knownFacts: KnownFact[];
  assumptions: Assumption[];
  missingInformation: MissingInformation[];
  clarifications: Clarification[];
  status: RequirementContextStatus;
  /** How many resolution rounds have run - see domain/qualityLevels.ts maxResolutionRounds. */
  resolutionRounds: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Calibration data (section 19 of the technology-fit-v2 spec) - today's
// CapabilityProfile/overhead constants (domain/technology.ts) are explicitly
// labeled hypotheses (CALIBRATION_STATUS = "INITIAL_HYPOTHESIS"). This
// records what was actually predicted vs. what actually happened per
// requirement, so they can be recalibrated later against real ISIFIVE
// project outcomes. No self-learning/auto-adjustment is implemented yet -
// this is data collection only.
// ---------------------------------------------------------------------------

/** One real outcome recorded against a past ScoringResult - see store/ActualEffortStore.ts. */
export interface ActualEffortRecord {
  id: string;
  scoringId: string;
  actualHumanHours: number;
  /** Which production method was actually used to deliver this. */
  actualImplementationMethod: TechnologyKey;
  /** Free-text note on rework/bugfix/acceptance-iteration effort not captured by actualHumanHours alone, if any. */
  notes: string | null;
  recordedAt: string;
}

// ---------------------------------------------------------------------------
// AI usage & cost tracking
// ---------------------------------------------------------------------------

// "openrouter" and "local" are the legacy single-active-provider path (see
// config.ts AI_PROVIDER, ai/getAIProvider.ts) - a generic escape hatch for
// "any other OpenAI-compatible endpoint", predating the per-request Model
// Registry (domain/models.ts). "deepseek" | "google" | "qwen" | "ollama" are
// registry-native providers, each independently configured and selectable
// per request regardless of what AI_PROVIDER points at.
export type AIProviderName = "anthropic" | "openai" | "openrouter" | "local" | "deepseek" | "google" | "qwen" | "ollama";

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
