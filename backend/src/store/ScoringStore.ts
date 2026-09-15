import type {
  RepositoryContext,
  RepositorySnapshot,
  RepositorySnapshotSummary,
  ScoringHistoryEntry,
  ScoringResult,
} from "../domain/types.js";

/**
 * Persistence for the domain history: repository snapshots (including the
 * RepositoryContext they were analyzed with), and the requirement -> DU
 * decisions scored against them. Backed by Postgres (see
 * PostgresScoringStore.ts) so a repository, once analyzed, can be reused for
 * further requirements without re-cloning or re-running the AI analysis -
 * and so the history survives restarts and is queryable.
 */
export interface ScoringStore {
  createSnapshotId(): string;
  saveSnapshot(snapshot: RepositorySnapshot): Promise<void>;
  getSnapshot(id: string): Promise<RepositorySnapshot | undefined>;

  /** Successfully analyzed repositories, newest first - candidates for reuse. */
  listSnapshots(limit: number): Promise<RepositorySnapshotSummary[]>;

  /** The file excerpts a snapshot was analyzed with - needed to score further requirements against it. */
  saveRepositoryContext(snapshotId: string, context: RepositoryContext): Promise<void>;
  getRepositoryContext(snapshotId: string): Promise<RepositoryContext | undefined>;

  createScoringId(): string;
  saveScoringResult(result: ScoringResult): Promise<void>;
  getScoringResult(id: string): Promise<ScoringResult | undefined>;

  /** Most recent requirement -> DU decisions, newest first. */
  listScoringResults(limit: number): Promise<ScoringHistoryEntry[]>;
}
