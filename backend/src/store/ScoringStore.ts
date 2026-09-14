import type { RepositorySnapshot, ScoringHistoryEntry, ScoringResult } from "../domain/types.js";

/**
 * Persistence for the domain history: repository snapshots and the
 * requirement -> DU decisions scored against them. Backed by Postgres
 * (see PostgresScoringStore.ts) so the history survives restarts and is
 * queryable - this is deliberately separate from RepositoryContextCache,
 * which holds only transient, in-memory working data (raw file excerpts)
 * that never needs to survive a restart.
 */
export interface ScoringStore {
  createSnapshotId(): string;
  saveSnapshot(snapshot: RepositorySnapshot): Promise<void>;
  getSnapshot(id: string): Promise<RepositorySnapshot | undefined>;

  createScoringId(): string;
  saveScoringResult(result: ScoringResult): Promise<void>;
  getScoringResult(id: string): Promise<ScoringResult | undefined>;

  /** Most recent requirement -> DU decisions, newest first. */
  listScoringResults(limit: number): Promise<ScoringHistoryEntry[]>;
}
