import { describe, expect, it } from "vitest";
import {
  buildAuthenticatedCloneUrl,
  InvalidRepositoryInputError,
  validateRepositoryInput,
} from "./validateRepositoryInput.js";

describe("validateRepositoryInput", () => {
  it("accepts a well-formed https URL and branch", () => {
    const result = validateRepositoryInput("https://github.com/example/repo.git", "main");
    expect(result.repositoryUrl).toBe("https://github.com/example/repo.git");
    expect(result.branch).toBe("main");
  });

  it("rejects a missing repositoryUrl", () => {
    expect(() => validateRepositoryInput(undefined, "main")).toThrow(InvalidRepositoryInputError);
  });

  it("rejects a missing branch", () => {
    expect(() => validateRepositoryInput("https://github.com/example/repo.git", "")).toThrow(
      InvalidRepositoryInputError,
    );
  });

  it("rejects non-http(s) protocols (e.g. ssh, file)", () => {
    expect(() => validateRepositoryInput("ssh://git@github.com/example/repo.git", "main")).toThrow(
      InvalidRepositoryInputError,
    );
    expect(() => validateRepositoryInput("file:///etc/passwd", "main")).toThrow(
      InvalidRepositoryInputError,
    );
  });

  it("rejects branch names that look like git options (flag injection)", () => {
    expect(() => validateRepositoryInput("https://github.com/example/repo.git", "--upload-pack=evil")).toThrow(
      InvalidRepositoryInputError,
    );
  });

  it("rejects localhost and private network hosts (basic SSRF guard)", () => {
    for (const url of [
      "http://localhost/repo.git",
      "http://127.0.0.1/repo.git",
      "http://10.0.0.5/repo.git",
      "http://192.168.1.10/repo.git",
      "http://169.254.169.254/latest/meta-data",
    ]) {
      expect(() => validateRepositoryInput(url, "main")).toThrow(InvalidRepositoryInputError);
    }
  });

  it("rejects malformed URLs", () => {
    expect(() => validateRepositoryInput("not a url", "main")).toThrow(InvalidRepositoryInputError);
  });

  it("accepts and trims an optional accessToken", () => {
    const result = validateRepositoryInput("https://github.com/example/repo.git", "main", "  ghp_abc123  ");
    expect(result.accessToken).toBe("ghp_abc123");
  });

  it("treats an empty or missing accessToken as absent", () => {
    expect(validateRepositoryInput("https://github.com/example/repo.git", "main").accessToken).toBeUndefined();
    expect(validateRepositoryInput("https://github.com/example/repo.git", "main", "").accessToken).toBeUndefined();
    expect(validateRepositoryInput("https://github.com/example/repo.git", "main", "   ").accessToken).toBeUndefined();
  });

  it("rejects an accessToken containing whitespace or control characters", () => {
    expect(() => validateRepositoryInput("https://github.com/example/repo.git", "main", "abc def")).toThrow(
      InvalidRepositoryInputError,
    );
    expect(() => validateRepositoryInput("https://github.com/example/repo.git", "main", "abc\ndef")).toThrow(
      InvalidRepositoryInputError,
    );
  });

  it("rejects an excessively long accessToken", () => {
    expect(() => validateRepositoryInput("https://github.com/example/repo.git", "main", "a".repeat(600))).toThrow(
      InvalidRepositoryInputError,
    );
  });

  it("rejects a repositoryUrl with embedded credentials - accessToken must be used instead", () => {
    expect(() =>
      validateRepositoryInput("https://user:pass@github.com/example/repo.git", "main"),
    ).toThrow(InvalidRepositoryInputError);
  });
});

describe("buildAuthenticatedCloneUrl", () => {
  it("embeds the access token as the URL username", () => {
    const url = buildAuthenticatedCloneUrl("https://github.com/example/repo.git", "ghp_abc123");
    expect(url).toBe("https://ghp_abc123@github.com/example/repo.git");
  });

  it("percent-encodes special characters in the token", () => {
    const url = buildAuthenticatedCloneUrl("https://github.com/example/repo.git", "a/b c");
    const parsed = new URL(url);
    expect(decodeURIComponent(parsed.username)).toBe("a/b c");
  });
});
