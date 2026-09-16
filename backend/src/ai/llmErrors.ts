// Maps each provider SDK's own error hierarchy to one shared LLMErrorCode
// (spec section 13), so both AIProvider implementations classify failures
// the same way instead of each inventing its own message-string matching.
// The Anthropic and OpenAI TS SDKs are both Stainless-generated and expose
// an identical error class hierarchy (APIError -> AuthenticationError /
// RateLimitError / NotFoundError / APIConnectionError -> ...), verified
// against both installed SDKs' type declarations.

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AIProviderError, type LLMErrorCode } from "./AIProvider.js";

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const text = `${err.name} ${err.message}`.toLowerCase();
  return text.includes("timeout") || text.includes("timed out");
}

function isConnectionRefusedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown; cause?: { code?: unknown } }).code ?? (err as { cause?: { code?: unknown } }).cause?.code;
  const text = `${err.name} ${err.message} ${String(code ?? "")}`.toLowerCase();
  return text.includes("econnrefused") || text.includes("enotfound") || text.includes("fetch failed");
}

function isContextTooLargeMessage(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("context_length_exceeded") ||
    text.includes("maximum context length") ||
    text.includes("context length") ||
    text.includes("too many tokens") ||
    text.includes("prompt is too long")
  );
}

/** Classifies any APIError shared shape (both SDKs' APIError has the same fields) that isn't one of the more specific subclasses already handled by the caller. */
function classifyGenericApiError(
  status: number | undefined,
  message: string,
  step: string,
): { message: string; code: LLMErrorCode } {
  if (isContextTooLargeMessage(message)) {
    return {
      message: `AI provider request for ${step} failed: input too large for the model's context window.`,
      code: "context_too_large",
    };
  }
  if (typeof status === "number" && status >= 400 && status < 500) {
    return { message: `AI provider request for ${step} failed: ${message}`, code: "invalid_request" };
  }
  return { message: `AI provider request for ${step} failed: ${message}`, code: "unknown_provider_error" };
}

export function mapAnthropicError(err: unknown, step: string): AIProviderError {
  if (err instanceof AIProviderError) return err;

  if (err instanceof Anthropic.AuthenticationError) {
    return new AIProviderError(
      "AI provider authentication failed. Check that ANTHROPIC_API_KEY is set correctly.",
      "authentication_error",
      err,
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AIProviderError("AI provider rate limit exceeded. Try again shortly.", "rate_limit", err);
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AIProviderError(`AI provider request for ${step} timed out.`, "timeout", err);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AIProviderError("AI provider (Anthropic) is unreachable.", "provider_unavailable", err);
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AIProviderError("The selected Anthropic model is not available.", "model_unavailable", err);
  }
  if (err instanceof Anthropic.APIError) {
    const { message, code } = classifyGenericApiError(err.status, err.message, step);
    return new AIProviderError(message, code, err);
  }
  if (isTimeoutError(err)) return new AIProviderError(`AI provider request for ${step} timed out.`, "timeout", err);
  if (isConnectionRefusedError(err)) {
    return new AIProviderError("AI provider (Anthropic) is unreachable.", "provider_unavailable", err);
  }
  return new AIProviderError(`AI provider request for ${step} failed unexpectedly.`, "unknown_provider_error", err);
}

export function mapOpenAICompatibleError(err: unknown, step: string, providerLabel: string): AIProviderError {
  if (err instanceof AIProviderError) return err;

  if (err instanceof OpenAI.AuthenticationError) {
    return new AIProviderError(`AI provider authentication failed for ${providerLabel}.`, "authentication_error", err);
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new AIProviderError("AI provider rate limit exceeded. Try again shortly.", "rate_limit", err);
  }
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return new AIProviderError(`AI provider request for ${step} timed out.`, "timeout", err);
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new AIProviderError(`AI provider (${providerLabel}) is unreachable.`, "provider_unavailable", err);
  }
  if (err instanceof OpenAI.NotFoundError) {
    return new AIProviderError(`The selected model is not available at ${providerLabel}.`, "model_unavailable", err);
  }
  if (err instanceof OpenAI.APIError) {
    const { message, code } = classifyGenericApiError(err.status, err.message, step);
    return new AIProviderError(message, code, err);
  }
  if (isTimeoutError(err)) return new AIProviderError(`AI provider request for ${step} timed out.`, "timeout", err);
  if (isConnectionRefusedError(err)) {
    return new AIProviderError(`AI provider (${providerLabel}) is unreachable.`, "provider_unavailable", err);
  }
  return new AIProviderError(`AI provider request for ${step} failed unexpectedly.`, "unknown_provider_error", err);
}
