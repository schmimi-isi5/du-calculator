import { useEffect, useState } from "react";
import { ApiError, getSelectableModels } from "../api/client";
import { QUALITY_LEVEL_META, QUALITY_LEVEL_ORDER } from "../types";
import type { QualityLevel, SelectableModel } from "../types";

interface Props {
  title: string;
  description: string;
  acceptanceCriteria: string;
  constraints: string;
  qualityLevel: QualityLevel;
  model: string | null;
  canSubmit: boolean;
  loading: boolean;
  onChangeTitle: (v: string) => void;
  onChangeDescription: (v: string) => void;
  onChangeAcceptanceCriteria: (v: string) => void;
  onChangeConstraints: (v: string) => void;
  onChangeQualityLevel: (v: QualityLevel) => void;
  onChangeModel: (v: string) => void;
  onSubmit: () => void;
}

export function RequirementPanel({
  title,
  description,
  acceptanceCriteria,
  constraints,
  qualityLevel,
  model,
  canSubmit,
  loading,
  onChangeTitle,
  onChangeDescription,
  onChangeAcceptanceCriteria,
  onChangeConstraints,
  onChangeQualityLevel,
  onChangeModel,
  onSubmit,
}: Props) {
  const [selectableModels, setSelectableModels] = useState<SelectableModel[]>([]);

  useEffect(() => {
    let cancelled = false;
    getSelectableModels()
      .then((response) => {
        if (cancelled) return;
        setSelectableModels(response.models);
        onChangeModel(response.default);
      })
      .catch((err) => {
        if (!cancelled) {
          // Non-fatal: the picker simply stays hidden and the backend falls
          // back to its own default model.
          console.error(err instanceof ApiError ? err.message : "Modelle konnten nicht geladen werden.");
        }
      });
    return () => {
      cancelled = true;
    };
    // Fetches once on mount only - a user's own model pick must never be
    // silently overwritten by re-running this default-selection effect.
  }, []);

  return (
    <div className="card">
      <h2>Anforderung erfassen</h2>

      <label htmlFor="reqTitle">Titel</label>
      <input id="reqTitle" value={title} onChange={(e) => onChangeTitle(e.target.value)} />

      <label htmlFor="reqDescription">Beschreibung</label>
      <textarea
        id="reqDescription"
        value={description}
        onChange={(e) => onChangeDescription(e.target.value)}
      />

      <div className="row">
        <div>
          <label htmlFor="reqAcceptance">Akzeptanzkriterien (eine pro Zeile)</label>
          <textarea
            id="reqAcceptance"
            value={acceptanceCriteria}
            onChange={(e) => onChangeAcceptanceCriteria(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="reqConstraints">Randbedingungen (eine pro Zeile, optional)</label>
          <textarea
            id="reqConstraints"
            value={constraints}
            onChange={(e) => onChangeConstraints(e.target.value)}
            placeholder="Datenschutz, Performance, Ausschlüsse …"
          />
        </div>
      </div>

      <label htmlFor="qualityLevel">Qualitätsstufe</label>
      <div className="quality-level-picker" id="qualityLevel">
        {QUALITY_LEVEL_ORDER.map((level) => {
          const meta = QUALITY_LEVEL_META[level];
          return (
            <button
              key={level}
              type="button"
              className={`quality-level-option ${qualityLevel === level ? "active" : ""}`}
              onClick={() => onChangeQualityLevel(level)}
              disabled={loading}
            >
              <span className="quality-level-option-label">{meta.label}</span>
              <span className="quality-level-option-description">{meta.description}</span>
            </button>
          );
        })}
      </div>

      {selectableModels.length > 1 && (
        <>
          <label htmlFor="modelPicker">KI-Modell</label>
          <div className="quality-level-picker" id="modelPicker">
            {selectableModels.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`quality-level-option ${model === m.id ? "active" : ""}`}
                onClick={() => onChangeModel(m.id)}
                disabled={loading}
              >
                <span className="quality-level-option-label">{m.label}</span>
                <span className="quality-level-option-description">{m.description}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="actions">
        <button className="btn primary" onClick={onSubmit} disabled={!canSubmit || loading}>
          {loading ? "Analysiere Anforderung…" : "Anforderung analysieren"}
        </button>
        {!canSubmit && !loading && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Zuerst ein Repository erfolgreich analysieren.
          </span>
        )}
      </div>

      {loading && (
        <div className="notice progress" style={{ marginTop: 10 }}>
          Wird verarbeitet … Die KI prüft die Anforderung gegen das Repository, klassifiziert bekannte
          Fakten und Annahmen und ermittelt offene Fragen. Das kann bis zu ein bis zwei Minuten dauern.
        </div>
      )}
    </div>
  );
}
