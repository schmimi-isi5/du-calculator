// Interim AIProvider implementation backed by the Anthropic API, ahead of
// the planned KonturosProvider. Uses structured outputs (beta messages.parse
// + Zod) so a malformed response fails validation instead of silently
// producing fabricated data.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  ContextResolutionOutputSchema,
  ImpactAnalysisSchema,
  RepositoryProfileSchema,
  ScoringOutputSchema,
} from "../domain/schemas.js";
import type {
  Clarification,
  ContextResolutionOutput,
  ImpactAnalysis,
  Requirement,
  RepositoryContext,
  RepositoryProfile,
  ScoringOutput,
} from "../domain/types.js";
import type { AIProvider, RepositoryIdentity, ResolvedRequirementKnowledge } from "./AIProvider.js";
import { AIProviderError } from "./AIProvider.js";
import {
  buildContextResolutionPrompt,
  buildImpactAnalysisPrompt,
  buildRepositoryAnalysisPrompt,
  buildScoringPrompt,
} from "./prompts.js";

const MODEL = "claude-opus-5";
const MAX_TOKENS = 16000;

export class AnthropicProvider implements AIProvider {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async analyzeRepository(
    repository: RepositoryIdentity,
    context: RepositoryContext,
  ): Promise<RepositoryProfile> {
    const { system, user } = buildRepositoryAnalysisPrompt(repository, context);
    return this.parse<RepositoryProfile>(system, user, RepositoryProfileSchema, "analyzeRepository");
  }

  async resolveRequirementContext(
    requirement: Requirement,
    profile: RepositoryProfile,
    context: RepositoryContext,
    answeredClarifications: Clarification[],
  ): Promise<ContextResolutionOutput> {
    const { system, user } = buildContextResolutionPrompt(requirement, profile, context, answeredClarifications);
    return this.parse<ContextResolutionOutput>(
      system,
      user,
      ContextResolutionOutputSchema,
      "resolveRequirementContext",
    );
  }

  async analyzeRequirement(
    requirement: Requirement,
    profile: RepositoryProfile,
    context: RepositoryContext,
    knowledge: ResolvedRequirementKnowledge,
  ): Promise<ImpactAnalysis> {
    const { system, user } = buildImpactAnalysisPrompt(requirement, profile, context, knowledge);
    return this.parse<ImpactAnalysis>(system, user, ImpactAnalysisSchema, "analyzeRequirement");
  }

  async scoreRequirement(
    requirement: Requirement,
    profile: RepositoryProfile,
    impact: ImpactAnalysis,
    context: RepositoryContext,
    knowledge: ResolvedRequirementKnowledge,
  ): Promise<ScoringOutput> {
    const { system, user } = buildScoringPrompt(requirement, profile, impact, context, knowledge);
    return this.parse<ScoringOutput>(system, user, ScoringOutputSchema, "scoreRequirement");
  }

  private async parse<T>(
    system: string,
    user: string,
    schema: Parameters<typeof betaZodOutputFormat>[0],
    step: string,
  ): Promise<T> {
    try {
      // `thinking.type: "adaptive"` and `output_config.effort` are live
      // Claude Opus 5 API features that the installed @anthropic-ai/sdk
      // version's TypeScript definitions don't model yet (verified directly
      // against the API - the SDK's own `enabled`/`budget_tokens` shape is
      // rejected by the server for this model). The `as never` cast is a
      // narrow, documented escape hatch for this known type/API drift, not
      // a general bypass - remove it once the SDK ships matching types.
      const response = await this.client.beta.messages.parse({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        output_format: betaZodOutputFormat(schema),
        system,
        messages: [{ role: "user", content: user }],
      } as never);

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
