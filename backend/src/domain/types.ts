// Core domain model for the ISIFIVE DU Calculator.
//
// Naming mirrors the German business vocabulary from the product spec
// (Development Unit / DU) while keeping identifiers in English, matching
// the rest of the codebase.
//
// Five models are kept strictly separate and must never be conflated:
//   A) DU Model         - Base DU: scope/complexity/risk of the deliverable (duEngine.ts)
//   B) Technology Fit    - how well AI_NATIVE/CLASSIC/N8N/INTREXX fit THIS requirement's
//                          technical shape (domain/technology.ts, scoring/technologyFitEngine.ts)
//   C) Effort Model      - AI_NATIVE's own human-effort corridor (scoring/effortEstimator.ts)
//   D) Commercial Model  - Commercial DU: Base DU adjusted for effort/direct costs/
//                          innovation/risk, NOT a time conversion (domain/commercial.ts,
//                          scoring/commercialEngine.ts)
//   E) Pricing Model     - commercial price, decoupled from production effort (scoring/pricingEngine.ts)

import type { TechnologyId, TechnologyKey, TechnologyProfileFactor } from "./technology.js";
import type {
  EffortDriverImpact,
  EffortSanityFlag,
  EffortWorkPackageAction,
  EffortWorkPackageCategory,
  WorkPackageReuseLevel,
} from "./effort.js";
import type {
  ChallengeEvidenceSourceType,
  ChallengeImpactDirection,
  ChallengeMaintainabilityImpact,
  RequirementApprovalStatus,
  RequirementChallengeProposalStatus,
  RequirementChallengeType,
  SolutionSpecificityLevel,
} from "./requirementChallenge.js";

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
 * EXISTING_SYSTEM (default) means a real repository was cloned and analyzed
 * - the repository is the central evidence source. GREENFIELD means no
 * repository exists yet; the assessment is based on the requirement,
 * acceptance criteria, constraints, and target architecture the customer
 * describes instead. A missing repository must never be treated as an
 * error - see api/repositoryRoutes.ts POST /greenfield, which creates a
 * RepositorySnapshot with mode: "GREENFIELD" and a synthetic profile
 * instead of skipping the snapshot mechanism entirely - this reuses every
 * existing snapshot-keyed code path (RequirementContext, ScoringResult,
 * history) without a parallel "no repository" flow.
 */
export type RepositorySnapshotMode = "EXISTING_SYSTEM" | "GREENFIELD";

/**
 * Result of cloning and reading a real repository (EXISTING_SYSTEM), or a
 * synthetic placeholder for a requirement with no repository yet
 * (GREENFIELD). Only ever set to SNAPSHOT_CREATED once the clone (if any),
 * file listing, and repository profile have all actually succeeded.
 */
