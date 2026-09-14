interface Props {
  title: string;
  description: string;
  acceptanceCriteria: string;
  constraints: string;
  canSubmit: boolean;
  loading: boolean;
  onChangeTitle: (v: string) => void;
  onChangeDescription: (v: string) => void;
  onChangeAcceptanceCriteria: (v: string) => void;
  onChangeConstraints: (v: string) => void;
  onSubmit: () => void;
}

export function RequirementPanel({
  title,
  description,
  acceptanceCriteria,
  constraints,
  canSubmit,
  loading,
  onChangeTitle,
  onChangeDescription,
  onChangeAcceptanceCriteria,
  onChangeConstraints,
  onSubmit,
}: Props) {
  return (
    <div className="card">
      <h2>2 · Anforderung</h2>

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

      <div className="actions">
        <button className="btn primary" onClick={onSubmit} disabled={!canSubmit || loading}>
          {loading ? "Bewerte…" : "KI-Bewertung starten"}
        </button>
        {!canSubmit && !loading && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Zuerst ein Repository erfolgreich analysieren.
          </span>
        )}
      </div>
    </div>
  );
}
