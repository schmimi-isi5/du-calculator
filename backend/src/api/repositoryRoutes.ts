import { Router } from "express";
import { buildRepositoryContext } from "../context/RepositoryContextBuilder.js";
import type { RepositorySnapshot } from "../domain/types.js";
import { AIProviderError } from "../ai/AIProvider.js";
import { getAIProvider } from "../ai/getAIProvider.js";
import { cleanupWorkingDir, cloneAndReadRepository, GitOperationError } from "../git/GitRepositoryService.js";
import { InvalidRepositoryInputError, validateRepositoryInput } from "../git/validateRepositoryInput.js";
import { logger } from "../logging.js";
import { store } from "../store/PostgresScoringStore.js";
import { asyncHandler } from "./asyncHandler.js";
import { errorCause } from "./errorCause.js";

export const repositoryRouter = Router();

const DEFAULT_SNAPSHOT_LIMIT = 50;
const MAX_SNAPSHOT_LIMIT = 200;

repositoryRouter.post("/analyze", asyncHandler(async (req, res) => {
  let repositoryUrl: string;
  let branch: string;
  let accessToken: string | undefined;
  try {
    const validated = validateRepositoryInput(req.body?.repositoryUrl, req.body?.branch, req.body?.accessToken);
    repositoryUrl = validated.repositoryUrl;
    branch = validated.branch;
    accessToken = validated.accessToken;
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
  await store.saveSnapshot(snapshot);

  let workingDir: string | undefined;
  try {
    const { commitSha, fileTree, workingDir: dir } = await cloneAndReadRepository(repositoryUrl, branch, accessToken);
    workingDir = dir;
    snapshot.commitSha = commitSha;
    snapshot.status = "ANALYZING";
    await store.saveSnapshot(snapshot);

    const context = await buildRepositoryContext(workingDir, fileTree);

    const aiProvider = getAIProvider();
    const profile = await aiProvider.analyzeRepository(
      { repositoryUrl, branch, commitSha },
      context,
    );

    snapshot.fileTree = context.fileTree;
    snapshot.profile = profile;
    snapshot.status = "SNAPSHOT_CREATED";
    snapshot.analyzedAt = new Date().toISOString();
    await store.saveSnapshot(snapshot);
    // Persisted (not cached in memory) so this repository can be reused for
    // further requirements later - even after a restart - without
    // re-cloning or re-running the AI analysis.
    await store.saveRepositoryContext(snapshot.id, context);

    res.status(200).json(snapshot);
  } catch (err) {
    snapshot.status = "ERROR";
    snapshot.errorMessage = describeError(err);
    logger.error("Repository analysis failed", {
      snapshotId: snapshot.id,
      repositoryUrl,
      branch,
      error: snapshot.errorMessage,
      cause: errorCause(err),
    });
    await store.saveSnapshot(snapshot);
    res.status(200).json(snapshot);
  } finally {
    if (workingDir) {
      await cleanupWorkingDir(workingDir).catch(() => {
        // Best-effort cleanup; nothing actionable if this fails.
      });
    }
  }
}));

// Successfully analyzed repositories, for the "reuse an existing repository"
// picker. Registered before "/:id" - otherwise Express would match this
// path as an :id.
repositoryRouter.get("/", asyncHandler(async (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_SNAPSHOT_LIMIT) : DEFAULT_SNAPSHOT_LIMIT;

  const snapshots = await store.listSnapshots(limit);
  res.status(200).json(snapshots);
}));

repositoryRouter.get("/:id", asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "id is required." });
    return;
  }
  const snapshot = await store.getSnapshot(id);
  if (!snapshot) {
    res.status(404).json({ error: "Repository snapshot not found." });
    return;
  }
  res.status(200).json(snapshot);
}));

function describeError(err: unknown): string {
  if (err instanceof GitOperationError) return err.message;
  if (err instanceof AIProviderError) return err.message;
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred while analyzing the repository.";
}
