import { useEffect, useState } from "react";
import { ApiError, listRepositorySnapshots } from "../api/client";
import type { RepositorySnapshotSummary } from "../types";

interface Props {
  activeSnapshotId: string | null;
  onUse: (id: string) => void;
  refreshToken: number;
}

export function RepositoryPicker({ activeSnapshotId, onUse, refreshToken }: Props) {
  const [entries, setEntries] = useState<RepositorySnapshotSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listRepositorySnapshots()
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
  }, [refreshToken]);

  // A selection made elsewhere (e.g. after analyzing a fresh URL, which then
  // shows up here too) should collapse the list to just the active row, same
  // as picking one from this list directly.
  useEffect(() => {
    if (activeSnapshotId) setExpanded(false);
  }, [activeSnapshotId]);

  if (!loading && !error && entries.length === 0) return null;

  const activeEntry = entries.find((e) => e.id === activeSnapshotId) ?? null;

  function handleUse(id: string) {
    onUse(id);
    setExpanded(false);
  }

  if (!expanded && activeEntry) {
    return (
      <div className="repo-picker">
        <div className="repo-picker-row active repo-picker-active-summary">
          <div className="repo-picker-info">
            <div className="repo-picker-name">
              ✓ {activeEntry.repositoryUrl.replace(/^https?:\/\//, "")} @ {activeEntry.branch}
            </div>
            <div className="repo-picker-meta">
              {activeEntry.commitSha?.slice(0, 10)} ·{" "}
              {activeEntry.analyzedAt ? new Date(activeEntry.analyzedAt).toLocaleString("de-DE") : "–"}
            </div>
          </div>
          <button className="btn secondary" onClick={() => setExpanded(true)}>
            Repository wechseln
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="repo-picker">
      <button className="repo-picker-toggle" onClick={() => setExpanded((v) => !v)}>
        {expanded ? "▾" : "▸"} Bereits analysierte Repositories wiederverwenden
        {entries.length > 0 ? ` (${entries.length})` : ""}
      </button>

      {expanded && (
        <div className="repo-picker-body">
          {loading && <p style={{ fontSize: 12, color: "var(--muted)" }}>Lade…</p>}
          {error && <div className="notice error">{error}</div>}
          {entries.map((entry) => (
            <div className={`repo-picker-row ${entry.id === activeSnapshotId ? "active" : ""}`} key={entry.id}>
              <div className="repo-picker-info">
                <div className="repo-picker-name">
                  {entry.repositoryUrl.replace(/^https?:\/\//, "")} @ {entry.branch}
                </div>
                <div className="repo-picker-meta">
                  {entry.commitSha?.slice(0, 10)} ·{" "}
                  {entry.analyzedAt ? new Date(entry.analyzedAt).toLocaleString("de-DE") : "–"}
                </div>
                {entry.profileSummary && <div className="repo-picker-summary">{entry.profileSummary}</div>}
              </div>
              <button className="btn secondary" onClick={() => handleUse(entry.id)}>
                {entry.id === activeSnapshotId ? "Aktiv" : "Verwenden"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
