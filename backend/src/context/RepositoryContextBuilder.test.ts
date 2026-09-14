import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRepositoryContext } from "./RepositoryContextBuilder.js";

describe("buildRepositoryContext", () => {
  let workingDir: string;

  beforeEach(async () => {
    workingDir = await fs.mkdtemp(path.join(os.tmpdir(), `du-calc-test-${randomUUID()}-`));
  });

  afterEach(async () => {
    await fs.rm(workingDir, { recursive: true, force: true });
  });

  async function write(relPath: string, content: string) {
    const full = path.join(workingDir, relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }

  it("reads priority files and excludes ignored/secret files from both tree and excerpts", async () => {
    await write("README.md", "# Project\nThis does X.");
    await write("src/services/retrieval.ts", "export function retrieve() {}");
    await write("node_modules/pkg/index.js", "module.exports = {};");
    await write(".env", "SECRET=shh");

    const fileTree = [
      "README.md",
      "src/services/retrieval.ts",
      "node_modules/pkg/index.js",
      ".env",
    ];

    const context = await buildRepositoryContext(workingDir, fileTree);

    expect(context.fileTree).toEqual(["README.md", "src/services/retrieval.ts"]);
    expect(context.fileExcerpts["README.md"]).toContain("This does X.");
    expect(context.fileExcerpts["src/services/retrieval.ts"]).toContain("export function retrieve");
    expect(context.fileExcerpts[".env"]).toBeUndefined();
    expect(context.fileExcerpts["node_modules/pkg/index.js"]).toBeUndefined();
  });

  it("truncates a file that exceeds the per-file character budget", async () => {
    const longContent = "x".repeat(25_000);
    await write("README.md", longContent);

    const context = await buildRepositoryContext(workingDir, ["README.md"]);

    expect(context.fileExcerpts["README.md"]!.length).toBeLessThan(longContent.length);
    expect(context.fileExcerpts["README.md"]).toContain("[... truncated ...]");
  });

  it("reads priority files before non-priority files when the budget is tight", async () => {
    await write("docs/notes.txt", "unrelated notes");
    await write("package.json", '{"name":"demo"}');

    const context = await buildRepositoryContext(workingDir, ["docs/notes.txt", "package.json"]);

    expect(context.fileExcerpts["package.json"]).toBeDefined();
  });
});
