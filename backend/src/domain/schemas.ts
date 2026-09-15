// Zod schemas describing exactly what the AIProvider is allowed to return.
// These are passed to Anthropic's structured-output parsing (see
// ai/AnthropicProvider.ts) so a malformed or incomplete AI response fails
// validation instead of silently producing fabricated data.

import { z } from "zod";

export const LocalizedTextSchema = z.object({
  en: z.string().describe("English version of this text."),
  de: z.string().describe("German (Deutsch) version of this text - not a literal machine translation, written naturally."),
});

export const EvidenceSchema = z.object({
  file: z
    .string()
    .describe("Repository-relative file path that supports this claim."),
  reason: z
    .string()
    .describe("Why this file is evidence for the claim."),
});

export const EvidenceStatusSchema = z.enum(["VERIFIED", "INFERRED", "UNKNOWN"]);

export const RepositoryFindingSchema = z.object({
  finding: z.string(),
  status: EvidenceStatusSchema,
  evidence: z.array(EvidenceSchema),
});

export const RepositoryProfileSchema = z.object({
  summary: z
    .string()
    .describe("2-4 sentence factual summary of what the repository contains."),
  languages: z.array(z.string()),
  frameworks: z.array(z.string()),
  services: z.array(z.string()),
  dataModels: z.array(z.string()),
  integrations: z.array(z.string()),
  aiComponents: z.array(z.string()),
  tests: z.array(z.string()),
  deployment: z.array(z.string()),
  findings: z.array(RepositoryFindingSchema),
});

export const ImpactAnalysisSchema = z.object({
  existing: z.array(z.string()),
  reusable: z.array(z.string()),
  modify: z.array(z.string()),
  create: z.array(z.string()),
  dataChanges: z.array(z.string()),
  integrations: z.array(z.string()),
  tests: z.array(z.string()),
  risks: z.array(z.string()),
  openQuestions: z.array(z.string()),
});

const DimensionScoreSchema = z.object({
  score: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  summary: LocalizedTextSchema.describe(
    "One compact sentence per language summarizing this dimension's score - the quick-read view.",
  ),
  rationale: LocalizedTextSchema.describe(
    "The detailed reasoning per language behind the score - the full evaluation.",
  ),
  evidence: z.array(EvidenceSchema),
  confidence: z.number().min(0).max(1),
  missingInformation: z.array(z.string()),
  factsUsed: z.array(z.string()).describe("Short descriptions of the known facts this score relied on."),
  assumptionsUsed: z
    .array(z.string())
    .describe("The exact assumption id(s) (as given in the ASSUMPTIONS list) this score relied on, if any."),
  unresolvedRisks: z.array(z.string()).describe("Risks that remain even after applying facts and assumptions."),
});

/**
 * The AI must score all eight dimensions in one structured response, keyed
 * by name. This guarantees exactly one score per dimension - no missing or
 * duplicated dimensions - without relying on the model to enumerate a list
 * correctly.
 */
export const DimensionScoresSchema = z.object({
  functionalScope: DimensionScoreSchema,
  technicalComplexity: DimensionScoreSchema,
  dataIntegration: DimensionScoreSchema,
  aiComplexity: DimensionScoreSchema,
  automation: DimensionScoreSchema,
  testingQA: DimensionScoreSchema,
  deploymentOperations: DimensionScoreSchema,
  uncertaintyRisk: DimensionScoreSchema,
});

/**
 * Full output of the scoring call: the eight dimensions plus one narrative
 * that synthesizes them into an overall complexity/scope read. The AI still
 * never states a DU number here - only descriptive text.
 */
export const ScoringOutputSchema = z.object({
  dimensions: DimensionScoresSchema,
  overallAssessment: LocalizedTextSchema.describe(
    "2-4 sentences per language characterizing the overall scope, complexity, and risk across all eight dimensions together.",
  ),
});

/**
 * Impact analysis and scoring merged into one structured response instead of
 * two sequential AI calls - both need the same repository context and
 * requirement, and scoring already consumed the impact analysis as input,
 * so there was no dependency that actually required a second round-trip.
 */
