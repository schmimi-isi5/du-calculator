import { useEffect, useState } from "react";
import type { RequirementContext } from "../types";

interface Props {
  context: RequirementContext;
  saving: boolean;
  onSave: (update: { title: string; acceptanceCriteria: string[]; constraints: string[] }) => void;
}

function linesToList(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Titel/Akzeptanzkriterien/Randbedingungen arrive here already filled in by
// the AI (see backend api/requirementContextService.ts
// applyNormalizationToRequirement) - this is purely a review/edit step, not
// a fresh AI call, so saving is instant.
export function RequirementReviewPanel({ context, saving, onSave }: Props) {
  const [title, setTitle] = useState(context.requirement.title);
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(context.requirement.acceptanceCriteria.join("\n"));
  const [constraints, setConstraints] = useState(context.requirement.constraints.join("\n"));
  const [dirty, setDirty] = useState(false);

  // A fresh context (new resolution) replaces these entirely - drop any
  // local draft so it never carries over into an unrelated requirement.
  useEffect(() => {
    setTitle(context.requirement.title);
    setAcceptanceCriteria(context.requirement.acceptanceCriteria.join("\n"));
    setConstraints(context.requirement.constraints.join("\n"));
    setDirty(false);
  }, [context.id, context.requirement.title, context.requirement.acceptanceCriteria, context.requirement.constraints]);

  function markDirty<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
    };
  }

  function handleSave() {
    onSave({
      title: title.trim(),
      acceptanceCriteria: linesToList(acceptanceCriteria),
      constraints: linesToList(constraints),
    });
  }

  return (
    <div className="card">
      <h2 style={{ margin: "0 0 4px" }}>Von der KI abgeleitet</h2>
      <p className="panel-intro">
        Titel, Akzeptanzkriterien und Randbedingungen wurden automatisch aus Ihrer Anforderung erstellt - bei Bedarf
        hier anpassen, bevor es zur Bewertung geht.
      </p>

      <label htmlFor="reviewTitle">Titel</label>
      <input id="reviewTitle" value={title} onChange={(e) => markDirty(setTitle)(e.target.value)} />

      <label htmlFor="reviewAcceptance">Akzeptanzkriterien (eine pro Zeile)</label>
      <textarea
        id="reviewAcceptance"
        className="textarea-large"
        value={acceptanceCriteria}
        onChange={(e) => markDirty(setAcceptanceCriteria)(e.target.value)}
      />

      <label htmlFor="reviewConstraints">Randbedingungen (eine pro Zeile)</label>
      <textarea
        id="reviewConstraints"
        value={constraints}
        onChange={(e) => markDirty(setConstraints)(e.target.value)}
      />

      <div className="actions">
        <button className="btn primary" onClick={handleSave} disabled={saving || !dirty || title.trim().length === 0}>
          {saving ? "Speichert…" : "Änderungen übernehmen"}
        </button>
        {!dirty && <span style={{ fontSize: 12, color: "var(--muted)" }}>Aktuell übernommen.</span>}
      </div>
    </div>
  );
}
