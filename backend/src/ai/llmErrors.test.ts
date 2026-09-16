import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { AIProviderError } from "./AIProvider.js";
import { mapAnthropicError, mapOpenAICompatibleError } from "./llmErrors.js";

describe("mapAnthropicError", () => {
  it("maps AuthenticationError to authentication_error", () => {
    const err = mapAnthropicError(new Anthropic.AuthenticationError(401, {}, "bad key", new Headers()), "step");
    expect(err.code).toBe("authentication_error");
  });

  it("maps RateLimitError to rate_limit", () => {
    const err = mapAnthropicError(new Anthropic.RateLimitError(429, {}, "slow down", new Headers()), "step");
    expect(err.code).toBe("rate_limit");
  });

  it("maps APIConnectionTimeoutError to timeout", () => {
    const err = mapAnthropicError(new Anthropic.APIConnectionTimeoutError({ message: "timed out" }), "step");
    expect(err.code).toBe("timeout");
  });

  it("maps APIConnectionError to provider_unavailable", () => {
    const err = mapAnthropicError(new Anthropic.APIConnectionError({ message: "connect failed" }), "step");
    expect(err.code).toBe("provider_unavailable");
  });

  it("maps NotFoundError to model_unavailable", () => {
    const err = mapAnthropicError(new Anthropic.NotFoundError(404, {}, "no such model", new Headers()), "step");
    expect(err.code).toBe("model_unavailable");
  });

  it("maps a 4xx APIError to invalid_request", () => {
    const err = mapAnthropicError(new Anthropic.APIError(400, {}, "bad request", new Headers()), "step");
    expect(err.code).toBe("invalid_request");
  });

  it("maps a context-length message to context_too_large regardless of status", () => {
    // The SDK's APIError formats its .message from (status, error-body) when
    // an error body is given, ignoring the plain `message` constructor arg -
    // passing `undefined` for the body is how real API error responses
    // without a structured body surface too, and lets .message carry the
    // text this test needs to check.
    const err = mapAnthropicError(
      new Anthropic.APIError(400, undefined, "prompt is too long: maximum context length is 200000 tokens", new Headers()),
      "step",
    );
    expect(err.code).toBe("context_too_large");
  });

  it("maps a 5xx APIError to unknown_provider_error", () => {
    const err = mapAnthropicError(new Anthropic.APIError(500, {}, "internal error", new Headers()), "step");
    expect(err.code).toBe("unknown_provider_error");
  });

  it("passes an existing AIProviderError through unchanged", () => {
    const original = new AIProviderError("already classified", "invalid_request");
    expect(mapAnthropicError(original, "step")).toBe(original);
  });

  it("maps a connection-refused error to provider_unavailable", () => {
    const err = mapAnthropicError(new Error("connect ECONNREFUSED 127.0.0.1:11434"), "step");
    expect(err.code).toBe("provider_unavailable");
  });

  it("falls back to unknown_provider_error for an unrecognized error shape", () => {
    const err = mapAnthropicError("not even an Error object", "step");
    expect(err.code).toBe("unknown_provider_error");
  });
});

describe("mapOpenAICompatibleError", () => {
  it("maps AuthenticationError to authentication_error, naming the provider", () => {
    const err = mapOpenAICompatibleError(new OpenAI.AuthenticationError(401, {}, "bad key", new Headers()), "step", "deepseek");
    expect(err.code).toBe("authentication_error");
    expect(err.message).toContain("deepseek");
  });

  it("maps RateLimitError to rate_limit", () => {
    const err = mapOpenAICompatibleError(new OpenAI.RateLimitError(429, {}, "slow down", new Headers()), "step", "openai");
    expect(err.code).toBe("rate_limit");
  });

  it("maps APIConnectionError to provider_unavailable, naming the provider", () => {
    const err = mapOpenAICompatibleError(new OpenAI.APIConnectionError({ message: "connect failed" }), "step", "ollama");
    expect(err.code).toBe("provider_unavailable");
    expect(err.message).toContain("ollama");
  });

  it("maps NotFoundError to model_unavailable", () => {
    const err = mapOpenAICompatibleError(new OpenAI.NotFoundError(404, {}, "no such model", new Headers()), "step", "qwen");
    expect(err.code).toBe("model_unavailable");
  });

  it("maps a context-length message to context_too_large", () => {
    const err = mapOpenAICompatibleError(
      new OpenAI.APIError(400, undefined, "This model's maximum context length is 128000 tokens", new Headers()),
      "step",
      "openai",
    );
    expect(err.code).toBe("context_too_large");
  });

  it("maps an unreachable local Ollama server (connection refused) to provider_unavailable", () => {
    const err = mapOpenAICompatibleError(new Error("fetch failed: connect ECONNREFUSED"), "step", "ollama");
    expect(err.code).toBe("provider_unavailable");
  });
});
