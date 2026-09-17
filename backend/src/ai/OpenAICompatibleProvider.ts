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
import { Agent, fetch as undiciFetch } from "undici";
import type { ZodType } from "zod";
import {
  ContextResolutionOutputSchema,
  RepositoryProfileSchema,
  RequirementAssessmentSchema,
} from "../domain/schemas.js";
import type {
  AIProviderName,
  Clarification,
  ContextResolutionOutput,
  QualityLevel,
  Requirement,
  RepositoryContext,
  RepositoryProfile,
  RepositorySnapshotMode,
  RequirementAssessment,
} from "../domain/types.js";
import type { AIProvider, RepositoryIdentity, ResolvedRequirementKnowledge, UsageContext } from "./AIProvider.js";
import { AIProviderError } from "./AIProvider.js";
import { mapOpenAICompatibleError } from "./llmErrors.js";
import {
  buildAssessmentPrompt,
  buildContextResolutionPrompt,
  buildRepositoryAnalysisPrompt,
  type PromptParts,
} from "./prompts.js";
import { toOpenAIStrictJsonSchema } from "./openAIStrictSchema.js";
import { recordUsage } from "./usageTracker.js";

export interface OpenAICompatibleProviderOptions {
  /** Which AIProviderName this instance reports to the usage log. */
  providerName: Extract<AIProviderName, "openai" | "openrouter" | "local" | "deepseek" | "google" | "qwen" | "ollama">;
  apiKey: string;
  /** Omit to use the real OpenAI API; set for OpenRouter or a local server. */
  baseURL?: string;
  model: string;
}

// Matches nginx's proxy_read_timeout (frontend/nginx.conf) so the whole
// chain agrees on how long a slow provider - in practice, an unaccelerated
// local model doing schema-constrained generation over a large repository
// context - is allowed to take.
const REQUEST_TIMEOUT_MS = 900_000;

export class OpenAICompatibleProvider implements AIProvider {
  private readonly client: OpenAI;
  private readonly providerName: OpenAICompatibleProviderOptions["providerName"];
  private readonly defaultModel: string;

  constructor(options: OpenAICompatibleProviderOptions) {
    // Node's global fetch enforces its own independent response-header and
    // body-inactivity timeouts (undici default: 5 minutes) regardless of the
    // `timeout` option below - confirmed live: a request to a slow local
    // model failed with undici's HeadersTimeoutError well under the 900s
    // nginx allows. The SDK's own docs (OpenAI client options) name this
    // exact fix: pass a matching `fetch` bound to an Agent whose
    // headersTimeout/bodyTimeout is at least as long as `timeout`.
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: REQUEST_TIMEOUT_MS,
      // undici's Request/Response types don't structurally match the DOM
      // lib types this SDK's `Fetch` type expects (e.g. missing `bytes`/
      // `textStream` on Request) - the cast is safe because undici's fetch
      // is the actual runtime implementation behind Node's global fetch;
      // this only swaps in a differently-configured instance of it.
      fetch: undiciFetch as unknown as typeof fetch,
      fetchOptions: {
        dispatcher: new Agent({ headersTimeout: REQUEST_TIMEOUT_MS, bodyTimeout: REQUEST_TIMEOUT_MS }),
      },
    });
    this.providerName = options.providerName;
    this.defaultModel = options.model;
  }

  async analyzeRepository(
    repository: RepositoryIdentity,
    context: RepositoryContext,
    usageContext: UsageContext,
  ): Promise<RepositoryProfile> {
    const prompt = buildRepositoryAnalysisPrompt(repository, context);
    return this.complete<RepositoryProfile>(
      prompt,
      RepositoryProfileSchema,
      "analyzeRepository",
      this.defaultModel,
      "RepositoryProfile",
      usageContext,
    );
  }

  async resolveRequirementContext(
    requirement: Requirement,
    profile: RepositoryProfile,
    context: RepositoryContext,
    answeredClarifications: Clarification[],
    qualityLevel: QualityLevel,
    model: string,
    usageContext: UsageContext,
    mode?: RepositorySnapshotMode,
  ): Promise<ContextResolutionOutput> {
    const prompt = buildContextResolutionPrompt(requirement, profile, context, answeredClarifications, qualityLevel, mode);
    return this.complete<ContextResolutionOutput>(
      prompt,
      ContextResolutionOutputSchema,
      "resolveRequirementContext",
      model,
      "ContextResolutionOutput",
      usageContext,
    );
  }

  async assessRequirement(
    requirement: Requirement,
    profile: RepositoryProfile,
    context: RepositoryContext,
    knowledge: ResolvedRequirementKnowledge,
    qualityLevel: QualityLevel,
    model: string,
    usageContext: UsageContext,
    mode?: RepositorySnapshotMode,
  ): Promise<RequirementAssessment> {
    const prompt = buildAssessmentPrompt(requirement, profile, context, knowledge, qualityLevel, mode);
    return this.complete<RequirementAssessment>(
      prompt,
      RequirementAssessmentSchema,
      "assessRequirement",
      model,
      "RequirementAssessment",
      usageContext,
    );
  }

  private async complete<T>(
    prompt: PromptParts,
    schema: ZodType<T>,
    step: string,
    model: string,
    schemaName: string,
    usageContext: UsageContext,
  ): Promise<T> {
    try {
      const response = await this.client.chat.completions.create({
        model,
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
        await recordUsage(
          this.providerName,
          response.model ?? model,
          step,
          {
            inputTokens: Math.max(usage.prompt_tokens - cachedTokens, 0),
            outputTokens: usage.completion_tokens,
            cacheWrite5mTokens: 0,
            cacheWrite1hTokens: 0,
            cacheReadTokens: cachedTokens,
          },
          usageContext,
        );
      }

      const message = response.choices[0]?.message;
      if (message?.refusal) {
        throw new AIProviderError(`AI provider refused the ${step} request: ${message.refusal}`, "invalid_request");
      }
      if (!message?.content) {
        throw new AIProviderError(`AI provider response for ${step} contained no content.`, "unknown_provider_error");
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(message.content);
      } catch (err) {
        throw new AIProviderError(`AI provider response for ${step} was not valid JSON.`, "unknown_provider_error", err);
      }

      const parsed = schema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new AIProviderError(
          `AI provider response for ${step} could not be parsed into the expected structure.`,
          "unknown_provider_error",
          parsed.error,
        );
      }

      return parsed.data;
    } catch (err) {
      throw mapOpenAICompatibleError(err, step, this.providerName);
    }
  }
}
