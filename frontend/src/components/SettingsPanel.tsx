import { useEffect, useState } from "react";
import { ApiError, getSettings, updateDefaultModel } from "../api/client";
import { AI_PROVIDER_LABELS, MODEL_CATEGORY_LABELS } from "../types";
import type { SettingsSnapshot } from "../types";

export function SettingsPanel() {
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  function load() {
    setLoading(true);
    setLoadError(null);
    getSettings()
      .then((result) => {
        setSettings(result);
        setSelectedModelId(result.defaultModelOverride ?? result.defaultModelId);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Unerwarteter Fehler."))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const result = await updateDefaultModel(selectedModelId);
      setSettings(result);
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Unerwarteter Fehler.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const result = await updateDefaultModel(null);
      setSettings(result);
      setSelectedModelId(result.defaultModelId);
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Unerwarteter Fehler.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="card">
        <h2>Einstellungen</h2>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>Lade Einstellungen…</p>
      </div>
    );
  }

  if (loadError || !settings) {
    return (
      <div className="card">
        <h2>Einstellungen</h2>
        <div className="notice error">{loadError ?? "Einstellungen konnten nicht geladen werden."}</div>
      </div>
    );
  }

  const availableModels = settings.models.filter((m) => m.available);
  const hasOverride = settings.defaultModelOverride !== null;

  return (
    <>
      <div className="card">
        <h2>LLM-Provider</h2>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: -6, marginBottom: 12 }}>
          API-Keys werden ausschließlich über Umgebungsvariablen konfiguriert (siehe env.example) - hier nur
          Sichtbarkeit, keine Bearbeitung von Zugangsdaten.
        </p>
        <div className="approach-table-wrap">
          <table className="approach-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Konfiguration</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {settings.providers.map((provider) => (
                <tr key={provider.id}>
                  <td>{AI_PROVIDER_LABELS[provider.id]}</td>
                  <td>
                    <code style={{ fontSize: 11 }}>{provider.envVar}</code>
                  </td>
                  <td>
                    <span className={`status-pill ${provider.configured ? "success" : "idle"}`}>
                      {provider.configured ? "Konfiguriert" : "Nicht konfiguriert"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Standard-LLM</h2>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: -6, marginBottom: 12 }}>
          Wird verwendet, wenn bei einer neuen Anforderung kein Modell explizit ausgewählt wird - unabhängig vom
          "Auto"-Modus, der stattdessen regelbasiert je Anfrage routet.
        </p>

        {availableModels.length === 0 ? (
          <div className="notice error">Kein Modell ist aktuell verfügbar - mindestens einen Provider konfigurieren.</div>
        ) : (
          <>
            <label htmlFor="defaultModelSelect">Modell</label>
            <select
              id="defaultModelSelect"
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              disabled={saving}
              style={{ marginBottom: 10 }}
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({MODEL_CATEGORY_LABELS[m.category]})
                </option>
              ))}
            </select>

            <div className="actions">
              <button className="btn primary" onClick={handleSave} disabled={saving || selectedModelId === settings.defaultModelOverride}>
                {saving ? "Speichert…" : "Speichern"}
              </button>
              {hasOverride && (
                <button className="btn secondary" onClick={handleReset} disabled={saving}>
                  Zurücksetzen (Umgebungsvariable/Standard verwenden)
                </button>
              )}
            </div>

            <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>
              Aktuell effektiv: <b>{settings.models.find((m) => m.id === settings.defaultModelId)?.displayName ?? settings.defaultModelId}</b>
              {!hasOverride && " (aus DEFAULT_LLM_MODEL bzw. eingebauter Fallback-Kette, kein manueller Override gesetzt)"}
            </p>

            {saveError && <div className="notice error" style={{ marginTop: 10 }}>{saveError}</div>}
            {saveSuccess && !saveError && (
              <div className="notice" style={{ marginTop: 10, background: "var(--green-tint)", color: "#3d6b09" }}>
                Gespeichert.
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
