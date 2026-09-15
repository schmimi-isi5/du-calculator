// Persistence for the AI usage/cost log (see domain/types.ts AIUsageRecord).
// Kept separate from ScoringStore: this is operational/cost telemetry, not
// part of the scoring domain, and every AIProvider implementation writes to
// it regardless of which domain flow (repository analysis, clarification,
// scoring) triggered the call.

import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { AIUsageBreakdownEntry, AIUsageLogEntry, AIUsageRecord, AIUsageSummary } from "../domain/types.js";
import { pool } from "../db/pool.js";

export interface UsageDateRange {
  from: Date;
  to: Date;
}

interface LogRow extends QueryResultRow {
  id: string;
  provider: string;
  model: string;
  operation: string;
  input_tokens: string;
  output_tokens: string;
  cache_creation_input_tokens: string;
  cache_read_input_tokens: string;
  cost_usd: string | null;
  snapshot_id: string | null;
  requirement_context_id: string | null;
  scoring_id: string | null;
  created_at: Date;
  label: string | null;
}

function toLogEntry(row: LogRow): AIUsageLogEntry {
  return {
    id: row.id,
    provider: row.provider as AIUsageLogEntry["provider"],
    model: row.model,
    operation: row.operation,
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cacheCreationInputTokens: Number(row.cache_creation_input_tokens),
    cacheReadInputTokens: Number(row.cache_read_input_tokens),
    costUsd: row.cost_usd !== null ? Number(row.cost_usd) : null,
    snapshotId: row.snapshot_id,
    requirementContextId: row.requirement_context_id,
    scoringId: row.scoring_id,
    createdAt: row.created_at.toISOString(),
    label: row.label,
  };
}

interface SummaryRow extends QueryResultRow {
  request_count: string;
  input_tokens: string;
  output_tokens: string;
  cache_creation_input_tokens: string;
  cache_read_input_tokens: string;
  cost_usd: string | null;
  unknown_cost_request_count: string;
}

interface BreakdownRow extends QueryResultRow {
  key: string;
  request_count: string;
  input_tokens: string;
  output_tokens: string;
  cache_creation_input_tokens: string;
  cache_read_input_tokens: string;
  cost_usd: string | null;
}

function toBreakdownEntry(row: BreakdownRow): AIUsageBreakdownEntry {
  return {
    key: row.key,
    requestCount: Number(row.request_count),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cacheCreationInputTokens: Number(row.cache_creation_input_tokens),
    cacheReadInputTokens: Number(row.cache_read_input_tokens),
    costUsd: row.cost_usd !== null ? Number(row.cost_usd) : null,
  };
}

export interface AIUsageStore {
  recordUsage(record: Omit<AIUsageRecord, "id" | "createdAt">): Promise<void>;
  getUsageSummary(range: UsageDateRange): Promise<AIUsageSummary>;
  /** Individual call records, newest first, with a human-readable label resolved from the requirement/repository each call belongs to. */
  listUsageLog(range: UsageDateRange, limit: number): Promise<AIUsageLogEntry[]>;
}

