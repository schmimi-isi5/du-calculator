// Postgres-backed ScoringStore. Uses plain parameterized SQL (no ORM) - the
// domain objects are small and mostly JSON-shaped already, so mapping them
// to/from a handful of JSONB columns is simpler and more transparent than
// introducing an ORM for this MVP.

import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type {
  RepositoryContext,
  RepositorySnapshot,
  RepositorySnapshotSummary,
  RepositoryStats,
  RequirementContext,
  ScoringHistoryEntry,
  ScoringResult,
  ScoringStats,
} from "../domain/types.js";
import { pool } from "../db/pool.js";
import type { ScoringStore } from "./ScoringStore.js";

interface SnapshotRow extends QueryResultRow {
  id: string;
  repository_url: string;
  branch: string;
  status: string;
  mode: string;
  commit_sha: string | null;
  analyzed_at: Date | null;
  file_tree: string[] | null;
  profile: RepositorySnapshot["profile"];
  error_message: string | null;
}

interface SnapshotSummaryRow extends QueryResultRow {
  id: string;
  repository_url: string;
  branch: string;
  status: string;
  mode: string;
  commit_sha: string | null;
  analyzed_at: Date | null;
  profile_summary: string | null;
}

interface ContextRow extends QueryResultRow {
  file_tree: string[] | null;
  file_excerpts: Record<string, string> | null;
  omitted_file_count: number | null;
}

interface ScoringResultRow extends QueryResultRow {
  id: string;
  snapshot_id: string;
  requirement_context_id: string | null;
  requirement: ScoringResult["requirement"];
  quality_level: string;
  model: string;
  status: string;
  impact_analysis: ScoringResult["impactAnalysis"];
  dimension_scores: ScoringResult["dimensionScores"];
  overall_assessment: ScoringResult["overallAssessment"];
  confidence: ScoringResult["confidence"];
  du_result: ScoringResult["duResult"];
  assumptions_used: string[] | null;
  open_questions: string[] | null;
  error_message: string | null;
  scored_at: Date | null;
}

interface RequirementContextRow extends QueryResultRow {
  id: string;
  snapshot_id: string;
  requirement: RequirementContext["requirement"];
  quality_level: string;
  model: string;
  normalization: RequirementContext["normalization"];
  known_facts: RequirementContext["knownFacts"] | null;
  assumptions: RequirementContext["assumptions"] | null;
  missing_information: RequirementContext["missingInformation"] | null;
  clarifications: RequirementContext["clarifications"] | null;
  status: string;
  resolution_rounds: number;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

interface HistoryRow extends QueryResultRow {
  id: string;
  snapshot_id: string;
  repository_url: string;
  branch: string;
  requirement_title: string | null;
  status: string;
  du_class: string | null;
  development_units: string | null;
  price: string | null;
  overall_confidence: string | null;
  confidence_level: string | null;
  scored_at: Date | null;
  created_at: Date;
}

function toSnapshot(row: SnapshotRow): RepositorySnapshot {
  return {
    id: row.id,
    repositoryUrl: row.repository_url,
    branch: row.branch,
    status: row.status as RepositorySnapshot["status"],
    mode: row.mode as RepositorySnapshot["mode"],
    commitSha: row.commit_sha,
    analyzedAt: row.analyzed_at ? row.analyzed_at.toISOString() : null,
    fileTree: row.file_tree ?? [],
    profile: row.profile ?? null,
    errorMessage: row.error_message,
  };
}

function toSnapshotSummary(row: SnapshotSummaryRow): RepositorySnapshotSummary {
  return {
    id: row.id,
    repositoryUrl: row.repository_url,
    branch: row.branch,
    status: row.status as RepositorySnapshotSummary["status"],
    mode: row.mode as RepositorySnapshotSummary["mode"],
    commitSha: row.commit_sha,
    analyzedAt: row.analyzed_at ? row.analyzed_at.toISOString() : null,
    profileSummary: row.profile_summary,
  };
}

function toScoringResult(row: ScoringResultRow): ScoringResult {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    requirementContextId: row.requirement_context_id,
    requirement: row.requirement,
    qualityLevel: row.quality_level as ScoringResult["qualityLevel"],
    model: row.model,
    status: row.status as ScoringResult["status"],
    impactAnalysis: row.impact_analysis ?? null,
    dimensionScores: row.dimension_scores ?? null,
    overallAssessment: row.overall_assessment ?? null,
    confidence: row.confidence ?? null,
    duResult: row.du_result ?? null,
    assumptionsUsed: row.assumptions_used ?? [],
    openQuestions: row.open_questions ?? [],
    errorMessage: row.error_message,
    scoredAt: row.scored_at ? row.scored_at.toISOString() : null,
  };
}

