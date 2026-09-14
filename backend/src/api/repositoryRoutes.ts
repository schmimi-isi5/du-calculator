import { Router } from "express";
import { buildRepositoryContext } from "../context/RepositoryContextBuilder.js";
import type { RepositorySnapshot } from "../domain/types.js";
import { AIProviderError } from "../ai/AIProvider.js";
import { getAIProvider } from "../ai/getAIProvider.js";
import { cleanupWorkingDir, cloneAndReadRepository, GitOperationError } from "../git/GitRepositoryService.js";
import { InvalidRepositoryInputError, validateRepositoryInput } from "../git/validateRepositoryInput.js";
import { logger } from "../logging.js";
import { store } from "../store/InMemoryStore.js";
import { asyncHandler } from "./asyncHandler.js";

export const repositoryRouter = Router();

repositoryRouter.post("/analyze", asyncHandler(async (req, res) => {
  let repositoryUrl: string;
  let branch: string;
  try {
    const validated = validateRepositoryInput(req.body?.repositoryUrl, req.body?.branch);
    repositoryUrl = validated.repositoryUrl;
    branch = validated.branch;
  } catch (err) {
    if (err instanceof InvalidRepositoryInputError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const snapshot: RepositorySnapshot = {
    id: store.createSnapshotId(),
    repositoryUrl,
    branch,
    status: "CLONING",
    commitSha: null,
    analyzedAt: null,
    fileTree: [],
    profile: null,
    errorMessage: null,
  };
  store.saveSnapshot(snapshot);

  let workingDir: string | undefined;
  try {
    const { commitSha, fileTree, workingDir: dir } = await cloneAndReadRepository(repositoryUrl, branch);
    workingDir = dir;
    snapshot.commitSha = commitSha;
    snapshot.status = "ANALYZING";
    store.saveSnapshot(snapshot);

    const context = await buildRepositoryContext(workingDir, fileTree);
    store.saveRepositoryContext(snapshot.id, context);

    const aiProvider = getAIProvider();
    const profile = await aiProvider.analyzeRepository(
      { repositoryUrl, branch, commitSha },
      context,
    );

    snapshot.fileTree = context.fileTree;
    snapshot.profile = profile;
    snapshot.status = "SNAPSHOT_CREATED";
    snapshot.analyzedAt = new Date().toISOString();
    store.saveSnapshot(snapshot);

    res.status(200).json(snapshot);
  } catch (err) {
    snapshot.status = "ERROR";
    snapshot.errorMessage = describeError(err);
    logger.error("Repository analysis failed", {
      snapshotId: snapshot.id,
      repositoryUrl,
      branch,
      error: snapshot.errorMessage,
    });
    store.saveSnapshot(snapshot);
    res.status(200).json(snapshot);
  } finally {
    if (workingDir) {
      await cleanupWorkingDir(workingDir).catch(() => {
        // Best-effort cleanup; nothing actionable if this fails.
      });
    }
  }
}));

repositoryRouter.get("/:id", (req, res) => {
  const snapshot = store.getSnapshot(req.params.id);
  if (!snapshot) {
    res.status(404).json({ error: "Repository snapshot not found." });
    return;
  }
  res.status(200).json(snapshot);
});

function describeError(err: unknown): string {
  if (err instanceof GitOperationError) return err.message;
  if (err instanceof AIProviderError) return err.message;
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred while analyzing the repository.";
}
