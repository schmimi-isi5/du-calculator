// Persistence for calibration data (technology-fit-v2 spec section 19) -
// deliberately separate from PostgresScoringStore, matching the same
// pattern as AppSettingsStore/AIUsageStore: a small, single-purpose table
// that isn't part of the core scoring domain's own lifecycle. Records what
// actually happened for a delivered requirement so today's
// TechnologyCapabilityProfile hypotheses (domain/technology.ts) can later be
// recalibrated against real outcomes - no self-learning reads from this yet.

import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import type { ActualEffortRecord } from "../domain/types.js";

interface ActualEffortRow {
  id: string;
  scoring_id: string;
  actual_human_hours: string;
  actual_implementation_method: string;
  notes: string | null;
  recorded_at: Date;
}

function toRecord(row: ActualEffortRow): ActualEffortRecord {
  return {
    id: row.id,
    scoringId: row.scoring_id,
    actualHumanHours: Number(row.actual_human_hours),
    actualImplementationMethod: row.actual_implementation_method as ActualEffortRecord["actualImplementationMethod"],
    notes: row.notes,
    recordedAt: row.recorded_at.toISOString(),
  };
}

export async function recordActualEffort(
  input: Omit<ActualEffortRecord, "id" | "recordedAt">,
): Promise<ActualEffortRecord> {
  const id = randomUUID();
  const result = await pool.query<ActualEffortRow>(
    `INSERT INTO actual_effort_records (id, scoring_id, actual_human_hours, actual_implementation_method, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, scoring_id, actual_human_hours, actual_implementation_method, notes, recorded_at`,
    [id, input.scoringId, input.actualHumanHours, input.actualImplementationMethod, input.notes],
  );
  return toRecord(result.rows[0]!);
}

export async function listActualEffortForScoring(scoringId: string): Promise<ActualEffortRecord[]> {
  const result = await pool.query<ActualEffortRow>(
    `SELECT id, scoring_id, actual_human_hours, actual_implementation_method, notes, recorded_at
     FROM actual_effort_records WHERE scoring_id = $1 ORDER BY recorded_at DESC`,
    [scoringId],
  );
  return result.rows.map(toRecord);
}
