// Mirrors backend/src/domain/types.ts for the subset the UI renders. Kept as
// a plain duplicate rather than a shared package - the two apps are
// deployed and versioned independently for this MVP, and the surface is
// small enough that duplication is cheaper than monorepo tooling.

export type RepositoryStatus = "NOT_ANALYZED" | "CLONING" | "ANALYZING" | "SNAPSHOT_CREATED" | "ERROR";

export type ScoringStatus =
  | "NOT_STARTED"
  | "ANALYZING"
  | "NEEDS_CLARIFICATION"
  | "SCORED"
  | "ASSESSMENT_WITH_ASSUMPTIONS"
  | "DECOMPOSITION_REQUIRED"
  | "ERROR";

export type EvidenceStatus = "VERIFIED" | "INFERRED" | "UNKNOWN";

export interface LocalizedText {
  en: string;
  de: string;
}

export type UiLanguage = "en" | "de";

export interface Evidence {
  file: string;
  reason: string;
}

export interface RepositoryFinding {
  finding: string;
  status: EvidenceStatus;
  evidence: Evidence[];
}

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

/** A row in the "already analyzed, pick me to reuse" list. */
export interface RepositorySnapshotSummary {
  id: string;
  repositoryUrl: string;
  branch: string;
  status: RepositoryStatus;
  commitSha: string | null;
  analyzedAt: string | null;
  profileSummary: string | null;
}

export interface Requirement {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  constraints: string[];
}

/** How thoroughly one pass (resolution + assessment) is run - fixed for a RequirementContext's whole lifetime once chosen. */
export type QualityLevel = "quick" | "standard" | "thorough";

export interface QualityLevelMeta {
  label: string;
  description: string;
}

export const QUALITY_LEVEL_META: Record<QualityLevel, QualityLevelMeta> = {
  quick: {
    label: "Grobschätzung",
    description: "Schnell, weniger Rückfragen, kompaktere Begründungen.",
  },
  standard: {
    label: "Standardschätzung",
    description: "Ausgewogen zwischen Geschwindigkeit und Gründlichkeit.",
  },
  thorough: {
    label: "Feinschätzung",
    description: "Gründlichste Analyse, ausführlichere Begründungen, mehr mögliche Rückfragen.",
  },
};

export const QUALITY_LEVEL_ORDER: QualityLevel[] = ["quick", "standard", "thorough"];

export type ModelCategory = "premium" | "balanced" | "budget" | "cost-performance" | "coding" | "local";

export const MODEL_CATEGORY_LABELS: Record<ModelCategory, string> = {
  premium: "Premium",
  balanced: "Balanced",
  budget: "Günstig",
  "cost-performance": "Günstig · Coding",
  coding: "Coding",
  local: "Lokal",
};

export const AI_PROVIDER_LABELS: Record<AIProviderName, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  google: "Google",
  qwen: "Qwen",
  ollama: "Ollama",
  openrouter: "OpenRouter",
  local: "Lokal",
};