function toRequirementContext(row: RequirementContextRow): RequirementContext {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    requirement: row.requirement,
    qualityLevel: row.quality_level as RequirementContext["qualityLevel"],
    model: row.model,
    normalization: row.normalization ?? null,
    knownFacts: row.known_facts ?? [],
    assumptions: row.assumptions ?? [],
    missingInformation: row.missing_information ?? [],
    clarifications: row.clarifications ?? [],
    status: row.status as RequirementContext["status"],
    resolutionRounds: row.resolution_rounds,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toHistoryEntry(row: HistoryRow): ScoringHistoryEntry {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    repositoryUrl: row.repository_url,
    branch: row.branch,
    requirementTitle: row.requirement_title ?? "(untitled)",
    status: row.status as ScoringHistoryEntry["status"],
    duClass: (row.du_class as ScoringHistoryEntry["duClass"]) ?? null,
    developmentUnits: row.development_units !== null ? Number(row.development_units) : null,
    price: row.price !== null ? Number(row.price) : null,
    overallConfidence: row.overall_confidence !== null ? Number(row.overall_confidence) : null,
    confidenceLevel: (row.confidence_level as ScoringHistoryEntry["confidenceLevel"]) ?? null,
    scoredAt: row.scored_at ? row.scored_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export class PostgresScoringStore implements ScoringStore {
  createSnapshotId(): string {
    return randomUUID();
  }

  createScoringId(): string {
    return randomUUID();
  }

  async saveSnapshot(snapshot: RepositorySnapshot): Promise<void> {
    await pool.query(
      `INSERT INTO repository_snapshots
         (id, repository_url, branch, status, mode, commit_sha, analyzed_at, file_tree, profile, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         mode = EXCLUDED.mode,
         commit_sha = EXCLUDED.commit_sha,
         analyzed_at = EXCLUDED.analyzed_at,
         file_tree = EXCLUDED.file_tree,
         profile = EXCLUDED.profile,
         error_message = EXCLUDED.error_message`,
      [
        snapshot.id,
        snapshot.repositoryUrl,
        snapshot.branch,
        snapshot.status,
        snapshot.mode ?? "EXISTING_SYSTEM",
        snapshot.commitSha,
        snapshot.analyzedAt,
        JSON.stringify(snapshot.fileTree),
        snapshot.profile !== null ? JSON.stringify(snapshot.profile) : null,
        snapshot.errorMessage,
      ],
    );
  }

  async getSnapshot(id: string): Promise<RepositorySnapshot | undefined> {
    const result = await pool.query<SnapshotRow>(
      `SELECT id, repository_url, branch, status, mode, commit_sha, analyzed_at, file_tree, profile, error_message
       FROM repository_snapshots WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toSnapshot(result.rows[0]) : undefined;
  }

  async listSnapshots(limit: number): Promise<RepositorySnapshotSummary[]> {
    const result = await pool.query<SnapshotSummaryRow>(
      `SELECT id, repository_url, branch, status, mode, commit_sha, analyzed_at, profile->>'summary' AS profile_summary
       FROM repository_snapshots
       WHERE status = 'SNAPSHOT_CREATED'
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(toSnapshotSummary);
  }

  async getRepositoryStats(): Promise<RepositoryStats> {
    const [statusResult, modeResult, totalResult] = await Promise.all([
      pool.query<{ status: string; count: string }>(
        "SELECT status, count(*) FROM repository_snapshots GROUP BY status",
      ),
      pool.query<{ mode: string; count: string }>("SELECT mode, count(*) FROM repository_snapshots GROUP BY mode"),
      pool.query<{ count: string }>("SELECT count(*) FROM repository_snapshots"),
    ]);
    return {
      total: Number(totalResult.rows[0]?.count ?? 0),
      byStatus: Object.fromEntries(statusResult.rows.map((r) => [r.status, Number(r.count)])) as RepositoryStats["byStatus"],
      byMode: Object.fromEntries(modeResult.rows.map((r) => [r.mode, Number(r.count)])) as RepositoryStats["byMode"],
    };
  }

  async saveRepositoryContext(snapshotId: string, context: RepositoryContext): Promise<void> {
    await pool.query(
      `UPDATE repository_snapshots
       SET file_excerpts = $2::jsonb, omitted_file_count = $3
       WHERE id = $1`,
      [snapshotId, JSON.stringify(context.fileExcerpts), context.omittedFileCount],
    );
  }

  async getRepositoryContext(snapshotId: string): Promise<RepositoryContext | undefined> {
    const result = await pool.query<ContextRow>(
      `SELECT file_tree, file_excerpts, omitted_file_count FROM repository_snapshots WHERE id = $1`,
      [snapshotId],
    );
    const row = result.rows[0];
    if (!row || row.file_excerpts === null) return undefined;
    return {
      fileTree: row.file_tree ?? [],
      fileExcerpts: row.file_excerpts,
      omittedFileCount: row.omitted_file_count ?? 0,
    };
  }

  createRequirementContextId(): string {
    return randomUUID();
  }

  async saveRequirementContext(context: RequirementContext): Promise<void> {
    await pool.query(
      `INSERT INTO requirement_contexts
         (id, snapshot_id, requirement, quality_level, model, normalization, known_facts, assumptions,
          missing_information, clarifications, status, resolution_rounds, error_message, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15)
       ON CONFLICT (id) DO UPDATE SET
         normalization = EXCLUDED.normalization,
         known_facts = EXCLUDED.known_facts,
         assumptions = EXCLUDED.assumptions,
         missing_information = EXCLUDED.missing_information,
         clarifications = EXCLUDED.clarifications,
         status = EXCLUDED.status,
         resolution_rounds = EXCLUDED.resolution_rounds,
         error_message = EXCLUDED.error_message,
         updated_at = EXCLUDED.updated_at`,
      [
        context.id,
        context.snapshotId,
        JSON.stringify(context.requirement),
        context.qualityLevel,
        context.model,
        context.normalization !== null ? JSON.stringify(context.normalization) : null,
        JSON.stringify(context.knownFacts),
        JSON.stringify(context.assumptions),
        JSON.stringify(context.missingInformation),
        JSON.stringify(context.clarifications),
        context.status,
        context.resolutionRounds,
        context.errorMessage,
        context.createdAt,
        context.updatedAt,
      ],
    );
  }

  async getRequirementContext(id: string): Promise<RequirementContext | undefined> {
    const result = await pool.query<RequirementContextRow>(
      `SELECT id, snapshot_id, requirement, quality_level, model, normalization, known_facts, assumptions,
              missing_information, clarifications, status, resolution_rounds, error_message, created_at, updated_at
       FROM requirement_contexts WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toRequirementContext(result.rows[0]) : undefined;
  }

  async saveScoringResult(result: ScoringResult): Promise<void> {
    await pool.query(
      `INSERT INTO scoring_results
         (id, snapshot_id, requirement_context_id, requirement, quality_level, model, status, impact_analysis,
          dimension_scores, overall_assessment, confidence, du_result, assumptions_used, open_questions,
          error_message, scored_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
               $13::jsonb, $14::jsonb, $15, $16)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         impact_analysis = EXCLUDED.impact_analysis,
         dimension_scores = EXCLUDED.dimension_scores,
         overall_assessment = EXCLUDED.overall_assessment,
         confidence = EXCLUDED.confidence,
         du_result = EXCLUDED.du_result,
         assumptions_used = EXCLUDED.assumptions_used,
         open_questions = EXCLUDED.open_questions,
         error_message = EXCLUDED.error_message,
         scored_at = EXCLUDED.scored_at`,
      [
        result.id,
        result.snapshotId,
        result.requirementContextId,
        JSON.stringify(result.requirement),
        result.qualityLevel,
        result.model,
        result.status,
        result.impactAnalysis !== null ? JSON.stringify(result.impactAnalysis) : null,
        result.dimensionScores !== null ? JSON.stringify(result.dimensionScores) : null,
        result.overallAssessment !== null ? JSON.stringify(result.overallAssessment) : null,
        result.confidence !== null ? JSON.stringify(result.confidence) : null,
        result.duResult !== null ? JSON.stringify(result.duResult) : null,
        JSON.stringify(result.assumptionsUsed),
        JSON.stringify(result.openQuestions),
        result.errorMessage,
        result.scoredAt,
      ],
    );
  }

  async getScoringResult(id: string): Promise<ScoringResult | undefined> {
    const result = await pool.query<ScoringResultRow>(
      `SELECT id, snapshot_id, requirement_context_id, requirement, quality_level, model, status, impact_analysis,
              dimension_scores, overall_assessment, confidence, du_result, assumptions_used, open_questions,
              error_message, scored_at
       FROM scoring_results WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toScoringResult(result.rows[0]) : undefined;
  }

  async listScoringResults(limit: number): Promise<ScoringHistoryEntry[]> {
    const result = await pool.query<HistoryRow>(
      `SELECT
         sr.id,
         sr.snapshot_id,
         rs.repository_url,
         rs.branch,
         sr.requirement->>'title' AS requirement_title,
         sr.status,
         sr.du_result->>'duClass' AS du_class,
         (sr.du_result->>'developmentUnits')::numeric AS development_units,
         (sr.du_result->>'price')::numeric AS price,
         (sr.confidence->>'overallConfidence')::numeric AS overall_confidence,
         sr.confidence->>'confidenceLevel' AS confidence_level,
         sr.scored_at,
         sr.created_at
       FROM scoring_results sr
       JOIN repository_snapshots rs ON rs.id = sr.snapshot_id
       ORDER BY sr.created_at DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(toHistoryEntry);
  }

  async getScoringStats(): Promise<ScoringStats> {
    const [statusResult, totalResult] = await Promise.all([
      pool.query<{ status: string; count: string }>("SELECT status, count(*) FROM scoring_results GROUP BY status"),
      pool.query<{ count: string }>("SELECT count(*) FROM scoring_results"),
    ]);
    return {
      total: Number(totalResult.rows[0]?.count ?? 0),
      byStatus: Object.fromEntries(statusResult.rows.map((r) => [r.status, Number(r.count)])) as ScoringStats["byStatus"],
    };
  }
}

export const store: ScoringStore = new PostgresScoringStore();
