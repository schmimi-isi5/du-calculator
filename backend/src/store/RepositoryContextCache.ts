// Transient, in-memory-only cache for the RepositoryContext (raw file
// excerpts) built during repository analysis. This is deliberately NOT
// persisted to Postgres: it can be tens of thousands of characters per
// repository, is only needed while a session actively scores requirements
// against a freshly analyzed snapshot, and re-analyzing the repository
// rebuilds it cheaply. Domain history (snapshots, scoring results) lives in
// ScoringStore instead.

import type { RepositoryContext } from "../domain/types.js";

class RepositoryContextCache {
  private readonly contexts = new Map<string, RepositoryContext>();

  save(snapshotId: string, context: RepositoryContext): void {
    this.contexts.set(snapshotId, context);
  }

  get(snapshotId: string): RepositoryContext | undefined {
    return this.contexts.get(snapshotId);
  }
}

export const repositoryContextCache = new RepositoryContextCache();
