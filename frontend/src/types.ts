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
  requirement: Requirement;
  status: ScoringStatus;
  impactAnalysis: ImpactAnalysis | null;
  dimensionScores: DimensionScores | null;
  confidence: ConfidenceAssessment | null;
  duResult: DuResult | null;
  overallAssessment: LocalizedText | null;
  openQuestions: string[];
  errorMessage: string | null;
  scoredAt: string | null;
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