export interface RepositorySnapshot {
  id: string;
  repositoryUrl: string;
  branch: string;
  status: RepositoryStatus;
  /** Absent on old rows - treat as "EXISTING_SYSTEM" (see toSnapshot in PostgresScoringStore.ts). */
  mode?: RepositorySnapshotMode;
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
  mode?: RepositorySnapshotMode;
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

// ---------------------------------------------------------------------------
// Effort Model (C) - bottom-up human-effort estimation (effort-bottom-up-v1).
// See domain/effort.ts for the category/action/reuse-level vocabularies and
// tuning constants. The AI identifies and estimates Work Packages only; the
// application aggregates the total corridor and overall confidence
// deterministically (scoring/effortEstimator.ts) - the AI never states an
// independent total that could diverge from the sum of its own Work
// Packages (spec: "AI analyzes and estimates components. Application
// aggregates deterministically.").
// ---------------------------------------------------------------------------

export interface HumanEffortCorridor {
  minHours: number;
  likelyHours: number;
  maxHours: number;
}

/** A concrete file/symbol this Work Package is grounded in - EXISTING_SYSTEM mode only; always empty in GREENFIELD (no repository to cite). Never invented - see EvidenceStatus. */
export interface RepositoryEvidenceRef {
  path: string;
  symbol: string | null;
  status: EvidenceStatus;
}

/**
 * How much this Work Package can lean on an existing component - an input/
 * explanation/calibration signal, never a second discount stacked on top of
 * the AI's own humanEffort estimate for this package (spec: "Reuse nicht
 * doppelt verrechnen" - the AI already accounts for reuse when it estimates
 * humanEffort; this field explains why, it does not further reduce it).
 */
export interface WorkPackageReuse {
  level: WorkPackageReuseLevel;
  description: string;
  evidence: Evidence[];
}

/** One factor the AI judges to materially move a Work Package's effort up or down - explainability only, never a percentage formula (spec: "keine Prozentwerte notwendig"). */
export interface EffortDriver {
  type: string;
  impact: EffortDriverImpact;
  description: string;
  evidence: Evidence[];
}

/**
 * One concrete, independently estimable unit of work, as identified by the
 * AI directly from the Requirement Impact Analysis (existing/reusable/
 * modify/create/...) plus the repository (or, in GREENFIELD, the
 * requirement/acceptance criteria/constraints/assumptions alone). Deliberately
 * NOT microscopic and NOT the whole requirement in one package - see
 * domain/effort.ts LARGE_WORK_PACKAGE_THRESHOLD_HOURS. This is the raw AI
 * shape (see domain/schemas.ts EffortWorkPackageSchema) - see
 * EffortWorkPackage for the app-normalized version with isLargeWorkPackage
 * computed.
 */
export interface EffortWorkPackageInput {
  id: string;
  title: string;
  category: EffortWorkPackageCategory;
  description: string;
  action: EffortWorkPackageAction;
  affectedComponents: string[];
  /** Empty in GREENFIELD mode - never a fabricated file path. */
  repositoryEvidence: RepositoryEvidenceRef[];
  /** ids of other Work Packages in this same breakdown this one depends on. Dependencies affect explainability/sequencing only - human hours are always summed regardless of dependencies (spec: personnel effort, not calendar/lead time). */
  dependencies: string[];
  reuse: WorkPackageReuse;
  /** Human personal effort for this package alone - analysis, briefing/steering coding agents, review, corrections, integration, testing, deployment. Never coding-agent runtime/tokens/CPU time. */
  humanEffort: HumanEffortCorridor;
  confidence: number;
  rationale: string;
  assumptions: string[];
  risks: string[];
  effortDrivers: EffortDriver[];
}

/**
 * The normalized (rounded, corridor-consistent) Work Package the application
 * actually stores/displays - see scoring/effortEstimator.ts
 * buildEffortEstimateFromWorkPackages. isLargeWorkPackage is computed here,
 * never provided by the AI.
 */
export interface EffortWorkPackage extends EffortWorkPackageInput {
  /** App-computed (not from the AI) - see domain/effort.ts LARGE_WORK_PACKAGE_THRESHOLD_HOURS. A signal to consider further decomposition, not an error. */
  isLargeWorkPackage: boolean;
}

/**
 * The second, self-check pass the AI performs on its own Work Package list
 * before finalizing its response (spec section 22-23) - "did I miss a
 * necessary package?" and "do any of these overlap/double-count the same
 * work?". Both arrays are usually empty; a non-empty missingAreas does NOT
 * mean the AI must retroactively add a package for every category, only
 * that it judged something concretely missing.
 */
export interface EffortCompletenessAssessment {
  complete: boolean;
  missingAreas: string[];
  overlapWarnings: string[];
}

/**
 * Raw output of the effort work-breakdown portion of AIProvider.assessRequirement
 * - see domain/schemas.ts EffortWorkBreakdownOutputSchema. Deliberately has
 * NO total/overall-confidence field: the application computes those from
 * workPackages alone (scoring/effortEstimator.ts
 * buildEffortEstimateFromWorkPackages).
 */
export interface EffortWorkBreakdownOutput {
  workPackages: EffortWorkPackageInput[];
  completenessAssessment: EffortCompletenessAssessment;
  /** In German - only genuinely material open questions (spec section 20-21 materiality gate); folded into ScoringResult.openQuestions by the caller, since the interactive Assumption/Clarification round has already closed by the time this call runs. Empty array is the common case. */
  clarificationsRequired: string[];
  generalAssumptions: string[];
}

/**
 * The deterministically aggregated, explainable result of the bottom-up
 * Work Breakdown - embedded in EffortEstimate.workBreakdown. Absent
 * entirely on an EffortEstimate produced before this change (or, in
 * principle, by any future non-bottom-up effort method) - see
 * EffortEstimate.workBreakdown.
 */
export interface EffortWorkBreakdown {
  /** Normalized (rounded, corridor-consistent) copies of the AI's Work Packages, each with isLargeWorkPackage computed. */
  workPackages: EffortWorkPackage[];
  completenessAssessment: EffortCompletenessAssessment;
  clarificationsRequired: string[];
  generalAssumptions: string[];
  calculationMethod: "BOTTOM_UP_WORK_PACKAGE_AGGREGATION";
  calculationModelVersion: "effort-bottom-up-v1";
  /** Deterministic Sanity Check flags (spec section 45) - explainability signals only, never a hidden hour adjustment. */
  flags: EffortSanityFlag[];
}

/**
 * AI_NATIVE's own human-effort estimate for this requirement, as a range
 * rather than a false-precision single number. This is the Effort Model's
 * (Model C) sole output, and the baseline every other technology's
 * estimatedHours is scaled from (see scoring/technologyFitEngine.ts).
 * minHours/likelyHours/maxHours/confidence/rationale are kept as a stable,
 * backward-compatible top-level contract for every existing consumer
 * (Technology Fit, Commercial Model, Pricing, the UI) regardless of how they
 * were produced; `workBreakdown` is the new, optional bottom-up detail
 * (absent on an estimate produced before this change, or if a future effort
 * method other than bottom-up work-package aggregation is introduced).
 */
export interface EffortEstimate {
  minHours: number;
  likelyHours: number;
  maxHours: number;
  confidence: number;
  rationale: LocalizedText;
  /** Present only when this estimate came from bottom-up Work Package aggregation (effort-bottom-up-v1) - see scoring/effortEstimator.ts. */
  workBreakdown?: EffortWorkBreakdown;
}

// ---------------------------------------------------------------------------
// Commercial Model (D) inputs - see domain/commercial.ts for the calculation
// constants and scoring/commercialEngine.ts for how these combine with Base
// DU and the Effort Model into a suggested Commercial DU. The AI provides
// these as evidence-grounded assessments; it never states a Commercial DU
// number itself.
// ---------------------------------------------------------------------------

export type DirectCostType = "ONE_TIME_DEVELOPMENT" | "RECURRING_RUNTIME" | "BOTH";
export type DirectCostStatus = "ESTIMATED" | "UNKNOWN" | "ESTIMATE_REQUIRED";

/**
 * One category of direct cost (AI/API, infrastructure, third-party, other).
 * amount is null whenever status is not ESTIMATED - never invent a number
 * to fill the gap. ONE_TIME_DEVELOPMENT costs may feed the Commercial
 * Model; RECURRING_RUNTIME costs never do (they are the customer-facing
 * "laufende Kosten" disclosure instead - see ManagementReport.tsx).
 */
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

/** @deprecated Superseded by the ImplementationNovelty/ReusableInnovationIp split (commercial-du-v2) - a single innovation level conflated "how technically novel is this for us" with "does this create reusable IP", two questions with very different commercial implications. Kept only so a DuResult read from a commercial-du-v1 row still type-checks. */
export type InnovationLevel = "LOW" | "MEDIUM" | "HIGH";

/** @deprecated commercial-du-v1 only - see InnovationLevel. */
export interface InnovationAssessment {
  level: InnovationLevel;
  rationale: string;
  evidence: Evidence[];
  confidence: number;
}

/**
 * "How much technically new or not-yet-mastered ground must ISIFIVE cover
 * for THIS specific requirement?" (new architecture, experimental
 * technology, an unfamiliar integration, novel AI/agent logic, a required
 * proof of concept, ...). May influence Commercial DU (see
 * domain/commercial.ts IMPLEMENTATION_NOVELTY_*_BONUS_FRACTION); must never
 * retroactively change a Base DU dimension score.
 */
export type ImplementationNoveltyLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ImplementationNoveltyAssessment {
  level: ImplementationNoveltyLevel;
  rationale: string;
  evidence: Evidence[];
  confidence: number;
}

/**
 * "Does delivering this create new reusable technical substance ISIFIVE
 * can use again in other requirements/projects?" (a new Konturos building
 * block, a reusable agent, a generic connector/RAG component, a new
 * library, a reusable architecture piece, a generic test/evaluation
 * building block, ...). Captured and persisted for later calibration, but
 * deliberately produces NO automatic Commercial DU or price adjustment yet
 * - there is no validated commercial rule for pricing reusable IP, and
 * inventing one here would just be a new arbitrary formula.
 */
export type ReusableInnovationLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH";

export interface ReusableInnovationAssessment {
  level: ReusableInnovationLevel;
  rationale: string;
  evidence: Evidence[];
  confidence: number;
}

/** Impact analysis and scoring produced together in one AI call - see AIProvider.assessRequirement. */
export interface RequirementAssessment {
  impactAnalysis: ImpactAnalysis;
  dimensions: DimensionScores;
  overallAssessment: LocalizedText;
  /** Raw Work Packages - see scoring/effortEstimator.ts buildEffortEstimateFromWorkPackages for how this becomes the app's EffortEstimate. */
  effortWorkBreakdown: EffortWorkBreakdownOutput;
  technologyProfile: TechnologyProfile;
  existingAssetLeverage: ExistingAssetLeverage[];
  technologyNarratives: TechnologyNarrative[];
  directCosts: DirectCostEstimate;
  implementationNovelty: ImplementationNoveltyAssessment;
  reusableInnovationIp: ReusableInnovationAssessment;
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

export type CalibrationStatus = "INITIAL_HYPOTHESIS" | "EXPERT_CALIBRATED" | "EMPIRICALLY_CALIBRATED" | "DATA_DRIVEN";

/** One named adjustment CommercialEngine applied to Base DU - see scoring/commercialEngine.ts. Always present, even when its deltaDU is 0, so the UI can show "this factor was considered, no adjustment was warranted" rather than silently omitting it. */
export interface CommercialAdjustment {
  label: string;
  deltaDU: number;
  reason: string;
}

/** One Base DU class's provisional effort comparison point - see domain/commercial.ts BASE_DU_EFFORT_BENCHMARKS. NOT a Development Unit definition. */
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

/**
 * Compares the AI-native likely-hours estimate against this Base DU
 * class's effort benchmark. Exactly one of productivityGain/
 * positiveEffortOverrun is non-null (or both null when effort ≈ benchmark)
 * - never both at once. productivityGain is surfaced for transparency and
 * business analysis; it does NOT by itself reduce Commercial DU (see
 * domain/commercial.ts NEGATIVE_EFFORT_ADJUSTMENT_ENABLED).
 */
export interface EffortAnalysis {
  benchmark: EffortBenchmarkInfo;
  predictedLikelyHours: number;
  /** Signed: positive = effort above benchmark, negative = effort below benchmark (a productivity gain). */
  variance: EffortVariance;
  productivityGain: EffortVariance | null;
  positiveEffortOverrun: EffortVariance | null;
}

/**
 * REQUIRES_CLARIFICATION means effort confidence is too low to responsibly
 * present a confident Commercial DU offer - the answer to low confidence is
 * understanding the requirement better, not a blind risk markup (spec:
 * "keine Scheinsicherheit durch Risikoaufschlag"). suggestedCommercialDU is
 * still computed (for internal reference) even when this fires; the UI
 * must surface the status prominently rather than presenting the number as
 * a confident quote.
 */
export type CommercialEstimateStatus = "OK" | "REQUIRES_CLARIFICATION";

/**
 * Output of the Commercial Model (D) - see scoring/commercialEngine.ts.
 * suggestedCommercialDU is null whenever baseDU is null (XXL - no Base DU to
 * adjust from). Deliberately NOT a time conversion: hours are one signal
 * among several (direct costs, implementation novelty, risk), each
 * dampened and capped - never `hours / constant`. With the asymmetric
 * effort model, every adjustment here is >= 0, so Commercial DU is
 * structurally floored at Base DU before commercialDUBeforeGuardrail is
 * even computed - see the guardrail fields for the (currently
 * unreachable-in-practice) technical bound underneath that floor.
 */
export interface CommercialCalculation {
  baseDU: number | null;
  suggestedCommercialDU: number | null;
  commercialDUConfidence: number;
  /** suggestedCommercialDU × the configured price-per-DU, shown as a preview regardless of the currently active PricingStrategy (spec: "nur anzeigen, wenn konfiguriert/gewünscht" - the caller decides whether to surface it). */
  targetCommercialValue: number | null;
  rationale: string;
  adjustments: CommercialAdjustment[];
  calibrationStatus: CalibrationStatus;
  effortAnalysis: EffortAnalysis | null;
  /** Commercial DU after the mandatory Base-DU floor but before the technical guardrail clamp. */
  commercialDUBeforeGuardrail: number | null;
  /** Commercial DU after the technical guardrail clamp - equal to suggestedCommercialDU. */
  commercialDUAfterGuardrail: number | null;
  guardrailApplied: boolean;
  guardrailReason: string | null;
  estimateStatus: CommercialEstimateStatus;
}

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
  /** Per-factor breakdown of what drove this technology's fit - "why is n8n at 162%?" (spec: explainability). Signed: positive = reduces this technology's effort relative to a neutral requirement, negative = increases it. Sorted by absolute magnitude, largest first. */
  contributions: TechnologyFactorContribution[];
  /** Set when relativeEffortFactor falls outside [HIGH_VARIANCE_LOWER_THRESHOLD, HIGH_VARIANCE_UPPER_THRESHOLD] (domain/technology.ts) - a signal to double-check the drivers, NOT an error and NOT the same as the technical guardrail clamp. */
  varianceFlag: "HIGH_VARIANCE_COMPARISON" | null;
}

export interface TechnologyFactorContribution {
  factor: TechnologyProfileFactor;
  label: string;
  /** Signed contribution to this technology's raw effort score - see TechnologyAssessment.contributions. */
  contribution: number;
  direction: "increases" | "decreases";
}

export interface DuResult {
  weightedScore: number;
  duClass: DuClass;
  /**
   * Base DU - null for XXL, no artificially precise extrapolated count is
   * produced; decomposition into smaller, separately estimable requirements
   * is recommended instead (see determineScoringStatus). NOT the same as
   * the commercial unit offered to the customer - see
   * commercialDevelopmentUnits.
   */
  developmentUnits: number | null;
  price: number | null; // null when no price is computable under pricingStrategy (e.g. DU_FIXED_PRICE with commercialDevelopmentUnits null) or no price configured
  pricingStrategy: PricingStrategy;
  overallConfidence: number;
  confidenceLevel: "HIGH" | "MEDIUM" | "LOW";
  /** True only for XXL - developmentUnits is null and decomposition is recommended regardless of any other field here (see scoring/duEngine.ts determineScoringStatus). */
  isRoughEstimate: boolean;
  /** Absent (legacy-v1) for a DuResult computed before this change - see calculationModelVersion. */
  effortEstimate?: EffortEstimate;
  technologyComparison?: TechnologyAssessment[];
  directCosts?: DirectCostEstimate;
  /** @deprecated commercial-du-v1 only - see ImplementationNoveltyAssessment/ReusableInnovationAssessment. */
  innovation?: InnovationAssessment;
  /** Present only for calculationModelVersion "commercial-du-v2". */
  implementationNovelty?: ImplementationNoveltyAssessment;
  /** Present only for calculationModelVersion "commercial-du-v2". Display/persistence only - never feeds an automatic Commercial DU or price adjustment. */
  reusableInnovationIp?: ReusableInnovationAssessment;
  /** The Commercial Model's (D) output - see scoring/commercialEngine.ts. Present only for calculationModelVersion "commercial-du-v1"/"commercial-du-v2" (shape differs - see CommercialCalculation.effortAnalysis, which is v2-only). */
  commercialCalculation?: CommercialCalculation;
  /** Convenience mirror of commercialCalculation.suggestedCommercialDU, so callers that only need the number don't have to reach into the calculation object - see scoring/pricingEngine.ts, which uses exactly this field for DU_FIXED_PRICE. */
  commercialDevelopmentUnits?: number | null;
  /**
   * Absent means this DuResult was computed by the original pre-technology-fit
   * engine ("legacy-v1") - only timeEstimate/alternativeApproaches are
   * populated in that case. "technology-fit-v2" has effortEstimate/
   * technologyComparison but no Commercial Model fields. "commercial-du-v1"
   * added Base DU vs Commercial DU with a flat 6h/DU effort reference.
   * "commercial-du-v2" (current) replaces that flat reference with
   * per-class effort benchmarks, an asymmetric effort adjustment, the
   * implementationNovelty/reusableInnovationIp split, graduated risk tiers,
   * and full guardrail transparency.
   */
  calculationModelVersion?: "technology-fit-v2" | "commercial-du-v1" | "commercial-du-v2";
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

// ---------------------------------------------------------------------------
// Customer Report - a deliberately narrow, hand-picked projection of
// ScoringResult for the public, unauthenticated share link (GET
// /api/requirement/:id/customer-report, see api/customerReport.ts
// buildCustomerReport). NEVER derived by stripping fields from the full
// ScoringResult on the client - internal figures (Commercial DU
// adjustments, direct cost breakdowns, confidence internals, dimension
// scores/evidence, assumptions) must never leave the server for this route,
// since the link requires no login (security by an unguessable id is the
// only protection - see api/requirementRoutes.ts).
// ---------------------------------------------------------------------------

export interface CustomerReportTechnology {
  technology: TechnologyKey;
  label: string;
  relativeEffortFactor: number;
  advantages: string[];
  disadvantages: string[];
}

export interface CustomerReportRuntimeCost {
  label: string;
  /** EUR, or null when status is not ESTIMATED. */
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
  /** The commercially offered unit count - null only for XXL (decomposition recommended). */
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

/** Aggregate counts for the overview Dashboard - see api/repositoryRoutes.ts GET /stats. Global counts (not limited to a page size), unlike listSnapshots. */
export interface RepositoryStats {
  total: number;
  byStatus: Record<RepositoryStatus, number>;
  byMode: Record<RepositorySnapshotMode, number>;
}

/** Aggregate counts for the overview Dashboard - see api/requirementRoutes.ts GET /stats. Global counts (not limited to a page size), unlike listScoringResults. */
export interface ScoringStats {
  total: number;
  byStatus: Record<ScoringStatus, number>;
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
  /** In German - a short, specific title for this requirement, derived by the AI so the user never has to type one manually. See api/requirementContextService.ts runContextResolution, which applies this to Requirement.title on the first resolution round. */
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

/** Raw AIProvider.resolveRequirementContext output, before the app assigns ids and runs the clarification gate. */
export interface ContextResolutionOutput {
  normalization: RequirementNormalization;
  knownFacts: Omit<KnownFact, "id">[];
  assumptions: Omit<Assumption, "id" | "status">[];
  missingInformation: Omit<MissingInformation, "id">[];
}

export type RequirementContextStatus = "AWAITING_CLARIFICATION" | "RESOLVED" | "ERROR";

// ---------------------------------------------------------------------------
// Requirement Challenge & Optimization (requirement-challenge-v1)
//
// A fachliche preparation stage between Requirement Normalization and the
// five calculation models (A-E) - see scoring/requirementChallengeEngine.ts.
// It is NOT a sixth model and never touches DU/effort/price: it produces the
// approved input those models then consume unchanged. Core idea: a customer
// requirement often mixes a business goal with proposed (and possibly
// unnecessary) technical solutions - Requirement Challenge surfaces that
// distinction as reviewable proposals; the AI never applies a material
// change on its own, the user always decides (ACCEPT/REJECT/EDIT).
// ---------------------------------------------------------------------------

export type {
  ChallengeEvidenceSourceType,
  ChallengeImpactDirection,
  ChallengeMaintainabilityImpact,
  RequirementApprovalStatus,
  RequirementChallengeProposalStatus,
  RequirementChallengeType,
  SolutionSpecificityLevel,
} from "./requirementChallenge.js";
export {
  CHALLENGE_EVIDENCE_SOURCE_TYPES,
  CHALLENGE_IMPACT_DIRECTIONS,
  CHALLENGE_MAINTAINABILITY_IMPACTS,
  REQUIREMENT_APPROVAL_STATUSES,
  REQUIREMENT_CHALLENGE_PROPOSAL_STATUSES,
  REQUIREMENT_CHALLENGE_TYPES,
  REQUIREMENT_PREPARATION_VERSION,
  SOLUTION_SPECIFICITY_LEVELS,
} from "./requirementChallenge.js";

export interface ChallengeEvidence {
  sourceType: ChallengeEvidenceSourceType;
  /** A file path for REPOSITORY, an acceptance-criterion/constraint excerpt for the requirement-shaped sources, an assumption id for ASSUMPTION, etc. */
  reference: string;
  description: string;
  status: EvidenceStatus;
}

export interface RequirementChallengeExpectedImpact {
  scope: ChallengeImpactDirection;
  complexity: ChallengeImpactDirection;
  maintainability: ChallengeMaintainabilityImpact;
  reuse: ChallengeImpactDirection;
  implementationFreedom: ChallengeImpactDirection;
}

/** Raw shape the AI produces for one proposal - the app assigns id/status/timestamps (same pattern as KnownFact/Assumption/MissingInformation). */
export interface RequirementChallengeProposalInput {
  type: RequirementChallengeType;
  title: string;
  /** The exact (or closely paraphrased) source text this proposal is about - used both for display and, for ACCEPTANCE_IMPROVEMENT/SOLUTION_CONSTRAINT, to locate the matching acceptanceCriteria/constraints entry (see buildOptimizedRequirement). */
  originalText: string;
  issue: string;
  proposedChange: string;
  rationale: string;
  evidence: ChallengeEvidence[];
  expectedImpact: RequirementChallengeExpectedImpact;
  confidence: number;
}

/**
 * One reviewable Challenge proposal - PENDING until the user decides.
 * REJECTED proposals are kept (never deleted) so they are not silently
 * re-applied and so a repeated Challenge run can deduplicate against them
 * (see scoring/requirementChallengeEngine.ts dedupeChallengeProposals).
 */
export interface RequirementChallengeProposal extends RequirementChallengeProposalInput {
  id: string;
  status: RequirementChallengeProposalStatus;
  /** The user's own replacement text when status === "EDITED" - takes precedence over proposedChange wherever a decided proposal is applied. */
  editedChange: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface RequirementChallengeAnalysis {
  goal: string;
  problemStatement: string;
  solutionSpecificity: SolutionSpecificityLevel;
}

/**
 * Raw AIProvider.challengeRequirement output. Deliberately reuses the exact
 * Assumption/MissingInformation shapes from ContextResolutionOutput (not a
 * parallel structure) - Challenge can propose its own plausible assumptions
 * (spec section 22) and its own missing-information gaps (spec section 31's
 * "clarifications"/"remainingInformationGaps" are both just
 * CLARIFICATION_REQUIRED vs. UNKNOWN_NON_BLOCKING classifications of the
 * same MissingInformation shape) - both get merged into the SAME
 * RequirementContext.assumptions/missingInformation/clarifications arrays
 * the normalization phase already populates, through the same
 * clarification gate. Never states a DU, price, effort, or technology-fit
 * number.
 */
export interface RequirementChallengeOutput {
  analysis: RequirementChallengeAnalysis;
  proposals: RequirementChallengeProposalInput[];
  assumptions: Omit<Assumption, "id" | "status">[];
  missingInformation: Omit<MissingInformation, "id">[];
}

/**
 * DRAFT: normalized, Challenge not yet run or still pending decisions.
 * CHALLENGE_IN_PROGRESS: Challenge has run and at least one proposal is
 * still PENDING, or a Challenge-raised clarification is still open.
 * READY_FOR_APPROVAL: every proposal is decided, no blocking clarification
 * remains, and the draft has a goal + at least one acceptance criterion.
 * APPROVED: the user explicitly froze the current draft into
 * approvedRequirement (spec: "die vereinbarte Grundlage für die aktuelle
 * Bewertung" - NOT a customer sign-off or contractual approval). Editing
 * the draft again after APPROVED moves this back to READY_FOR_APPROVAL
 * (see api/requirementContextRoutes.ts) - approvedRequirement itself stays
 * untouched until a fresh /approve call, so an already-created
 * ScoringResult (which took its own immutable copy at score time) is never
 * affected either way.
 */

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
  /** The CURRENT working draft - normalized on the first round, then re-derived from normalizedRequirement + decided challenge proposals every time a proposal is accepted/rejected/edited (see buildOptimizedRequirement), and still directly editable via PATCH .../requirement for final touch-ups. This is what a Kunde-facing report/history entry ultimately reflects once approved. */
  requirement: Requirement;
  /** Immutable - exactly what was submitted, before any AI normalization or Challenge decision. Never overwritten (spec: "Original Requirement ist unveränderliche Quelle"). */
  originalRequirement: Requirement;
  /** Immutable snapshot taken right after the first successful AI normalization, before any Challenge proposal is applied - the base buildOptimizedRequirement always starts from. Null only for a context still on its very first (unresolved) round, or a legacy context that predates this field. */
  normalizedRequirement: Requirement | null;
  /** Frozen copy of `requirement` at the moment of the last successful /approve call. Null until first approved. This, never the mutable `requirement`, is what scoring reads (with a `requirement` fallback for legacy contexts - see api/requirementRoutes.ts). */
  approvedRequirement: Requirement | null;
  approvalStatus: RequirementApprovalStatus;
  /** From the most recent Challenge run - null before Challenge has ever run. */
  challengeAnalysis: RequirementChallengeAnalysis | null;
  challengeProposals: RequirementChallengeProposal[];
  /** Null for a context created before this feature - see the migration in db/migrate.ts. `"requirement-challenge-v1"` for every new context, independent of calculationModelVersion (Requirement Challenge is a preparation stage, not a Commercial-Model version). */
  requirementPreparationVersion: string | null;
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
/**
 * A denormalized copy of the key predicted figures from the ScoringResult
 * at the moment an actual outcome is recorded - not a live reference. A
 * ScoringResult can later be re-scored (its du_result JSONB overwritten),
 * which would otherwise silently corrupt the historical prediction-vs-actual
 * pairing this record exists to preserve (spec: "Prediction Snapshot
 * Immutable"). Absolute/percentage error, bias, and corridor hit/miss can
 * later be computed from predicted* vs. actual* - no such computation is
 * implemented yet, this is data collection only.
 */
export interface EffortPredictionSnapshot {
  calculationModelVersion: string | null;
  predictedBaseDU: number | null;
  predictedCommercialDU: number | null;
  predictedEffortMinHours: number;
  predictedEffortLikelyHours: number;
  predictedEffortMaxHours: number;
  predictedEffortConfidence: number | null;
  /** Frozen copy of EffortEstimate.workBreakdown at prediction time - null for a legacy-v1/technology-fit-v2/commercial-du-v1/v2-pre-bottom-up estimate, or any future non-bottom-up effort method. Answers "why were N hours predicted back then?" long after a later re-score could otherwise overwrite it. */
  effortWorkBreakdown: EffortWorkBreakdown | null;
  /** Which Base-DU-class effort benchmark this was compared against, and how it was calibrated at prediction time - see domain/commercial.ts BASE_DU_EFFORT_BENCHMARKS. */
  effortBenchmark: EffortBenchmarkInfo | null;
  /** The effort-specific line item from commercialCalculation.adjustments, frozen at prediction time. */
  effortAdjustment: CommercialAdjustment | null;
  predictedTechnologyComparison: TechnologyAssessment[];
  directCostsPredicted: DirectCostEstimate | null;
  /** @deprecated commercial-du-v1 snapshots only - see implementationNovelty/reusableInnovationIp. */
  innovationLevel: InnovationLevel | null;
  implementationNovelty: ImplementationNoveltyAssessment | null;
  reusableInnovationIp: ReusableInnovationAssessment | null;
  /** The risk-reserve line item from commercialCalculation.adjustments, frozen at prediction time. */
  commercialRiskReserve: CommercialAdjustment | null;
  commercialDUBeforeGuardrail: number | null;
  commercialDUAfterGuardrail: number | null;
  guardrailApplied: boolean | null;
  pricingStrategy: PricingStrategy;
  offeredPrice: number | null;
}

export interface ActualEffortRecord {
  id: string;
  scoringId: string;
  actualHumanHours: number;
  /** Which production method was actually used to deliver this. */
  actualImplementationMethod: TechnologyKey;
  /** Immutable copy of what was predicted at the time this actual was recorded - see EffortPredictionSnapshot. Null for records created before this field existed. */
  predictionSnapshot: EffortPredictionSnapshot | null;
  directCostsActual: DirectCostEstimate | null;
  reworkHours: number | null;
  bugfixHours: number | null;
  acceptanceIterations: number | null;
  scopeChanged: boolean | null;
  /** Free-text note on rework/bugfix/acceptance-iteration effort not captured by the structured fields above, if any. */
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
