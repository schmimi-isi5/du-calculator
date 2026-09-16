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

  return (
    <div className="card">
      <h2>Historie · Requirement → DU Entscheidungen</h2>

      {loading && <p style={{ fontSize: 13, color: "var(--muted)" }}>Lade Historie…</p>}
      {error && <div className="notice error">{error}</div>}
      {!loading && !error && entries.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--muted)" }}>Noch keine gespeicherten Bewertungen.</p>
      )}

      {entries.length > 0 && (
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
                    onClick={() => onSelect(entry.id)}
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
