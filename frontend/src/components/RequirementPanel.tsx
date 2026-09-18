import { useEffect, useState } from "react";
import { ApiError, getOllamaStatus, getSelectableModels } from "../api/client";
import { AI_PROVIDER_LABELS, MODEL_CATEGORY_LABELS, QUALITY_LEVEL_META, QUALITY_LEVEL_ORDER } from "../types";
import type { ModelCategory, QualityLevel, SelectableModel } from "../types";

const AUTO_OPTION_ID = "auto";

// Visual cost/quality cue per category, reusing the app's existing three
// accent colors rather than inventing a new palette - premium (gold, "costs
// more"), balanced/coding (teal, the default brand color), budget/
// cost-performance/local (green, "cheap or free"). Shown as a left border
// on each model button plus a small dot in its label.
const CATEGORY_ACCENT: Record<ModelCategory, string> = {
  premium: "var(--warn)",
  balanced: "var(--teal)",
  coding: "var(--teal)",
  budget: "var(--green)",
  "cost-performance": "var(--green)",
  local: "var(--green)",
};

function formatModelPrice(m: SelectableModel): string | null {
  if (m.inputPricePerMillion === undefined || m.outputPricePerMillion === undefined) return null;
  return `$${m.inputPricePerMillion.toFixed(2)}/$${m.outputPricePerMillion.toFixed(2)} pro Mio. Token`;
}

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

  // Only models this deployment can actually call right now - no API key
  // configured, or a local model whose Ollama server isn't reachable, are
  // filtered out entirely instead of shown disabled, so the picker isn't
  // cluttered with options nobody can pick. The count is still surfaced
  // below so an operator knows more become available via the Einstellungen tab.
  const usableModels = selectableModels.filter((m) => m.available && (!m.local || ollamaReachable !== false));
  const hiddenCount = selectableModels.length - usableModels.length;
  const localModel = usableModels.find((m) => m.local);

  function isDisabled(m: SelectableModel): boolean {
    if (privacyMode === "local-only" && !m.local) return true;
    return false;
  }

  function disabledReason(m: SelectableModel): string | undefined {
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
        className="textarea-large"
        value={description}
        onChange={(e) => onChangeDescription(e.target.value)}
        placeholder="Was soll umgesetzt werden, und warum? Je konkreter, desto weniger Rückfragen."
      />

      <div className="row">
        <div>
          <label htmlFor="reqAcceptance">Akzeptanzkriterien (eine pro Zeile)</label>
          <textarea
            id="reqAcceptance"
            className="textarea-large"
            value={acceptanceCriteria}
            onChange={(e) => onChangeAcceptanceCriteria(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="reqConstraints">Randbedingungen (eine pro Zeile, optional)</label>
          <textarea
            id="reqConstraints"
            className="textarea-large"
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

      {usableModels.length > 0 && (
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
            {usableModels.map((m) => {
              const disabled = loading || isDisabled(m);
              const reason = disabledReason(m);
              const price = formatModelPrice(m);
              const subtitle = [
                // OpenRouter's own model catalog isn't fixed, so its
                // display name alone doesn't say where the model runs -
                // unlike e.g. "Claude Opus 5", which already implies Anthropic.
                m.provider === "openrouter" ? AI_PROVIDER_LABELS.openrouter : null,
                m.local ? "keine API-Kosten" : price,
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
                  style={{ borderLeft: `3px solid ${CATEGORY_ACCENT[m.category]}` }}
                >
                  <span className="quality-level-option-label">
                    <span className="model-category-dot" style={{ background: CATEGORY_ACCENT[m.category] }} />
                    {m.displayName}
                    <span className="model-category-badge">{MODEL_CATEGORY_LABELS[m.category]}</span>
                  </span>
                  <span className="quality-level-option-description">{reason ?? subtitle}</span>
                </button>
              );
            })}
          </div>
          {hiddenCount > 0 && (
            <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              {hiddenCount} weitere{hiddenCount === 1 ? "s" : ""} Modell{hiddenCount === 1 ? "" : "e"} ohne konfigurierten
              Zugang ausgeblendet - einrichtbar unter "Einstellungen".
            </p>
          )}

          <div className="privacy-mode-callout">
            <label>
              <input
                type="checkbox"
                checked={privacyMode === "local-only"}
                onChange={(e) => handleTogglePrivacyMode(e.target.checked)}
                disabled={loading || !localModel}
              />
              <span>
                <strong>🔒 Nur lokal verarbeiten</strong>
                <span className="privacy-mode-callout-subtitle">
                  Kein Cloud-Anbieter - Daten verlassen diesen Rechner nie.
                </span>
              </span>
            </label>
          </div>
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
