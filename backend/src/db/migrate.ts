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

CREATE INDEX IF NOT EXISTS idx_scoring_results_created_at ON scoring_results (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scoring_results_snapshot_id ON scoring_results (snapshot_id);
`;

export async function runMigrations(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
