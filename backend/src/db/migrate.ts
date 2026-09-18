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

-- GREENFIELD support (commercial-du-v1 spec section 4): a requirement with
-- no existing repository still creates a snapshot row (mode='GREENFIELD',
-- a synthetic profile, no clone) so it reuses every existing snapshot-keyed
-- code path instead of a parallel "no repository" flow. Existing rows
-- default to 'EXISTING_SYSTEM', the only mode that existed before this
-- column.
ALTER TABLE repository_snapshots ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'EXISTING_SYSTEM';

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
-- Which model (see domain/models.ts) this context is resolved with - fixed
-- for the context's whole lifetime, same as quality_level. Existing rows
-- default to claude-opus-5, the only model ever used before this column
-- existed.
ALTER TABLE requirement_contexts ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT 'claude-opus-5';

-- Requirement Challenge & Optimization (requirement-challenge-v1, see
-- domain/types.ts RequirementContext and scoring/requirementChallengeEngine.ts):
-- original_requirement is the immutable, exactly-as-submitted input (never
-- overwritten by AI normalization or challenge decisions); normalized_requirement
-- is the immutable snapshot right after the first AI normalization pass,
-- before any challenge proposal is applied; approved_requirement is frozen
-- once the user explicitly approves (see the new /approve endpoint) - only
-- this field, never "requirement", is used as scoring input. "requirement"
-- itself is unchanged in shape - it keeps being the CURRENT working draft,
-- now additionally mutated by accepted/edited challenge proposals.
--
-- Existing rows predate this feature and never went through a Challenge
-- step - approval_status defaults to 'APPROVED' so they remain immediately
-- scorable exactly as before (spec: "historisch freigegebene
-- Assessment-Grundlage"), while original_requirement/normalized_requirement/
-- approved_requirement stay NULL (the application falls back to "requirement"
-- for those). requirement_preparation_version stays NULL for these rows,
-- distinguishing them from new contexts (which explicitly set
-- 'requirement-challenge-v1') without forcing a retroactive Challenge run.
ALTER TABLE requirement_contexts ADD COLUMN IF NOT EXISTS original_requirement JSONB;
ALTER TABLE requirement_contexts ADD COLUMN IF NOT EXISTS normalized_requirement JSONB;
ALTER TABLE requirement_contexts ADD COLUMN IF NOT EXISTS approved_requirement JSONB;
ALTER TABLE requirement_contexts ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'APPROVED';
ALTER TABLE requirement_contexts ADD COLUMN IF NOT EXISTS challenge_analysis JSONB;
ALTER TABLE requirement_contexts ADD COLUMN IF NOT EXISTS challenge_proposals JSONB NOT NULL DEFAULT '[]';
ALTER TABLE requirement_contexts ADD COLUMN IF NOT EXISTS requirement_preparation_version TEXT;

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
-- Which model produced this assessment - existing rows default to
-- claude-opus-5, the only model ever used before this column existed.
ALTER TABLE scoring_results ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT 'claude-opus-5';

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

-- Small operator-editable settings (Einstellungen tab) that shouldn't
-- require an env var change + redeploy to adjust, unlike provider API keys
-- (which stay in the environment - secrets are never written here). One row
-- per key; a missing row means "use the env-configured / built-in default".
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Calibration data collection (technology-fit-v2 spec section 19). Today's
-- TechnologyCapabilityProfile/overhead constants (domain/technology.ts) are
-- explicitly labeled INITIAL_HYPOTHESIS - this table records what actually
-- happened per delivered requirement, so they can later be recalibrated
-- against real ISIFIVE project outcomes. No self-learning/auto-adjustment
-- reads from this table yet - it exists for data collection only.
CREATE TABLE IF NOT EXISTS actual_effort_records (
  id UUID PRIMARY KEY,
  scoring_id UUID NOT NULL REFERENCES scoring_results(id),
  actual_human_hours NUMERIC(10, 2) NOT NULL,
  actual_implementation_method TEXT NOT NULL,
  notes TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_actual_effort_records_scoring_id ON actual_effort_records (scoring_id);

-- commercial-du-v1 spec sections 28/29: an immutable snapshot of what was
-- predicted at the moment this actual was recorded (a ScoringResult can
-- later be re-scored, overwriting its own du_result - this column is what
-- keeps the historical prediction-vs-actual pairing intact regardless), plus
-- the extra structured actuals the spec asks for. All nullable/optional so
-- existing rows and older API clients remain valid.
ALTER TABLE actual_effort_records ADD COLUMN IF NOT EXISTS prediction_snapshot JSONB;
ALTER TABLE actual_effort_records ADD COLUMN IF NOT EXISTS direct_costs_actual JSONB;
ALTER TABLE actual_effort_records ADD COLUMN IF NOT EXISTS rework_hours NUMERIC(10, 2);
ALTER TABLE actual_effort_records ADD COLUMN IF NOT EXISTS bugfix_hours NUMERIC(10, 2);
ALTER TABLE actual_effort_records ADD COLUMN IF NOT EXISTS acceptance_iterations INTEGER;
ALTER TABLE actual_effort_records ADD COLUMN IF NOT EXISTS scope_changed BOOLEAN;
`;

export async function runMigrations(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
