import { describe, expect, it } from "vitest";
import { InvalidRepositoryInputError, validateRepositoryInput } from "./validateRepositoryInput.js";

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
});
