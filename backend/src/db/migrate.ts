// Minimal, idempotent schema setup for the MVP - plain `CREATE TABLE IF NOT
// EXISTS` run once at startup instead of a migration framework. Simplest
// robust option for a single-schema app with no prior versions to migrate
// between; revisit with a real migration tool once the schema needs to
// evolve across deployed versions.

import { pool } from "./pool.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS repository_snapshots (
  id UUID PRIMARY KEY,
  repository_url TEXT NOT NULL,
  branch TEXT NOT NULL,
  status TEXT NOT NULL,
  commit_sha TEXT,
  analyzed_at TIMESTAMPTZ,
  file_tree JSONB NOT NULL DEFAULT '[]',
  profile JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Added after the initial schema: the file excerpts a snapshot was
-- analyzed with, so a repository can be reused for further requirements
-- without re-cloning or re-running the AI analysis. ADD COLUMN IF NOT
-- EXISTS keeps this idempotent for databases created before this change.
ALTER TABLE repository_snapshots ADD COLUMN IF NOT EXISTS file_excerpts JSONB;
ALTER TABLE repository_snapshots ADD COLUMN IF NOT EXISTS omitted_file_count INTEGER;

CREATE INDEX IF NOT EXISTS idx_repository_snapshots_created_at ON repository_snapshots (created_at DESC);

-- Assumption & Clarification Engine: the living state of "what do we know
-- about this requirement" - normalization, facts, assumptions, missing
-- information, and the clarification dialog. See domain/types.ts
-- RequirementContext and scoring/clarificationGate.ts for the logic that
-- reads and updates this.
CREATE TABLE IF NOT EXISTS requirement_contexts (
  id UUID PRIMARY KEY,
  snapshot_id UUID NOT NULL REFERENCES repository_snapshots(id),
  requirement JSONB NOT NULL,
  normalization JSONB,
  known_facts JSONB NOT NULL DEFAULT '[]',
  assumptions JSONB NOT NULL DEFAULT '[]',
  missing_information JSONB NOT NULL DEFAULT '[]',
  clarifications JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_requirement_contexts_snapshot_id ON requirement_contexts (snapshot_id);

-- How many resolution rounds have run - once this reaches the chosen
-- QualityLevel's maxResolutionRounds (domain/qualityLevels.ts), no further
-- clarification question is ever asked for this context.
ALTER TABLE requirement_contexts ADD COLUMN IF NOT EXISTS resolution_rounds INTEGER NOT NULL DEFAULT 0;

-- Which QualityLevel (quick/standard/thorough) this run was resolved at -
-- fixed for the context's whole lifetime once chosen on the first round.
-- Existing rows default to 'standard', the level all of them were actually
-- run at before this column existed.
ALTER TABLE requirement_contexts ADD COLUMN IF NOT EXISTS quality_level TEXT NOT NULL DEFAULT 'standard';

CREATE TABLE IF NOT EXISTS scoring_results (
  id UUID PRIMARY KEY,
  snapshot_id UUID NOT NULL REFERENCES repository_snapshots(id),
  requirement JSONB NOT NULL,
  status TEXT NOT NULL,
  impact_analysis JSONB,
  dimension_scores JSONB,
  overall_assessment JSONB,
  confidence JSONB,
  du_result JSONB,
  open_questions JSONB NOT NULL DEFAULT '[]',
  error_message TEXT,
  scored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Added for the Assumption & Clarification Engine: which resolved context
-- (facts/assumptions) this assessment was scored from, and the consolidated
-- set of assumption ids it actually relied on - the audit trail behind
-- "why was this requirement scored at X DU on this date".
ALTER TABLE scoring_results ADD COLUMN IF NOT EXISTS requirement_context_id UUID REFERENCES requirement_contexts(id);
ALTER TABLE scoring_results ADD COLUMN IF NOT EXISTS assumptions_used JSONB NOT NULL DEFAULT '[]';
-- Which QualityLevel this assessment was scored at - existing rows default
-- to 'standard', the level all of them were actually run at before this
-- column existed.
ALTER TABLE scoring_results ADD COLUMN IF NOT EXISTS quality_level TEXT NOT NULL DEFAULT 'standard';

CREATE INDEX IF NOT EXISTS idx_scoring_results_created_at ON scoring_results (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scoring_results_snapshot_id ON scoring_results (snapshot_id);

-- One row per AI provider call, for the cost dashboard: which operation,
-- against which provider/model, how many tokens of each kind, and the
-- resulting cost - null when the (provider, model) has no known price
-- (see ai/pricing.ts) rather than a guessed number.
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  operation TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(14, 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_created_at ON ai_usage_log (created_at DESC);

-- Which requirement/repository each call was for, so the detailed usage log
-- (GET /api/ai-usage/log) can show "which call cost how much for which
-- assessment" instead of just aggregate totals. No FK constraint - this is
-- operational telemetry, deliberately decoupled from the core domain tables'
-- own lifecycle.
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS snapshot_id UUID;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS requirement_context_id UUID;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS scoring_id UUID;

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_snapshot_id ON ai_usage_log (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_requirement_context_id ON ai_usage_log (requirement_context_id);
`;

export async function runMigrations(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
