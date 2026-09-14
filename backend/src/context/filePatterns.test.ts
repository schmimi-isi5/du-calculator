import { describe, expect, it } from "vitest";
import { isExcludedFromContext, isPriorityFile } from "./filePatterns.js";

describe("isExcludedFromContext", () => {
  it("excludes files under ignored directories", () => {
    expect(isExcludedFromContext("node_modules/lodash/index.js")).toBe(true);
    expect(isExcludedFromContext("dist/bundle.js")).toBe(true);
    expect(isExcludedFromContext(".git/config")).toBe(true);
  });

  it("excludes secret-bearing files even outside ignored directories", () => {
    expect(isExcludedFromContext(".env")).toBe(true);
    expect(isExcludedFromContext(".env.production")).toBe(true);
    expect(isExcludedFromContext("config/credentials.json")).toBe(true);
    expect(isExcludedFromContext("certs/server.pem")).toBe(true);
  });

  it("excludes binary and asset files by extension", () => {
    expect(isExcludedFromContext("assets/logo.png")).toBe(true);
    expect(isExcludedFromContext("fonts/museo.woff2")).toBe(true);
  });

  it("keeps ordinary source files", () => {
    expect(isExcludedFromContext("src/services/retrieval.ts")).toBe(false);
    expect(isExcludedFromContext("README.md")).toBe(false);
  });
});

describe("isPriorityFile", () => {
  it("prioritizes README and key manifests", () => {
    expect(isPriorityFile("README.md")).toBe(true);
    expect(isPriorityFile("package.json")).toBe(true);
    expect(isPriorityFile("Dockerfile")).toBe(true);
    expect(isPriorityFile(".github/workflows/ci.yml")).toBe(true);
  });

  it("prioritizes files under key source directories", () => {
    expect(isPriorityFile("src/services/retrieval.ts")).toBe(true);
    expect(isPriorityFile("backend/agents/josef.ts")).toBe(true);
  });

  it("does not prioritize unrelated files", () => {
    expect(isPriorityFile("docs/notes.txt")).toBe(false);
    expect(isPriorityFile("scripts/one-off.sh")).toBe(false);
  });
});
