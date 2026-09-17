// Zod schemas describing exactly what the AIProvider is allowed to return.
// These are passed to Anthropic's structured-output parsing (see
// ai/AnthropicProvider.ts) so a malformed or incomplete AI response fails
// validation instead of silently producing fabricated data.

import { z } from "zod";
import { TECHNOLOGY_IDS, TECHNOLOGY_PROFILE_FACTORS } from "./technology.js";

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

export const SuggestedSubRequirementSchema = z.object({
  title: z.string().describe("Short, customer-facing title for this candidate sub-requirement."),
  description: z
    .string()
    .describe("One-sentence description of this piece's scope, in plain business language - not internal jargon."),
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
  suggestedDecomposition: z
    .array(SuggestedSubRequirementSchema)
    .describe(
      "2-6 candidate sub-requirements only if this requirement's scope genuinely spans multiple substantial, separable pieces of work - empty array otherwise (the common case). See the decomposition rule in the system prompt for exactly when this applies.",
    ),
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
 * @deprecated Superseded by EffortEstimateSchema (a min/likely/max corridor
 * instead of a single number). No longer referenced by
 * RequirementAssessmentSchema - kept only as documentation of the shape a
 * pre-technology-fit-v2 stored assessment used to have.
 */
export const ImplementationEstimateSchema = z.object({
  estimatedHours: z.number().min(0),
  rationale: LocalizedTextSchema,
});

// ---------------------------------------------------------------------------
// Technology Fit Model (Model B) + Effort Model (Model C) schemas.
// See domain/technology.ts for the factor list and CapabilityProfile
// hypotheses, and ai/prompts.ts for the rules that ground these in the
// actual requirement/repository rather than a generic guess.
// ---------------------------------------------------------------------------

export const TechnologyIdSchema = z.enum(TECHNOLOGY_IDS);

const TechnologyProfileFactorSchema = z.object({
  score: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).describe(
    "0 = practically not relevant to this requirement, 5 = very strongly characterizes it.",
  ),
  rationale: z.string().describe("Why this factor scores this way for THIS requirement, in German."),
  evidence: z.array(EvidenceSchema),
  confidence: z.number().min(0).max(1),
});

/**
 * One score per requirement-characteristic factor (domain/technology.ts
 * TECHNOLOGY_PROFILE_FACTORS) - describes the requirement's technical
 * shape, independent of any technology's suitability for it. The
 * deterministic Technology Fit Engine (scoring/technologyFitEngine.ts)
 * combines this with each technology's CapabilityProfile; the AI never
 * computes or states a fit percentage or relative effort itself.
 */
export const TechnologyProfileSchema = z.object(
  Object.fromEntries(TECHNOLOGY_PROFILE_FACTORS.map((factor) => [factor, TechnologyProfileFactorSchema])) as Record<
    (typeof TECHNOLOGY_PROFILE_FACTORS)[number],
    typeof TechnologyProfileFactorSchema
  >,
);

/**
 * How much a given production method can lean on what already exists in
 * this repository - grounded ONLY in actual repository evidence (services,
 * APIs, data models, auth, UI components, tests, CI/CD, workflows,
 * prompts/agents, reusable libraries, ...). Use null (UNKNOWN) rather than
 * 0 when the repository simply gives no evidence either way for this
 * technology - do not invent evidence, and do not treat "no evidence
 * found" as "confirmed zero reuse".
 */
export const ExistingAssetLeverageSchema = z.object({
  technology: TechnologyIdSchema,
  assetLeverage: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .describe("0.0-1.0, or null (UNKNOWN) when the repository gives no evidence either way for this technology."),
  rationale: z.string().describe("In German - grounded in the cited evidence, or explaining why this is UNKNOWN."),
  evidence: z.array(EvidenceSchema),
  confidence: z.number().min(0).max(1),
});

/**
 * Qualitative read on one technology for this specific requirement -
 * narrative only. The actual relativeEffortFactor number is always computed
 * deterministically by the app (scoring/technologyFitEngine.ts) from
 * TechnologyProfile + the technology's CapabilityProfile - never asked of
 * the AI directly, so it stays reproducible and auditable.
 */
export const TechnologyNarrativeSchema = z.object({
  technology: TechnologyIdSchema,
  advantages: z
    .array(z.string())
    .describe("In German. 1-4 concrete advantages of this technology for THIS specific requirement."),
  disadvantages: z
    .array(z.string())
    .describe("In German. 1-4 concrete disadvantages of this technology for THIS specific requirement."),
});

/**
 * AI_NATIVE's own human-effort estimate for this requirement, as a range
 * instead of a falsely precise single number. Counts ONLY human time:
 * analysis, briefing/steering coding agents, review, corrections, manual/
 * individual development work, testing/QA, deployment/integration - never
 * "the AI works for N hours". This is the sole basis every other
 * technology's estimatedHours is scaled from (scoring/technologyFitEngine.ts) -
 * deliberately NOT derived from the DU dimension scores or any DU/hours
 * formula.
 */
export const EffortEstimateSchema = z.object({
  minHours: z.number().min(0).describe("Optimistic but plausible human-hours bound - not a floor with no basis."),
  likelyHours: z.number().min(0).describe("Your single best-guess human-hours estimate."),
  maxHours: z.number().min(0).describe("Pessimistic but plausible human-hours bound, not a worst-case scare number."),
  confidence: z.number().min(0).max(1),
  rationale: LocalizedTextSchema.describe(
    "2-4 sentences per language explaining what drives the corridor width and the likely figure specifically - setup, integration points, testing, edge cases, unfamiliar vs. well-trodden parts of the codebase, comparable real-world work you're aware of. Must not just restate a dimension rationale - this is an independent estimation.",
  ),
});

// ---------------------------------------------------------------------------
// Commercial Model (D) input schemas - see domain/commercial.ts for the
// calculation constants and scoring/commercialEngine.ts for how these
// combine with Base DU and the Effort Model. The AI provides these as
// evidence-grounded assessments; it never states a Commercial DU or price.
// ---------------------------------------------------------------------------

const DirectCostItemSchema = z.object({
  amountEur: z
    .number()
    .min(0)
    .nullable()
    .describe("EUR, or null when status is not ESTIMATED - never invent a number to fill the gap."),
  costType: z
    .enum(["ONE_TIME_DEVELOPMENT", "RECURRING_RUNTIME", "BOTH"])
    .describe(
      "ONE_TIME_DEVELOPMENT: incurred only while building this (e.g. dev-time LLM token spend). RECURRING_RUNTIME: incurred every time the delivered feature runs in production (e.g. a production agent's ongoing token/API usage). BOTH if genuinely both apply.",
    ),
  status: z
    .enum(["ESTIMATED", "UNKNOWN", "ESTIMATE_REQUIRED"])
    .describe("UNKNOWN/ESTIMATE_REQUIRED when you cannot ground a number in the requirement/repository - do not guess."),
  rationale: z.string().describe("In German - what this cost covers and how you arrived at it, or why it's not estimable yet."),
});

/**
 * Structured direct costs beyond human effort - AI/API usage, infrastructure,
 * third-party services/licenses. Never mixed into a DU complexity score;
 * these feed the Commercial Model (D) and the customer-facing "laufende
 * Kosten" disclosure only.
 */
export const DirectCostEstimateSchema = z.object({
  aiApiCost: DirectCostItemSchema.describe("LLM tokens, embeddings, OCR, or other external AI API usage."),
  infrastructureCost: DirectCostItemSchema.describe("Compute, storage, vector DB, or other additional infrastructure."),
  thirdPartyCost: DirectCostItemSchema.describe("Third-party APIs, licenses, or external services."),
  otherDirectCost: DirectCostItemSchema.describe("Any other direct cost not covered by the categories above."),
});

/**
 * Whether this requirement genuinely requires new technical solutions,
 * experimentation, or produces reusable new ISIFIVE IP - NOT a proxy for
 * "uses AI = expensive". See ai/prompts.ts INNOVATION_RULE.
 */
export const InnovationAssessmentSchema = z.object({
  level: z.enum(["LOW", "MEDIUM", "HIGH"]),
  rationale: z.string().describe("In German - grounded in what specifically is or isn't novel here."),
  evidence: z.array(EvidenceSchema),
  confidence: z.number().min(0).max(1),
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
  effortEstimate: EffortEstimateSchema,
  technologyProfile: TechnologyProfileSchema,
  existingAssetLeverage: z
    .array(ExistingAssetLeverageSchema)
    .describe("Exactly one entry per technology in TECHNOLOGY_IDS (AI_NATIVE, CLASSIC, N8N, INTREXX)."),
  technologyNarratives: z
    .array(TechnologyNarrativeSchema)
    .describe("Exactly one entry per technology in TECHNOLOGY_IDS (AI_NATIVE, CLASSIC, N8N, INTREXX)."),
  directCosts: DirectCostEstimateSchema,
  innovation: InnovationAssessmentSchema,
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
