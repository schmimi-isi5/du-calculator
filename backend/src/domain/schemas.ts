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
