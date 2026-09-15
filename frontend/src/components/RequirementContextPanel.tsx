import { useEffect, useState } from "react";
import type { Assumption, AssumptionAction, Clarification, RequirementContext } from "../types";

interface Props {
  context: RequirementContext;
  busy: boolean;
  onAnswerClarifications: (answers: { clarificationId: string; answer: string }[]) => void;
  onAssumptionAction: (assumptionId: string, action: AssumptionAction, editedText?: string) => void;
}

export function RequirementContextPanel({ context, busy, onAnswerClarifications, onAssumptionAction }: Props) {
  const pending = context.clarifications
    .filter((c) => c.status === "PENDING")
    .sort((a, b) => a.priority - b.priority);

  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // A fresh resolution round can replace the whole pending set with
  // different questions (new ids) - drop drafts for a different context so
  // they never carry over into an unrelated round.
  useEffect(() => {
    setDrafts({});
  }, [context.id]);

  const filledAnswers = pending
    .map((c) => ({ clarificationId: c.id, answer: (drafts[c.id] ?? "").trim() }))
    .filter((a) => a.answer.length > 0);

  return (
    <div className="card">
      <h2>Wissensstand zur Anforderung</h2>

      {busy && (
        <div className="notice progress">
          Wird verarbeitet … Der Wissensstand wird von der KI neu bewertet, das kann bis zu ein bis zwei
          Minuten dauern.
        </div>
      )}

      {pending.length > 0 && (
        <div className="context-section">
          <div className="context-section-title">Klärungsbedarf</div>
          <p className="context-hint">
            Nur diese {pending.length} Frage{pending.length > 1 ? "n" : ""} beeinflusst die Bewertung wesentlich -
            alles andere wurde automatisch angenommen. Beantworte so viele wie du kannst und übernimm sie
            gemeinsam.
          </p>
          {pending.map((clarification) => (
            <ClarificationQuestion
              key={clarification.id}
              clarification={clarification}
              value={drafts[clarification.id] ?? ""}
              disabled={busy}
              onChange={(value) => setDrafts((prev) => ({ ...prev, [clarification.id]: value }))}
            />
          ))}
          <div className="actions">
            <button
              className="btn primary"
              disabled={busy || filledAnswers.length === 0}
              onClick={() => onAnswerClarifications(filledAnswers)}
            >
              {busy
                ? "Wird verarbeitet…"
                : `Antworten übernehmen${filledAnswers.length > 0 ? ` (${filledAnswers.length})` : ""}`}
            </button>
          </div>
        </div>
      )}

      {context.knownFacts.length > 0 && (
        <div className="context-section">
          <details className="inline-details" open={pending.length === 0}>
            <summary>Bekannte Fakten ({context.knownFacts.length})</summary>
            <ul className="context-list">
              {context.knownFacts.map((fact) => (
                <li key={fact.id}>
                  <span className="context-source-tag">{fact.source}</span> <strong>{fact.topic}:</strong>{" "}
                  {fact.fact}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {context.assumptions.length > 0 && (
        <div className="context-section">
          <details className="inline-details" open={pending.length === 0}>
            <summary>Getroffene Annahmen ({context.assumptions.length})</summary>
            {context.assumptions.map((assumption) => (
              <AssumptionRow
                key={assumption.id}
                assumption={assumption}
                busy={busy}
                onAction={(action, editedText) => onAssumptionAction(assumption.id, action, editedText)}
              />
            ))}
          </details>
        </div>
      )}
    </div>
  );
}

function ClarificationQuestion({
  clarification,
  value,
  disabled,
  onChange,
}: {
  clarification: Clarification;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="clarification-question">
      <div className="clarification-question-text">{clarification.question}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Antwort eingeben…"
        rows={2}
      />
    </div>
  );
}

function AssumptionRow({
  assumption,
  busy,
  onAction,
}: {
  assumption: Assumption;
  busy: boolean;
  onAction: (action: AssumptionAction, editedText?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(assumption.assumption);

  return (
    <div className={`assumption-row status-${assumption.status}`}>
      <div className="assumption-top">
        <strong>{assumption.topic}</strong>
        <span className={`criticality-badge ${assumption.criticality}`}>{assumption.criticality}</span>
        <span className="assumption-status-label">{assumption.status}</span>
      </div>

      {editing ? (
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} />
      ) : (
        <p className="assumption-text">{assumption.assumption}</p>
      )}

      <p className="assumption-reason">{assumption.reason}</p>
      <div className="assumption-meta">
        Confidence {Math.round(assumption.confidence * 100)}% · Basis: {assumption.basis.join(", ") || "–"}
      </div>

      {assumption.status !== "REJECTED" && (
        <div className="actions">
          {editing ? (
            <>
              <button
                className="btn primary"
                disabled={busy || draft.trim().length === 0}
                onClick={() => {
                  onAction("EDIT", draft.trim());
                  setEditing(false);
                }}
              >
                Speichern
              </button>
              <button className="btn secondary" disabled={busy} onClick={() => setEditing(false)}>
                Abbrechen
              </button>
            </>
          ) : (
            <>
              {assumption.status !== "CONFIRMED" && (
                <button className="btn secondary" disabled={busy} onClick={() => onAction("CONFIRM")}>
                  Bestätigen
                </button>
              )}
              <button className="btn secondary" disabled={busy} onClick={() => setEditing(true)}>
                Bearbeiten
              </button>
              <button className="btn secondary" disabled={busy} onClick={() => onAction("REJECT")}>
                Verwerfen
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