/** One entry of the central Model Registry (see backend/src/domain/models.ts) this deployment can offer for per-requirement selection. */
export interface SelectableModel {
  id: string;
  provider: AIProviderName;
  displayName: string;
  description: string;
  category: ModelCategory;
  local: boolean;
  /** Whether THIS deployment has the provider credential configured - a model without it is shown but disabled, never hidden (spec: an unavailable local model must stay visible). */
  available: boolean;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

export interface SelectableModelsResponse {
  autoModelId: string;
  models: SelectableModel[];
  default: string;
}

/** GET /api/ai-usage/ollama-status - live reachability of the local Ollama server, checked separately from the (static, config-only) SelectableModel.available flag. */
export interface OllamaStatus {
  reachable: boolean;
  models: string[];
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

export const DIMENSION_ORDER = [
  ["functionalScope", "Funktionaler Umfang", 20],
  ["technicalComplexity", "Technische Komplexität", 20],
  ["dataIntegration", "Daten & Integration", 15],
  ["aiComplexity", "AI Complexity", 15],
  ["automation", "Automatisierung", 10],
  ["testingQA", "Testing & QA", 10],
  ["deploymentOperations", "Deployment & Operations", 5],
  ["uncertaintyRisk", "Unsicherheit / Risiko", 5],
] as const;

export type DimensionKey = (typeof DIMENSION_ORDER)[number][0];

export interface DimensionScore {
  score: 1 | 2 | 3 | 4 | 5;
  summary: LocalizedText;
  rationale: LocalizedText;
  evidence: Evidence[];
  confidence: number;
  missingInformation: string[];
  factsUsed: string[];
  assumptionsUsed: string[];
  unresolvedRisks: string[];
}

export type DimensionScores = Record<DimensionKey, DimensionScore>;

export type DuClass = "XS" | "S" | "M" | "L" | "XL" | "XXL";

export interface DuResult {
  weightedScore: number;
  duClass: DuClass;
  developmentUnits: number | null;
  price: number | null;
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
  requirementContextId: string | null;
  requirement: Requirement;
  qualityLevel: QualityLevel;
  model: string;
  status: ScoringStatus;
  impactAnalysis: ImpactAnalysis | null;
  dimensionScores: DimensionScores | null;
  confidence: ConfidenceAssessment | null;
  duResult: DuResult | null;
  overallAssessment: LocalizedText | null;
  assumptionsUsed: string[];
  openQuestions: string[];
  errorMessage: string | null;
  scoredAt: string | null;
}

// ---------------------------------------------------------------------------
// Assumption & Clarification Engine
// ---------------------------------------------------------------------------

export type InformationClass = "FACT" | "DERIVED" | "ASSUMPTION" | "CLARIFICATION_REQUIRED" | "UNKNOWN_NON_BLOCKING";

export type KnownFactSource = "REQUIREMENT" | "ACCEPTANCE_CRITERIA" | "CLARIFICATION_ANSWER" | "REPOSITORY" | "DERIVED";

export interface KnownFact {
  id: string;
  topic: string;
  fact: string;
  source: KnownFactSource;
  evidence: Evidence[];
}

export type AssumptionCriticality = "LOW" | "MEDIUM" | "HIGH";
export type AssumptionStatus = "ACTIVE" | "CONFIRMED" | "REJECTED" | "SUPERSEDED";

export interface Assumption {
  id: string;
  topic: string;
  assumption: string;
  reason: string;
  basis: string[];
  confidence: number;
  affectedDimensions: DimensionKey[];
  potentialScoreImpact: 0 | 1 | 2;
  criticality: AssumptionCriticality;
  status: AssumptionStatus;
}

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

export interface Clarification {
  id: string;
  missingInformationId: string;
  question: string;
  priority: number;
  status: ClarificationStatus;
  answer: string | null;
  answeredAt: string | null;
}

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

export type RequirementContextStatus = "AWAITING_CLARIFICATION" | "RESOLVED" | "ERROR";

export interface RequirementContext {
  id: string;
  snapshotId: string;
  requirement: Requirement;
  qualityLevel: QualityLevel;
  model: string;
  normalization: RequirementNormalization | null;
  knownFacts: KnownFact[];
  assumptions: Assumption[];
  missingInformation: MissingInformation[];
  clarifications: Clarification[];
  status: RequirementContextStatus;
  resolutionRounds: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AssumptionAction = "CONFIRM" | "REJECT" | "EDIT";

/** One row of the requirement -> DU decision history list. */
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
// AI usage & cost dashboard
// ---------------------------------------------------------------------------

export type AIProviderName = "anthropic" | "openai" | "openrouter" | "local" | "deepseek" | "google" | "qwen" | "ollama";

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
  costUsd: number | null;
  unknownCostRequestCount: number;
  byModel: AIUsageBreakdownEntry[];
  byOperation: AIUsageBreakdownEntry[];
}

/** One individual AI call, for the detailed usage log - see backend domain/types.ts AIUsageLogEntry. */
export interface AIUsageLogEntry {
  id: string;
  provider: AIProviderName;
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number | null;
  snapshotId: string | null;
  requirementContextId: string | null;
  scoringId: string | null;
  createdAt: string;
  /** The requirement title or repository URL this call was for, or null if unresolvable. */
  label: string | null;
}

export interface AIUsageConfig {
  provider: AIProviderName;
  model: string;
}
