// Interim AIProvider implementation backed by the Anthropic API, ahead of
// the planned KonturosProvider. Uses structured outputs (beta messages.parse
// + Zod) so a malformed response fails validation instead of silently
// producing fabricated data.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  ContextResolutionOutputSchema,
  RepositoryProfileSchema,
  RequirementAssessmentSchema,
} from "../domain/schemas.js";
import type {
  Clarification,
  ContextResolutionOutput,
  QualityLevel,
  Requirement,
  RepositoryContext,
  RepositoryProfile,
  RequirementAssessment,
} from "../domain/types.js";
import { QUALITY_PROFILES, type EffortLevel } from "../domain/qualityLevels.js";
import type { AIProvider, RepositoryIdentity, ResolvedRequirementKnowledge, UsageContext } from "./AIProvider.js";
import { AIProviderError } from "./AIProvider.js";
import {
  buildAssessmentPrompt,
  buildContextResolutionPrompt,
  buildRepositoryAnalysisPrompt,
  type PromptParts,
} from "./prompts.js";
import { recordUsage } from "./usageTracker.js";

const DEFAULT_MODEL = "claude-opus-5";
const MAX_TOKENS = 16000;

// Repository analysis has no per-run QualityLevel to read (the file excerpts
// it works from are fixed at analysis time, before any requirement exists) -
// classification/extraction-shaped work, where Anthropic's own measured
// effort curves are close to flat, so a fixed "medium" holds accuracy at
// meaningfully lower latency and cost regardless of what a later requirement
// chooses. resolveRequirementContext/assessRequirement use the run's chosen
// QualityLevel instead (see domain/qualityLevels.ts).
const REPOSITORY_ANALYSIS_EFFORT: EffortLevel = "medium";

// Every call re-sends the repository profile + file excerpts (often tens of
// thousands of tokens) unchanged across a clarification round's repeated
// calls, and across a re-score of the same requirement - see prompts.ts
// PromptParts. A 1-hour TTL survives the human-in-the-loop gaps between
// those calls (answering a question, reviewing facts); the default 5-minute
// TTL would miss almost every one of them.
const CACHE_TTL = "1h" as const;

export class AnthropicProvider implements AIProvider {
  private readonly client: Anthropic;
  private readonly defaultModel: string;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    this.client = new Anthropic({ apiKey });
    this.defaultModel = model;
  }

  async analyzeRepository(
    repository: RepositoryIdentity,
    context: RepositoryContext,
    usage: UsageContext,
  ): Promise<RepositoryProfile> {
    const prompt = buildRepositoryAnalysisPrompt(repository, context);
    return this.parse<RepositoryProfile>(
      prompt,
      RepositoryProfileSchema,
      "analyzeRepository",
      this.defaultModel,
      REPOSITORY_ANALYSIS_EFFORT,
      usage,
    );
  }

  async resolveRequirementContext(
    requirement: Requirement,
    profile: RepositoryProfile,
    context: RepositoryContext,
    answeredClarifications: Clarification[],
    qualityLevel: QualityLevel,
    model: string,
    usage: UsageContext,
  ): Promise<ContextResolutionOutput> {
    const prompt = buildContextResolutionPrompt(requirement, profile, context, answeredClarifications, qualityLevel);
    return this.parse<ContextResolutionOutput>(
      prompt,
      ContextResolutionOutputSchema,
      "resolveRequirementContext",
      model,
      QUALITY_PROFILES[qualityLevel].resolutionEffort,
      usage,
    );
  }

  async assessRequirement(
    requirement: Requirement,
    profile: RepositoryProfile,
    context: RepositoryContext,
    knowledge: ResolvedRequirementKnowledge,
    qualityLevel: QualityLevel,
    model: string,
    usage: UsageContext,
  ): Promise<RequirementAssessment> {
    const prompt = buildAssessmentPrompt(requirement, profile, context, knowledge, qualityLevel);
    return this.parse<RequirementAssessment>(
      prompt,
      RequirementAssessmentSchema,
      "assessRequirement",
      model,
      QUALITY_PROFILES[qualityLevel].assessmentEffort,
      usage,
    );
  }

  private async parse<T>(
    prompt: PromptParts,
    schema: Parameters<typeof betaZodOutputFormat>[0],
    step: string,
    model: string,
    effort: EffortLevel,
    usage: UsageContext,
  ): Promise<T> {
    try {
      // `thinking.type: "adaptive"`, `output_config.effort`, and the
      // content-block `cache_control` breakpoints below are live Claude
      // Opus 5 API features that the installed @anthropic-ai/sdk version's
      // TypeScript definitions for `beta.messages.parse` don't fully model
      // yet (verified directly against the API - the SDK's own
      // `enabled`/`budget_tokens` shape is rejected by the server for this
      // model). The `as never` cast is a narrow, documented escape hatch for
      // this known type/API drift, not a general bypass - remove it once
      // the SDK ships matching types.
      const response = await this.client.beta.messages.parse({
        model,
        max_tokens: MAX_TOKENS,
        thinking: { type: "adaptive" },
        output_config: { effort },
        output_format: betaZodOutputFormat(schema),
        system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral", ttl: CACHE_TTL } }],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt.stableContext, cache_control: { type: "ephemeral", ttl: CACHE_TTL } },
              { type: "text", text: prompt.volatile },
            ],
          },
        ],
      } as never);

      if (response.usage) {
        await recordUsage(
          "anthropic",
          response.model ?? model,
          step,
          {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            cacheWrite5mTokens: response.usage.cache_creation?.ephemeral_5m_input_tokens ?? 0,
            cacheWrite1hTokens: response.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
            cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          },
          usage,
        );
      }

      if (response.stop_reason === "refusal") {
        throw new AIProviderError(`AI provider refused the ${step} request for safety reasons.`);
      }

      if (!response.parsed_output) {
        throw new AIProviderError(
          `AI provider response for ${step} could not be parsed into the expected structure.`,
        );
      }

      return response.parsed_output as T;
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      if (err instanceof Anthropic.AuthenticationError) {
        throw new AIProviderError(
          "AI provider authentication failed. Check that ANTHROPIC_API_KEY is set correctly.",
          err,
        );
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new AIProviderError("AI provider rate limit exceeded. Try again shortly.", err);
      }
      if (err instanceof Anthropic.APIError) {
        throw new AIProviderError(`AI provider request for ${step} failed: ${err.message}`, err);
      }
      throw new AIProviderError(`AI provider request for ${step} failed unexpectedly.`, err);
    }
  }
}