export class PostgresAIUsageStore implements AIUsageStore {
  async recordUsage(record: Omit<AIUsageRecord, "id" | "createdAt">): Promise<void> {
    await pool.query(
      `INSERT INTO ai_usage_log
         (id, provider, model, operation, input_tokens, output_tokens,
          cache_creation_input_tokens, cache_read_input_tokens, cost_usd,
          snapshot_id, requirement_context_id, scoring_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        randomUUID(),
        record.provider,
        record.model,
        record.operation,
        record.inputTokens,
        record.outputTokens,
        record.cacheCreationInputTokens,
        record.cacheReadInputTokens,
        record.costUsd,
        record.snapshotId,
        record.requirementContextId,
        record.scoringId,
      ],
    );
  }

  async getUsageSummary({ from, to }: UsageDateRange): Promise<AIUsageSummary> {
    const totalsResult = await pool.query<SummaryRow>(
      `SELECT
         COUNT(*) AS request_count,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_creation_input_tokens), 0) AS cache_creation_input_tokens,
         COALESCE(SUM(cache_read_input_tokens), 0) AS cache_read_input_tokens,
         SUM(cost_usd) AS cost_usd,
         COUNT(*) FILTER (WHERE cost_usd IS NULL) AS unknown_cost_request_count
       FROM ai_usage_log
       WHERE created_at >= $1 AND created_at < $2`,
      [from, to],
    );

    const byModelResult = await pool.query<BreakdownRow>(
      `SELECT
         model AS key,
         COUNT(*) AS request_count,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_creation_input_tokens), 0) AS cache_creation_input_tokens,
         COALESCE(SUM(cache_read_input_tokens), 0) AS cache_read_input_tokens,
         SUM(cost_usd) AS cost_usd
       FROM ai_usage_log
       WHERE created_at >= $1 AND created_at < $2
       GROUP BY model
       ORDER BY SUM(cost_usd) DESC NULLS LAST, request_count DESC`,
      [from, to],
    );

    const byOperationResult = await pool.query<BreakdownRow>(
      `SELECT
         operation AS key,
         COUNT(*) AS request_count,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_creation_input_tokens), 0) AS cache_creation_input_tokens,
         COALESCE(SUM(cache_read_input_tokens), 0) AS cache_read_input_tokens,
         SUM(cost_usd) AS cost_usd
       FROM ai_usage_log
       WHERE created_at >= $1 AND created_at < $2
       GROUP BY operation
       ORDER BY SUM(cost_usd) DESC NULLS LAST, request_count DESC`,
      [from, to],
    );

    const totals = totalsResult.rows[0];

    return {
      requestCount: totals ? Number(totals.request_count) : 0,
      inputTokens: totals ? Number(totals.input_tokens) : 0,
      outputTokens: totals ? Number(totals.output_tokens) : 0,
      cacheCreationInputTokens: totals ? Number(totals.cache_creation_input_tokens) : 0,
      cacheReadInputTokens: totals ? Number(totals.cache_read_input_tokens) : 0,
      costUsd: totals?.cost_usd !== null && totals?.cost_usd !== undefined ? Number(totals.cost_usd) : null,
      unknownCostRequestCount: totals ? Number(totals.unknown_cost_request_count) : 0,
      byModel: byModelResult.rows.map(toBreakdownEntry),
      byOperation: byOperationResult.rows.map(toBreakdownEntry),
    };
  }

  async listUsageLog({ from, to }: UsageDateRange, limit: number): Promise<AIUsageLogEntry[]> {
    // Label priority: the scoring result's requirement title (most specific -
    // this call was part of scoring a requirement), else the requirement
    // context's title (resolving/clarifying, before scoring exists), else
    // just the repository URL (repository analysis, no requirement yet).
    const result = await pool.query<LogRow>(
      `SELECT
         u.id, u.provider, u.model, u.operation, u.input_tokens, u.output_tokens,
         u.cache_creation_input_tokens, u.cache_read_input_tokens, u.cost_usd,
         u.snapshot_id, u.requirement_context_id, u.scoring_id, u.created_at,
         COALESCE(sr.requirement->>'title', rc.requirement->>'title', rs.repository_url) AS label
       FROM ai_usage_log u
       LEFT JOIN scoring_results sr ON sr.id = u.scoring_id
       LEFT JOIN requirement_contexts rc ON rc.id = u.requirement_context_id
       LEFT JOIN repository_snapshots rs ON rs.id = u.snapshot_id
       WHERE u.created_at >= $1 AND u.created_at < $2
       ORDER BY u.created_at DESC
       LIMIT $3`,
      [from, to, limit],
    );
    return result.rows.map(toLogEntry);
  }
}

export const aiUsageStore: AIUsageStore = new PostgresAIUsageStore();