export const RequirementAssessmentSchema = z.object({
  impactAnalysis: ImpactAnalysisSchema,
  dimensions: DimensionScoresSchema,
  overallAssessment: LocalizedTextSchema.describe(
    "2-4 sentences per language characterizing the overall scope, complexity, and risk across all eight dimensions together.",
  ),
});

// ---------------------------------------------------------------------------
// Assumption & Clarification Engine schemas
// ---------------------------------------------------------------------------

const DimensionKeySchema = z.enum([
  "functionalScope",
  "technicalComplexity",
  "dataIntegration",
  "aiComplexity",
  "automation",
  "testingQA",
  "deploymentOperations",
  "uncertaintyRisk",
]);

const ScoreImpactSchema = z
  .union([z.literal(0), z.literal(1), z.literal(2)])
  .describe(
    "0 = practically no influence on scoring. 1 = could move roughly one dimension by about one score point. " +
      "2 = could move several dimensions, or change the resulting DU class.",
  );

export const KnownFactSchema = z.object({
  topic: z.string(),
  fact: z.string().describe("The fact itself, stated plainly - never invented, always traceable to a source."),
  source: z.enum(["REQUIREMENT", "ACCEPTANCE_CRITERIA", "CLARIFICATION_ANSWER", "REPOSITORY", "DERIVED"]),
  evidence: z
    .array(EvidenceSchema)
    .describe("Repository evidence for this fact, if source is REPOSITORY or DERIVED from it. Empty otherwise."),
});

export const AssumptionOutputSchema = z.object({
  topic: z.string(),
  assumption: z.string().describe("The plausible stand-in used for scoring - must never be phrased as a fact."),
  reason: z.string().describe("Why this assumption is plausible given the requirement and repository."),
  basis: z
    .array(z.string())
    .describe('Free-text citations, e.g. "Requirement", "Acceptance Criteria", or a repository file path.'),
  confidence: z.number().min(0).max(1),
  affectedDimensions: z.array(DimensionKeySchema),
  potentialScoreImpact: ScoreImpactSchema,
  criticality: z.enum(["LOW", "MEDIUM", "HIGH"]),
});

export const MissingInformationOutputSchema = z.object({
  topic: z.string(),
  question: z.string().describe("The underlying question this gap represents, even if it is never asked to the user."),
  classification: z.enum(["FACT", "DERIVED", "ASSUMPTION", "CLARIFICATION_REQUIRED", "UNKNOWN_NON_BLOCKING"]),
  potentialScoreImpact: ScoreImpactSchema,
  affectedDimensions: z.array(DimensionKeySchema),
  reasoning: z
    .string()
    .describe("Why this classification was chosen - which source hierarchy step resolved it, or why none could."),
});

export const RequirementNormalizationSchema = z.object({
  objective: z.string(),
  businessGoal: z.string(),
  functionalRequirements: z.array(z.string()),
  nonFunctionalRequirements: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  technicalConstraints: z.array(z.string()),
  mentionedSystems: z.array(z.string()),
  mentionedDataSources: z.array(z.string()),
  mentionedIntegrations: z.array(z.string()),
  mentionedExistingComponents: z.array(z.string()),
  assumptionsAlreadyContainedInRequirement: z.array(z.string()),
  unresolvedInformation: z.array(z.string()),
});

/**
 * Output of AIProvider.resolveRequirementContext - normalization, known
 * facts, assumptions, and every detected information gap with its
 * classification. The app (not the AI) turns CLARIFICATION_REQUIRED items
 * into an actual prioritized, capped clarification dialog - see
 * scoring/clarificationGate.ts.
 */
export const ContextResolutionOutputSchema = z.object({
  normalization: RequirementNormalizationSchema,
  knownFacts: z.array(KnownFactSchema),
  assumptions: z.array(AssumptionOutputSchema),
  missingInformation: z.array(MissingInformationOutputSchema),
});
