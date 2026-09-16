// Persistence for small operator-editable settings (see the Einstellungen
// tab) - a plain key/value table, deliberately separate from config.ts's
// env-var-sourced configuration. Only non-secret preferences belong here
// (e.g. the default model id); API keys and other credentials stay in the
// environment and are never written to this table.

import { pool } from "../db/pool.js";

export const SETTINGS_KEYS = {
  defaultModelId: "default_model_id",
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const result = await pool.query<{ value: string }>("SELECT value FROM app_settings WHERE key = $1", [key]);
  return result.rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

export async function clearSetting(key: string): Promise<void> {
  await pool.query("DELETE FROM app_settings WHERE key = $1", [key]);
}
