// AIProvider implementation for any OpenAI-compatible chat completions
// endpoint: real OpenAI, OpenRouter (gateway to hundreds of models,
// including DeepSeek), or a self-hosted/local server that exposes the same
// API shape (Ollama, LM Studio, vLLM, ...) - selected by `baseURL`.
//
// NOT live-verified against a real endpoint as of this writing (no
// OpenAI/OpenRouter/local credentials were available in the environment
// this was built in) - it is implemented against the installed `openai`
// SDK's actual types and this module typechecks and the domain schemas
// round-trip through it correctly, but treat the very first real call
// against each provider as a smoke test, not an assumption.

import OpenAI from "openai";
import type { ZodType } from "zod";
import {
  ContextResolutionOutputSchema,
  ImpactAnalysisSchema,
  RepositoryProfileSchema,
  ScoringOutputSchema,
} from "../domain/schemas.js";
import type {
  AIProviderName,
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
  type PromptParts,
} from "./prompts.js";
import { toOpenAIStrictJsonSchema } from "./openAIStrictSchema.js";
import { recordUsage } from "./usageTracker.js";

export interface OpenAICompatibleProviderOptions {
  /** Which AIProviderName this instance reports to the usage log - "openai" | "openrouter" | "local". */
  providerName: Extract<AIProviderName, "openai" | "openrouter" | "local">;
  apiKey: string;
  /** Omit to use the real OpenAI API; set for OpenRouter or a local server. */
  baseURL?: string;
  model: string;
}

export class OpenAICompatibleProvider implements AIProvider {
  private readonly client: OpenAI;
  private readonly providerName: OpenAICompatibleProviderOptions["providerName"];
  private readonly model: string;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL });
    this.providerName = options.providerName;
    this.model = options.model;
  }

  async analyzeRepository(
    repository: RepositoryIdentity,
    context: RepositoryContext,
  ): Promise<RepositoryProfile> {
    const prompt = buildRepositoryAnalysisPrompt(repository, context);
    return this.complete<RepositoryProfile>(prompt, RepositoryProfileSchema, "analyzeRepository", "RepositoryProfile");
  }

  async resolveRequirementContext(
    requirement: Requirement,
    profile: RepositoryProfile,
    context: RepositoryContext,
    answeredClarifications: Clarification[],
  ): Promise<ContextResolutionOutput> {
    const prompt = buildContextResolutionPrompt(requirement, profile, context, answeredClarifications);
    return this.complete<ContextResolutionOutput>(
      prompt,
      ContextResolutionOutputSchema,
      "resolveRequirementContext",
      "ContextResolutionOutput",
    );
  }

  async analyzeRequirement(
    requirement: Requirement,
    profile: RepositoryProfile,
    context: RepositoryContext,
    knowledge: ResolvedRequirementKnowledge,
  ): Promise<ImpactAnalysis> {
    const prompt = buildImpactAnalysisPrompt(requirement, profile, context, knowledge);
    return this.complete<ImpactAnalysis>(prompt, ImpactAnalysisSchema, "analyzeRequirement", "ImpactAnalysis");
  }

  async scoreRequirement(
    requirement: Requirement,
    profile: RepositoryProfile,
    impact: ImpactAnalysis,
    context: RepositoryContext,
    knowledge: ResolvedRequirementKnowledge,
  ): Promise<ScoringOutput> {
    const prompt = buildScoringPrompt(requirement, profile, impact, context, knowledge);
    return this.complete<ScoringOutput>(prompt, ScoringOutputSchema, "scoreRequirement", "ScoringOutput");
  }

  private async complete<T>(
    prompt: PromptParts,
    schema: ZodType<T>,
    step: string,
    schemaName: string,
  ): Promise<T> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: `${prompt.stableContext}\n\n${prompt.volatile}` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: schemaName,
            schema: toOpenAIStrictJsonSchema(schema),
            strict: true,
          },
        },
      });

      const usage = response.usage;
      if (usage) {
        const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
        await recordUsage(this.providerName, response.model ?? this.model, step, {
          inputTokens: Math.max(usage.prompt_tokens - cachedTokens, 0),
          outputTokens: usage.completion_tokens,
          cacheWrite5mTokens: 0,
          cacheWrite1hTokens: 0,
          cacheReadTokens: cachedTokens,
        });
      }

      const message = response.choices[0]?.message;
      if (message?.refusal) {
        throw new AIProviderError(`AI provider refused the ${step} request: ${message.refusal}`);
      }
      if (!message?.content) {
        throw new AIProviderError(`AI provider response for ${step} contained no content.`);
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(message.content);
      } catch (err) {
        throw new AIProviderError(`AI provider response for ${step} was not valid JSON.`, err);
      }

      const parsed = schema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new AIProviderError(
          `AI provider response for ${step} could not be parsed into the expected structure.`,
          parsed.error,
        );
      }

      return parsed.data;
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      if (err instanceof OpenAI.AuthenticationError) {
        throw new AIProviderError(`AI provider authentication failed for ${this.providerName}.`, err);
      }
      if (err instanceof OpenAI.RateLimitError) {
        throw new AIProviderError("AI provider rate limit exceeded. Try again shortly.", err);
      }
      if (err instanceof OpenAI.APIError) {
        throw new AIProviderError(`AI provider request for ${step} failed: ${err.message}`, err);
      }
      throw new AIProviderError(`AI provider request for ${step} failed unexpectedly.`, err);
    }
  }
}
