// Persistence for calibration data (commercial-du-v1 spec sections 19,
// 28-29) - deliberately separate from PostgresScoringStore, matching the
// same pattern as AppSettingsStore/AIUsageStore: a small, single-purpose
// table that isn't part of the core scoring domain's own lifecycle. Records
// what actually happened for a delivered requirement, together with an
// immutable snapshot of what was predicted at that moment, so today's
// CapabilityProfile/Commercial hypotheses (domain/technology.ts,
// domain/commercial.ts) can later be recalibrated against real outcomes -
// no self-learning reads from this yet.

import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import type { ActualEffortRecord } from "../domain/types.js";

interface ActualEffortRow {
  id: string;
  scoring_id: string;
  actual_human_hours: string;
  actual_implementation_method: string;
  prediction_snapshot: ActualEffortRecord["predictionSnapshot"];
  direct_costs_actual: ActualEffortRecord["directCostsActual"];
  rework_hours: string | null;
  bugfix_hours: string | null;
  acceptance_iterations: number | null;
  scope_changed: boolean | null;
  notes: string | null;
  recorded_at: Date;
}

function toRecord(row: ActualEffortRow): ActualEffortRecord {
  return {
    id: row.id,
    scoringId: row.scoring_id,
    actualHumanHours: Number(row.actual_human_hours),
    actualImplementationMethod: row.actual_implementation_method as ActualEffortRecord["actualImplementationMethod"],
    predictionSnapshot: row.prediction_snapshot ?? null,
    directCostsActual: row.direct_costs_actual ?? null,
    reworkHours: row.rework_hours !== null ? Number(row.rework_hours) : null,
    bugfixHours: row.bugfix_hours !== null ? Number(row.bugfix_hours) : null,
    acceptanceIterations: row.acceptance_iterations,
    scopeChanged: row.scope_changed,
    notes: row.notes,
    recordedAt: row.recorded_at.toISOString(),
  };
}

export async function recordActualEffort(
  input: Omit<ActualEffortRecord, "id" | "recordedAt">,
): Promise<ActualEffortRecord> {
  const id = randomUUID();
  const result = await pool.query<ActualEffortRow>(
    `INSERT INTO actual_effort_records
       (id, scoring_id, actual_human_hours, actual_implementation_method, prediction_snapshot,
        direct_costs_actual, rework_hours, bugfix_hours, acceptance_iterations, scope_changed, notes)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11)
     RETURNING id, scoring_id, actual_human_hours, actual_implementation_method, prediction_snapshot,
               direct_costs_actual, rework_hours, bugfix_hours, acceptance_iterations, scope_changed, notes, recorded_at`,
    [
      id,
      input.scoringId,
      input.actualHumanHours,
      input.actualImplementationMethod,
      input.predictionSnapshot !== null ? JSON.stringify(input.predictionSnapshot) : null,
      input.directCostsActual !== null ? JSON.stringify(input.directCostsActual) : null,
      input.reworkHours,
      input.bugfixHours,
      input.acceptanceIterations,
      input.scopeChanged,
      input.notes,
    ],
  );
  return toRecord(result.rows[0]!);
}

export async function listActualEffortForScoring(scoringId: string): Promise<ActualEffortRecord[]> {
  const result = await pool.query<ActualEffortRow>(
    `SELECT id, scoring_id, actual_human_hours, actual_implementation_method, prediction_snapshot,
            direct_costs_actual, rework_hours, bugfix_hours, acceptance_iterations, scope_changed, notes, recorded_at
     FROM actual_effort_records WHERE scoring_id = $1 ORDER BY recorded_at DESC`,
    [scoringId],
  );
  return result.rows.map(toRecord);
}
