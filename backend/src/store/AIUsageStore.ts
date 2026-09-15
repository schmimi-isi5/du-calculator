// Persistence for the AI usage/cost log (see domain/types.ts AIUsageRecord).
// Kept separate from ScoringStore: this is operational/cost telemetry, not
// part of the scoring domain, and every AIProvider implementation writes to
// it regardless of which domain flow (repository analysis, clarification,
// scoring) triggered the call.

import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { AIUsageBreakdownEntry, AIUsageRecord, AIUsageSummary } from "../domain/types.js";
import { pool } from "../db/pool.js";

export interface UsageDateRange {
  from: Date;
  to: Date;
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
}

export class PostgresAIUsageStore implements AIUsageStore {
  async recordUsage(record: Omit<AIUsageRecord, "id" | "createdAt">): Promise<void> {
    await pool.query(
      `INSERT INTO ai_usage_log
         (id, provider, model, operation, input_tokens, output_tokens,
          cache_creation_input_tokens, cache_read_input_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
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
}

export const aiUsageStore: AIUsageStore = new PostgresAIUsageStore();
