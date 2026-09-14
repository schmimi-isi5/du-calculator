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
  | "DECOMPOSITION_REQUIRED"
  | "ERROR";

export type EvidenceStatus = "VERIFIED" | "INFERRED" | "UNKNOWN";

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
  rationale: string;
  evidence: Evidence[];
  confidence: number; // 0.0 - 1.0
  missingInformation: string[];
}

export type DimensionScores = Record<DimensionKey, DimensionScore>;

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
  requirement: Requirement;
  status: ScoringStatus;
  impactAnalysis: ImpactAnalysis | null;
  dimensionScores: DimensionScores | null;
  /** Always populated once scoring finishes, even when duResult is withheld for low confidence. */
  confidence: ConfidenceAssessment | null;
  /** The final DU estimate. Null while not yet scored, on error, and withheld when confidence is LOW. */
  duResult: DuResult | null;
  openQuestions: string[];
  errorMessage: string | null;
  scoredAt: string | null;
}
