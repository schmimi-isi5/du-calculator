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

export type RepositorySnapshotMode = "EXISTING_SYSTEM" | "GREENFIELD";

export interface RepositorySnapshot {
  id: string;
  repositoryUrl: string;
  branch: string;
  status: RepositoryStatus;
  mode?: RepositorySnapshotMode;
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
  mode?: RepositorySnapshotMode;
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

/** Whether a provider's credential is configured - never the credential value itself. See backend/src/api/settingsRoutes.ts. */
export interface ProviderStatus {
  id: AIProviderName;
  envVar: string;
  configured: boolean;
}

export interface SettingsSnapshot {
  autoModelId: string;
  /** The currently effective default model - either defaultModelOverride, or the env-configured/built-in fallback if no override is set. */
  defaultModelId: string;
  /** The operator-set override (Einstellungen tab), or null if none is set. */
  defaultModelOverride: string | null;
  models: SelectableModel[];
  providers: ProviderStatus[];
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
  /** Usually empty - populated only when the AI judges the requirement's scope broad enough to warrant splitting. */
  suggestedDecomposition: SuggestedSubRequirement[];
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

/** @deprecated legacy-v1 only - see DuResult.calculationModelVersion. Superseded by EffortEstimate. */
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

/** @deprecated legacy-v1 only - see DuResult.calculationModelVersion. Superseded by TechnologyAssessment. */
export interface AlternativeApproachEstimate {
  id: AlternativeApproachId;
  label: string;
  relativeEffort: number;
  estimatedHours: number;
  rationale: string;
}

export const TECHNOLOGY_IDS = ["AI_NATIVE", "CLASSIC", "N8N", "INTREXX"] as const;
export type TechnologyId = (typeof TECHNOLOGY_IDS)[number];
export type TechnologyKey = TechnologyId | "N8N_INTREXX";

export const TECHNOLOGY_PROFILE_FACTORS = [
  "uiForms",
  "crudDataManagement",
  "workflowOrchestration",
  "standardConnectors",
  "customIntegrations",
  "customBusinessLogic",
  "aiAgentsRag",
  "complexStateManagement",
  "customAlgorithms",
  "testingRequirements",
  "deploymentComplexity",
  "expectedChangeFrequency",
] as const;
export type TechnologyProfileFactor = (typeof TECHNOLOGY_PROFILE_FACTORS)[number];

// ---------------------------------------------------------------------------
// Effort Model (C) - bottom-up Work Package estimation (effort-bottom-up-v1).
// See backend/src/domain/effort.ts / domain/types.ts for the full contract.
// ---------------------------------------------------------------------------

export const EFFORT_WORK_PACKAGE_CATEGORIES = [
  "ANALYSIS",
  "ARCHITECTURE",
  "DATA_MODEL",
  "BACKEND",
  "FRONTEND",
  "INTEGRATION",
  "AI_RAG_AGENT",
  "AUTOMATION",
  "MIGRATION",
  "TESTING_QA",
  "DEPLOYMENT",
  "DOCUMENTATION",
  "OTHER",
] as const;
export type EffortWorkPackageCategory = (typeof EFFORT_WORK_PACKAGE_CATEGORIES)[number];

export type EffortWorkPackageAction = "CREATE" | "MODIFY" | "CONFIGURE" | "INTEGRATE" | "MIGRATE" | "TEST" | "DEPLOY" | "REVIEW" | "OTHER";
export type WorkPackageReuseLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH";
export type EffortDriverImpact = "INCREASE" | "DECREASE";
export type EffortSanityFlag =
  | "EFFORT_REVIEW_RECOMMENDED"
  | "LARGE_WORK_PACKAGE"
  | "LOW_EVIDENCE"
  | "POSSIBLE_MISSING_TESTING"
  | "POSSIBLE_OVERLAP";

export interface HumanEffortCorridor {
  minHours: number;
  likelyHours: number;
  maxHours: number;
}

export interface RepositoryEvidenceRef {
  path: string;
  symbol: string | null;
  status: EvidenceStatus;
}

export interface WorkPackageReuse {
  level: WorkPackageReuseLevel;
  description: string;
  evidence: Evidence[];
}

export interface EffortDriver {
  type: string;
  impact: EffortDriverImpact;
  description: string;
  evidence: Evidence[];
}

export interface EffortWorkPackage {
  id: string;
  title: string;
  category: EffortWorkPackageCategory;
  description: string;
  action: EffortWorkPackageAction;
  affectedComponents: string[];
  repositoryEvidence: RepositoryEvidenceRef[];
  dependencies: string[];
  reuse: WorkPackageReuse;
  humanEffort: HumanEffortCorridor;
  confidence: number;
  rationale: string;
  assumptions: string[];
  risks: string[];
  effortDrivers: EffortDriver[];
  isLargeWorkPackage: boolean;
}

export interface EffortCompletenessAssessment {
  complete: boolean;
  missingAreas: string[];
  overlapWarnings: string[];
}

export interface EffortWorkBreakdown {
  workPackages: EffortWorkPackage[];
  completenessAssessment: EffortCompletenessAssessment;
  clarificationsRequired: string[];
  generalAssumptions: string[];
  calculationMethod: "BOTTOM_UP_WORK_PACKAGE_AGGREGATION";
  calculationModelVersion: "effort-bottom-up-v1";
  flags: EffortSanityFlag[];
}

/** AI_NATIVE's own human-effort corridor for this requirement - not derived from the DU dimension scores. See backend/src/scoring/effortEstimator.ts. */
export interface EffortEstimate {
  minHours: number;
  likelyHours: number;
  maxHours: number;
  confidence: number;
  rationale: LocalizedText;
  /** Present only when this estimate came from bottom-up Work Package aggregation (effort-bottom-up-v1) - absent for an older/legacy estimate. */
  workBreakdown?: EffortWorkBreakdown;
}

/** How the commercial price is derived - see backend/src/scoring/pricingEngine.ts. */
export type PricingStrategy = "HOURLY" | "DU_FIXED_PRICE";

export interface TechnologyFactorContribution {
  factor: TechnologyProfileFactor;
  label: string;
  contribution: number;
  direction: "increases" | "decreases";
}

/** One row of the technology comparison - see backend/src/domain/types.ts TechnologyAssessment for the full computation contract. */
export interface TechnologyAssessment {
  technology: TechnologyKey;
  label: string;
  fit: number;
  fitConfidence: number;
  assetLeverage: number | null;
  assetLeverageConfidence: number | null;
  integrationOverhead: number;
  operationalOverhead: number;
  relativeEffortFactor: number;
  estimatedHours: { minHours: number; likelyHours: number; maxHours: number };
  advantages: string[];
  disadvantages: string[];
  evidence: Evidence[];
  rationale: string;
  contributions: TechnologyFactorContribution[];
  varianceFlag: "HIGH_VARIANCE_COMPARISON" | null;
}

export type DirectCostType = "ONE_TIME_DEVELOPMENT" | "RECURRING_RUNTIME" | "BOTH";
export type DirectCostStatus = "ESTIMATED" | "UNKNOWN" | "ESTIMATE_REQUIRED";

export interface DirectCostItem {
  amountEur: number | null;
  costType: DirectCostType;
  status: DirectCostStatus;
  rationale: string;
}

export interface DirectCostEstimate {
  aiApiCost: DirectCostItem;
  infrastructureCost: DirectCostItem;
  thirdPartyCost: DirectCostItem;
  otherDirectCost: DirectCostItem;
}

/** @deprecated commercial-du-v1 only - see ImplementationNoveltyLevel/ReusableInnovationLevel. */
export type InnovationLevel = "LOW" | "MEDIUM" | "HIGH";

/** @deprecated commercial-du-v1 only. */
export interface InnovationAssessment {
  level: InnovationLevel;
  rationale: string;
  evidence: Evidence[];
  confidence: number;
}

export type ImplementationNoveltyLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ImplementationNoveltyAssessment {
  level: ImplementationNoveltyLevel;
  rationale: string;
  evidence: Evidence[];
  confidence: number;
}

export type ReusableInnovationLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH";

/** Captured/displayed only - never feeds an automatic Commercial DU or price adjustment. */
export interface ReusableInnovationAssessment {
  level: ReusableInnovationLevel;
  rationale: string;
  evidence: Evidence[];
  confidence: number;
}

export type CalibrationStatus = "INITIAL_HYPOTHESIS" | "EXPERT_CALIBRATED" | "EMPIRICALLY_CALIBRATED" | "DATA_DRIVEN";

export interface CommercialAdjustment {
  label: string;
  deltaDU: number;
  reason: string;
}

/** One Base DU class's provisional effort comparison point - NOT a Development Unit definition. */
export interface EffortBenchmarkInfo {
  class: string;
  expectedLikelyHours: number;
  calibrationStatus: CalibrationStatus;
  sampleSize: number;
  modelVersion: string;
}

export interface EffortVariance {
  hours: number;
  percent: number;
}

/** Exactly one of productivityGain/positiveEffortOverrun is non-null (or both null when effort ≈ benchmark). */
export interface EffortAnalysis {
  benchmark: EffortBenchmarkInfo;
  predictedLikelyHours: number;
  variance: EffortVariance;
  productivityGain: EffortVariance | null;
  positiveEffortOverrun: EffortVariance | null;
}

/** REQUIRES_CLARIFICATION means effort confidence is too low to responsibly present a confident Commercial DU offer. */
export type CommercialEstimateStatus = "OK" | "REQUIRES_CLARIFICATION";

/** Output of the Commercial Model - see backend/src/scoring/commercialEngine.ts. Base DU adjusted for effort/direct costs/implementation novelty/risk - deliberately NOT a time conversion. */
export interface CommercialCalculation {
  baseDU: number | null;
  suggestedCommercialDU: number | null;
  commercialDUConfidence: number;
  targetCommercialValue: number | null;
  rationale: string;
  adjustments: CommercialAdjustment[];
  calibrationStatus: CalibrationStatus;
  /** commercial-du-v2 only. */
  effortAnalysis?: EffortAnalysis | null;
  commercialDUBeforeGuardrail?: number | null;
  commercialDUAfterGuardrail?: number | null;
  guardrailApplied?: boolean;
  guardrailReason?: string | null;
  estimateStatus?: CommercialEstimateStatus;
}

export interface DuResult {
  weightedScore: number;
  duClass: DuClass;
  /** Base DU - null for XXL, no artificially precise extrapolated count is produced; decomposition is recommended instead. NOT the commercial unit offered to the customer - see commercialDevelopmentUnits. */
  developmentUnits: number | null;
  price: number | null;
  pricingStrategy: PricingStrategy;
  overallConfidence: number;
  confidenceLevel: "HIGH" | "MEDIUM" | "LOW";
  /** True only for XXL - developmentUnits is null and decomposition is recommended regardless of any other field here. */
  isRoughEstimate: boolean;
  /** Absent for a DuResult computed before this change (calculationModelVersion undefined = "legacy-v1"). */
  effortEstimate?: EffortEstimate;
  technologyComparison?: TechnologyAssessment[];
  directCosts?: DirectCostEstimate;
  /** @deprecated commercial-du-v1 only - see implementationNovelty/reusableInnovationIp. */
  innovation?: InnovationAssessment;
  implementationNovelty?: ImplementationNoveltyAssessment;
  reusableInnovationIp?: ReusableInnovationAssessment;
  commercialCalculation?: CommercialCalculation;
  commercialDevelopmentUnits?: number | null;
  calculationModelVersion?: "technology-fit-v2" | "commercial-du-v1" | "commercial-du-v2";
  /** @deprecated legacy-v1 only. */
  timeEstimate?: TimeEstimate;
  /** @deprecated legacy-v1 only. */
  alternativeApproaches?: AlternativeApproachEstimate[];
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

/** The narrow, customer-safe payload served by the public share link (GET /api/requirement/:id/customer-report) - see backend/src/api/customerReport.ts. */
export interface CustomerReportTechnology {
  technology: TechnologyKey;
  label: string;
  relativeEffortFactor: number;
  advantages: string[];
  disadvantages: string[];
}

export interface CustomerReportRuntimeCost {
  label: string;
  amountEur: number | null;
  status: DirectCostStatus;
}

export interface CustomerReport {
  scoringId: string;
  requirement: { title: string; description: string };
  price: number | null;
  pricingStrategy: PricingStrategy;
  isRoughEstimate: boolean;
  duClass: DuClass;
  developmentUnits: number | null;
  overallConfidence: number;
  confidenceLevel: "HIGH" | "MEDIUM" | "LOW";
  created: string[];
  modified: string[];
  reused: string[];
  technologyComparison: CustomerReportTechnology[];
  runtimeCosts: CustomerReportRuntimeCost[];
  suggestedDecomposition: SuggestedSubRequirement[];
  overallAssessment: LocalizedText | null;
}

// ---------------------------------------------------------------------------
// Calibration data (Prognose vs. Ist) - see backend/src/domain/types.ts
// EffortPredictionSnapshot/ActualEffortRecord.
// ---------------------------------------------------------------------------

export interface EffortPredictionSnapshot {
  calculationModelVersion: string | null;
  predictedBaseDU: number | null;
  predictedCommercialDU: number | null;
  predictedEffortMinHours: number;
  predictedEffortLikelyHours: number;
  predictedEffortMaxHours: number;
  predictedEffortConfidence: number | null;
  effortWorkBreakdown: EffortWorkBreakdown | null;
  effortBenchmark: EffortBenchmarkInfo | null;
  effortAdjustment: CommercialAdjustment | null;
  predictedTechnologyComparison: TechnologyAssessment[];
  directCostsPredicted: DirectCostEstimate | null;
  innovationLevel: InnovationLevel | null;
  implementationNovelty: ImplementationNoveltyAssessment | null;
  reusableInnovationIp: ReusableInnovationAssessment | null;
  commercialRiskReserve: CommercialAdjustment | null;
  commercialDUBeforeGuardrail: number | null;
  commercialDUAfterGuardrail: number | null;
  guardrailApplied: boolean | null;
  pricingStrategy: PricingStrategy;
  offeredPrice: number | null;
}

/** A recorded real-world outcome for a scored requirement - see backend/src/store/ActualEffortStore.ts. Never overwrites the original prediction; predictionSnapshot is frozen at the moment this was recorded. */
export interface ActualEffortRecord {
  id: string;
  scoringId: string;
  actualHumanHours: number;
  actualImplementationMethod: TechnologyKey;
  predictionSnapshot: EffortPredictionSnapshot | null;
  directCostsActual: DirectCostEstimate | null;
  reworkHours: number | null;
  bugfixHours: number | null;
  acceptanceIterations: number | null;
  scopeChanged: boolean | null;
  notes: string | null;
  recordedAt: string;
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
  suggestedTitle: string;
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

// ---------------------------------------------------------------------------
// Requirement Challenge & Optimization (requirement-challenge-v1) - a
// fachlich stage between normalization and the five calculation models.
// Separates the underlying business goal from any proposed technical
// solution and surfaces reviewable proposals; never states a DU/effort/
// price/technology-fit number. See backend/src/domain/requirementChallenge.ts
// and backend/src/domain/types.ts for the full contract.
// ---------------------------------------------------------------------------

export const REQUIREMENT_CHALLENGE_TYPES = [
  "UNCLEAR",
  "ASSUMPTION",
  "SOLUTION_CONSTRAINT",
  "OPTIMIZATION",
  "CONFLICT",
  "SCOPE_REDUCTION",
  "REUSE_OPPORTUNITY",
  "ACCEPTANCE_IMPROVEMENT",
] as const;
export type RequirementChallengeType = (typeof REQUIREMENT_CHALLENGE_TYPES)[number];

export const CHALLENGE_TYPE_LABELS: Record<RequirementChallengeType, string> = {
  UNCLEAR: "Unklar",
  ASSUMPTION: "Angenommen",
  SOLUTION_CONSTRAINT: "Lösungsannahme",
  OPTIMIZATION: "Optimierung",
  CONFLICT: "Konflikt",
  SCOPE_REDUCTION: "Umfang reduzierbar",
  REUSE_OPPORTUNITY: "Wiederverwendung",
  ACCEPTANCE_IMPROVEMENT: "Akzeptanzkriterium",
};

export type RequirementChallengeProposalStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "EDITED" | "SUPERSEDED";

export type ChallengeEvidenceSourceType =
  | "ORIGINAL_REQUIREMENT"
  | "NORMALIZED_REQUIREMENT"
  | "KNOWN_CONSTRAINT"
  | "USER_CLARIFICATION"
  | "REPOSITORY"
  | "TECHNICAL_PROJECT_PROFILE"
  | "DERIVED"
  | "ASSUMPTION";

export interface ChallengeEvidence {
  sourceType: ChallengeEvidenceSourceType;
  reference: string;
  description: string;
  status: EvidenceStatus;
}

export type ChallengeImpactDirection = "LOWER" | "SAME" | "HIGHER" | "UNKNOWN";
export type ChallengeMaintainabilityImpact = "BETTER" | "SAME" | "WORSE" | "UNKNOWN";

export interface RequirementChallengeExpectedImpact {
  scope: ChallengeImpactDirection;
  complexity: ChallengeImpactDirection;
  maintainability: ChallengeMaintainabilityImpact;
  reuse: ChallengeImpactDirection;
  implementationFreedom: ChallengeImpactDirection;
}

export interface RequirementChallengeProposal {
  id: string;
  type: RequirementChallengeType;
  status: RequirementChallengeProposalStatus;
  title: string;
  originalText: string;
  issue: string;
  proposedChange: string;
  rationale: string;
  evidence: ChallengeEvidence[];
  expectedImpact: RequirementChallengeExpectedImpact;
  confidence: number;
  editedChange: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export type SolutionSpecificityLevel = "LOW" | "MEDIUM" | "HIGH";

export interface RequirementChallengeAnalysis {
  goal: string;
  problemStatement: string;
  solutionSpecificity: SolutionSpecificityLevel;
}

export type RequirementApprovalStatus = "DRAFT" | "CHALLENGE_IN_PROGRESS" | "READY_FOR_APPROVAL" | "APPROVED";

export interface RequirementContext {
  id: string;
  snapshotId: string;
  requirement: Requirement;
  originalRequirement: Requirement;
  normalizedRequirement: Requirement | null;
  approvedRequirement: Requirement | null;
  approvalStatus: RequirementApprovalStatus;
  challengeAnalysis: RequirementChallengeAnalysis | null;
  challengeProposals: RequirementChallengeProposal[];
  requirementPreparationVersion: string | null;
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
export type ChallengeProposalAction = "ACCEPT" | "REJECT" | "EDIT";

/** Global counts for the overview Dashboard - see backend/src/domain/types.ts RepositoryStats. */
export interface RepositoryStats {
  total: number;
  byStatus: Partial<Record<RepositoryStatus, number>>;
  byMode: Partial<Record<RepositorySnapshotMode, number>>;
}

/** Global counts for the overview Dashboard - see backend/src/domain/types.ts ScoringStats. */
export interface ScoringStats {
  total: number;
  byStatus: Partial<Record<ScoringStatus, number>>;
}

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
