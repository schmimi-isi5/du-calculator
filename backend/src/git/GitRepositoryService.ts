// Real git access. No repository content, commit SHA, or file listing here
// is ever fabricated - every value comes from an actual `git clone`,
// `git rev-parse HEAD`, and `git ls-files` run against the target repository.

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { config } from "../config.js";
import { buildAuthenticatedCloneUrl } from "./validateRepositoryInput.js";

export type GitOperationStage = "CLONE" | "INSPECT" | "TOO_LARGE";

export class GitOperationError extends Error {
  readonly stage: GitOperationStage;

  constructor(message: string, stage: GitOperationStage, cause?: unknown) {
    super(message);
    this.name = "GitOperationError";
    this.stage = stage;
    if (cause !== undefined) this.cause = cause;
  }
}

export interface RepositoryReadResult {
  commitSha: string;
  fileTree: string[];
  /** Caller must call cleanupWorkingDir(workingDir) once done reading files. */
  workingDir: string;
}

/**
 * Clones the given branch of a repository (shallow, single-branch) into a
 * fresh temp directory and reads back the real commit SHA and tracked file
 * list. Throws GitOperationError on any failure; always cleans up the temp
 * directory itself on failure (the caller only owns cleanup on success).
 *
 * When accessToken is supplied (for private repositories), it is embedded
 * only in the URL passed to the `git clone` process - never in error
 * messages, logs, or the returned result, all of which reference the
 * original, credential-free repositoryUrl. Note: since the token is passed
 * as a CLI argument, it is visible for the (brief) lifetime of the clone
 * process to anything with access to this container's process list
 * (e.g. /proc) - an accepted, documented tradeoff for this MVP.
 */
export async function cloneAndReadRepository(
  repositoryUrl: string,
  branch: string,
  accessToken?: string,
): Promise<RepositoryReadResult> {
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), `du-calc-${randomUUID()}-`));
  const cloneUrl = accessToken ? buildAuthenticatedCloneUrl(repositoryUrl, accessToken) : repositoryUrl;

  try {
    const git = simpleGit({ timeout: { block: config.gitCloneTimeoutMs } });

    try {
      await git.clone(cloneUrl, workingDir, [
        "--depth",
        "1",
        "--branch",
        branch,
        "--single-branch",
      ]);
    } catch (cause) {
      throw new GitOperationError(
        `Could not clone branch "${branch}" from ${repositoryUrl}. Check that the URL and branch are correct` +
          (accessToken
            ? " and the access token has read access to this repository."
            : " and the repository is publicly reachable, or provide an access token for a private repository."),
        "CLONE",
        cause,
      );
    }

    const repoGit = simpleGit(workingDir);

    if (accessToken) {
      // The token is otherwise left sitting in this clone's .git/config on
      // disk until cleanup runs - scrub it immediately rather than relying
      // solely on cleanup timing.
      try {
        await repoGit.remote(["set-url", "origin", repositoryUrl]);
      } catch {
        // Non-fatal: the working directory is temporary and always removed
        // by cleanupWorkingDir regardless of whether this scrub succeeds.
      }
    }

    let commitSha: string;
    try {
      commitSha = (await repoGit.revparse(["HEAD"])).trim();
    } catch (cause) {
      throw new GitOperationError(
        "Cloned the repository but could not determine the current commit SHA.",
        "INSPECT",
        cause,
      );
    }

    let fileTree: string[];
    try {
      const raw = await repoGit.raw(["ls-files"]);
      fileTree = raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch (cause) {
      throw new GitOperationError(
        "Cloned the repository but could not list its tracked files.",
        "INSPECT",
        cause,
      );
    }

    if (fileTree.length > config.gitMaxRepoFiles) {
      throw new GitOperationError(
        `Repository has ${fileTree.length} tracked files, exceeding the configured limit of ${config.gitMaxRepoFiles}. Analyze a smaller branch or subdirectory instead.`,
        "TOO_LARGE",
      );
    }

    return { commitSha, fileTree, workingDir };
  } catch (err) {
    await cleanupWorkingDir(workingDir);
    throw err;
  }
}

export async function cleanupWorkingDir(workingDir: string): Promise<void> {
  await fs.rm(workingDir, { recursive: true, force: true });
}
