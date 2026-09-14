// In-memory persistence for the MVP. No database is required by the spec;
// snapshots and scoring results only need to live for the duration of a
// session, so a process-local Map is the simplest robust option. Swap for a
// real datastore if/when multi-instance deployment is needed.

import { randomUUID } from "node:crypto";
import type { RepositoryContext, RepositorySnapshot, ScoringResult } from "../domain/types.js";

class InMemoryStore {
  private readonly snapshots = new Map<string, RepositorySnapshot>();
  private readonly scoringResults = new Map<string, ScoringResult>();
  // Repository content (file excerpts) kept in memory only, keyed by
  // snapshot id, so later requirement scoring doesn't need the on-disk
  // clone to still exist - the temp directory is deleted right after the
  // initial repository analysis (see security.md: control temp repo copies).
  private readonly repositoryContexts = new Map<string, RepositoryContext>();

  createSnapshotId(): string {
    return randomUUID();
  }

  saveSnapshot(snapshot: RepositorySnapshot): void {
    this.snapshots.set(snapshot.id, snapshot);
  }

  getSnapshot(id: string): RepositorySnapshot | undefined {
    return this.snapshots.get(id);
  }

  createScoringId(): string {
    return randomUUID();
  }

  saveScoringResult(result: ScoringResult): void {
    this.scoringResults.set(result.id, result);
  }

  getScoringResult(id: string): ScoringResult | undefined {
    return this.scoringResults.get(id);
  }

  saveRepositoryContext(snapshotId: string, context: RepositoryContext): void {
    this.repositoryContexts.set(snapshotId, context);
  }

  getRepositoryContext(snapshotId: string): RepositoryContext | undefined {
    return this.repositoryContexts.get(snapshotId);
  }
}

export const store = new InMemoryStore();
