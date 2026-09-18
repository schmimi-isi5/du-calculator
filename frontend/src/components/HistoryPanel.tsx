import { useEffect, useState } from "react";
import { ApiError, getScoringHistory } from "../api/client";
import type { ScoringHistoryEntry } from "../types";
import { SCORING_STATUS_META } from "../statusMeta";

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
  refreshToken: number;
}

export function HistoryPanel({ selectedId, onSelect, refreshToken }: Props) {
  const [entries, setEntries] = useState<ScoringHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Expanded by default only when nothing is picked yet (including on
  // mount, e.g. arriving here fresh vs. via the Dashboard's "letzte
  // Bewertungen" link with a selection already made). Once a row is
  // selected, the list collapses to a one-line summary so the
  // Management-Report becomes visible right away instead of requiring a
  // scroll past the whole table - "Andere Bewertung wählen" brings it back.
  const [expanded, setExpanded] = useState(selectedId === null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getScoringHistory()
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Unerwarteter Fehler.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // refreshToken bump triggers a re-fetch after a new scoring completes.
  }, [refreshToken]);

  function handleSelect(id: string) {
    onSelect(id);
    setExpanded(false);
  }

  const selectedEntry = entries.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="card">
      <div className="actions" style={{ marginTop: 0, justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Historie · Requirement → DU Entscheidungen</h2>
        {entries.length > 0 && (
          <button className="btn" onClick={() => setExpanded((e) => !e)}>
            {expanded ? "Liste einklappen" : "Andere Bewertung wählen"}
          </button>
        )}
      </div>

      {loading && <p style={{ fontSize: 13, color: "var(--muted)" }}>Lade Historie…</p>}
      {error && <div className="notice error">{error}</div>}
      {!loading && !error && entries.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--muted)" }}>Noch keine gespeicherten Bewertungen.</p>
      )}

      {!expanded && selectedEntry && (
        <div className="history-selected-summary">
          <span className="history-repo">{selectedEntry.requirementTitle}</span>
          <span className={`status-pill ${SCORING_STATUS_META[selectedEntry.status].variant}`}>
            {SCORING_STATUS_META[selectedEntry.status].label}
          </span>
          <span style={{ color: "var(--muted)" }}>{new Date(selectedEntry.createdAt).toLocaleString("de-DE")}</span>
        </div>
      )}

      {expanded && entries.length > 0 && (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Requirement</th>
                <th>Repository</th>
                <th>Status</th>
                <th>Klasse</th>
                <th>DU</th>
                <th>Preis</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const meta = SCORING_STATUS_META[entry.status];
                return (
                  <tr
                    key={entry.id}
                    className={entry.id === selectedId ? "selected" : ""}
                    onClick={() => handleSelect(entry.id)}
                  >
                    <td>{new Date(entry.createdAt).toLocaleString("de-DE")}</td>
                    <td title={entry.requirementTitle}>
                      <span className="history-cell-ellipsis">{entry.requirementTitle}</span>
                    </td>
                    <td title={`${entry.repositoryUrl.replace(/^https?:\/\//, "")} @ ${entry.branch}`}>
                      <span className="history-cell-ellipsis">
                        {entry.repositoryUrl.replace(/^https?:\/\//, "")} @ {entry.branch}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill ${meta.variant}`}>{meta.label}</span>
                    </td>
                    <td>{entry.duClass ?? "–"}</td>
                    <td>{entry.developmentUnits ?? "–"}</td>
                    <td>{entry.price !== null ? `${entry.price.toLocaleString("de-DE")} €` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
