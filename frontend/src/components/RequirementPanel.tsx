import { useEffect, useState } from "react";
import { ApiError, getOllamaStatus, getSelectableModels } from "../api/client";
import { AI_PROVIDER_LABELS, MODEL_CATEGORY_LABELS, QUALITY_LEVEL_META, QUALITY_LEVEL_ORDER } from "../types";
import type { QualityLevel, SelectableModel } from "../types";

const AUTO_OPTION_ID = "auto";

interface Props {
  title: string;
  description: string;
  acceptanceCriteria: string;
  constraints: string;
  qualityLevel: QualityLevel;
  model: string | null;
  privacyMode: "local-only" | undefined;
  canSubmit: boolean;
  loading: boolean;
  onChangeTitle: (v: string) => void;
  onChangeDescription: (v: string) => void;
  onChangeAcceptanceCriteria: (v: string) => void;
  onChangeConstraints: (v: string) => void;
  onChangeQualityLevel: (v: QualityLevel) => void;
  onChangeModel: (v: string) => void;
  onChangePrivacyMode: (v: "local-only" | undefined) => void;
  onSubmit: () => void;
}

export function RequirementPanel({
  title,
  description,
  acceptanceCriteria,
  constraints,
  qualityLevel,
  model,
  privacyMode,
  canSubmit,
  loading,
  onChangeTitle,
  onChangeDescription,
  onChangeAcceptanceCriteria,
  onChangeConstraints,
  onChangeQualityLevel,
  onChangeModel,
  onChangePrivacyMode,
  onSubmit,
}: Props) {
  const [selectableModels, setSelectableModels] = useState<SelectableModel[]>([]);
  const [ollamaReachable, setOllamaReachable] = useState<boolean | null>(null);

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
    getOllamaStatus()
      .then((status) => {
        if (!cancelled) setOllamaReachable(status.reachable);
      })
      .catch(() => {
        if (!cancelled) setOllamaReachable(false);
      });
    return () => {
      cancelled = true;
    };
    // Fetches once on mount only - a user's own model pick must never be
    // silently overwritten by re-running this default-selection effect.
  }, []);

  const localModel = selectableModels.find((m) => m.local);

  // A locally unreachable server is a *runtime* fact (spec section 10),
  // independent of the registry entry's own (config-only) `available` flag -
  // both must disable the button, but for a distinguishable reason.
  function isDisabled(m: SelectableModel): boolean {
    if (!m.available) return true;
    if (m.local && ollamaReachable === false) return true;
    if (privacyMode === "local-only" && !m.local) return true;
    return false;
  }

  function disabledReason(m: SelectableModel): string | undefined {
    if (!m.available) return "Kein API-Key für diesen Provider konfiguriert.";
    if (m.local && ollamaReachable === false) return "Lokaler Ollama-Server nicht erreichbar.";
    if (privacyMode === "local-only" && !m.local) return "Nur lokal: Cloud-Modelle sind deaktiviert.";
    return undefined;
  }

  function handleTogglePrivacyMode(checked: boolean) {
    onChangePrivacyMode(checked ? "local-only" : undefined);
    if (checked && model !== AUTO_OPTION_ID && localModel && model !== localModel.id) {
      onChangeModel(localModel.id);
    }
  }

  return (
    <div className="card">
      <h2>Anforderung erfassen</h2>

      <label htmlFor="reqTitle">Titel</label>
      <input
        id="reqTitle"
        value={title}
        onChange={(e) => onChangeTitle(e.target.value)}
        placeholder="Kurzer, eindeutiger Name für diese Anforderung"
      />

      <label htmlFor="reqDescription">Beschreibung</label>
      <textarea
        id="reqDescription"
        value={description}
        onChange={(e) => onChangeDescription(e.target.value)}
        placeholder="Was soll umgesetzt werden, und warum? Je konkreter, desto weniger Rückfragen."
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

      {selectableModels.length > 0 && (
        <>
          <label htmlFor="modelPicker">Modell</label>
          <div className="quality-level-picker" id="modelPicker">
            <button
              type="button"
              className={`quality-level-option ${model === AUTO_OPTION_ID ? "active" : ""}`}
              onClick={() => onChangeModel(AUTO_OPTION_ID)}
              disabled={loading}
            >
              <span className="quality-level-option-label">Auto</span>
              <span className="quality-level-option-description">Optimales Modell automatisch auswählen.</span>
            </button>
            {selectableModels.map((m) => {
              const disabled = loading || isDisabled(m);
              const reason = disabledReason(m);
              const subtitle = [
                // OpenRouter's own model catalog isn't fixed, so its
                // display name alone doesn't say where the model runs -
                // unlike e.g. "Claude Opus 5", which already implies Anthropic.
                m.provider === "openrouter" ? AI_PROVIDER_LABELS.openrouter : null,
                MODEL_CATEGORY_LABELS[m.category],
                m.local ? "keine API-Kosten" : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`quality-level-option ${model === m.id ? "active" : ""}`}
                  onClick={() => onChangeModel(m.id)}
                  disabled={disabled}
                  title={reason}
                >
                  <span className="quality-level-option-label">{m.displayName}</span>
                  <span className="quality-level-option-description">{reason ?? subtitle}</span>
                </button>
              );
            })}
          </div>

          <label className="privacy-mode-toggle">
            <input
              type="checkbox"
              checked={privacyMode === "local-only"}
              onChange={(e) => handleTogglePrivacyMode(e.target.checked)}
              disabled={loading || !localModel}
            />
            Nur lokal (kein Cloud-Anbieter) - Daten verlassen diesen Rechner nie
          </label>
        </>
      )}

      <div className="actions">
        <button className="btn primary" onClick={onSubmit} disabled={!canSubmit || loading}>
          {loading ? "Analysiere Anforderung…" : "Anforderung analysieren"}
        </button>
        {!canSubmit && !loading && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Zuerst ein Repository analysieren oder Greenfield wählen, dann Titel und Beschreibung ausfüllen.
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
