import { useEffect, useState } from "react";
import {
  ApiError,
  getAIUsageSummary,
  getRepositoryStats,
  getRequirementStats,
  getScoringHistory,
  listRepositorySnapshots,
} from "../api/client";
import { REPOSITORY_STATUS_META, SCORING_STATUS_META } from "../statusMeta";
import type {
  AIUsageSummary,
  RepositorySnapshotSummary,
  RepositoryStats,
  ScoringHistoryEntry,
  ScoringStats,
} from "../types";

interface Props {
  onStartNewAssessment: () => void;
  onUseRepository: (id: string) => void;
  onSelectHistoryEntry: (id: string) => void;
  onOpenUsageTab: () => void;
}

const RECENT_LIMIT = 5;
// A 30-day window keeps the KI-Kosten KPI meaningful without a second
// date-range picker on the Dashboard - the "KI-Kosten" tab itself has the
// full, filterable history (see AIUsageDashboard.tsx).
const USAGE_WINDOW_DAYS = 30;

function formatCost(costUsd: number | null): string {
  if (costUsd === null) return "unbekannt";
  return `$${costUsd.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)} Mio.`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)} Tsd.`;
  return tokens.toLocaleString("de-DE");
}

// Only status changes are ERROR (the AI call itself failed) or everything
// else (the run completed, whether or not it needed clarification/
// decomposition/assumptions) - a "success rate" here means "did the system
// manage to produce SOME result", not "was every DU estimate final".
function successRate(stats: ScoringStats): number | null {
  if (stats.total === 0) return null;
  const errorCount = stats.byStatus.ERROR ?? 0;
  return (stats.total - errorCount) / stats.total;
}

export function Dashboard({ onStartNewAssessment, onUseRepository, onSelectHistoryEntry, onOpenUsageTab }: Props) {
  const [repoStats, setRepoStats] = useState<RepositoryStats | null>(null);
  const [scoringStats, setScoringStats] = useState<ScoringStats | null>(null);
  const [usage, setUsage] = useState<AIUsageSummary | null>(null);
  const [recentRepos, setRecentRepos] = useState<RepositorySnapshotSummary[]>([]);
  const [recentScorings, setRecentScorings] = useState<ScoringHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - USAGE_WINDOW_DAYS);

    setLoading(true);
    setError(null);
    Promise.all([
      getRepositoryStats(),
      getRequirementStats(),
      getAIUsageSummary(from, to),
      listRepositorySnapshots(RECENT_LIMIT),
      getScoringHistory(),
    ])
      .then(([repos, scorings, usageSummary, repoList, historyList]) => {
        if (cancelled) return;
        setRepoStats(repos);
        setScoringStats(scorings);
        setUsage(usageSummary);
        setRecentRepos(repoList);
        setRecentScorings(historyList.slice(0, RECENT_LIMIT));
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
    // Snapshot on mount only - no live polling (see UX decision: manual reload is enough).
  }, []);

  const rate = scoringStats ? successRate(scoringStats) : null;
  const topModels = [...(usage?.byModel ?? [])].sort((a, b) => b.requestCount - a.requestCount).slice(0, 5);

  return (
    <div>
      <div className="card dashboard-hero">
        <div>
          <h2 style={{ margin: 0 }}>Willkommen zurück</h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Überblick über Repositories, Anforderungsanalysen und KI-Nutzung.
          </p>
        </div>
        <button className="btn primary" onClick={onStartNewAssessment}>
          + Neue Bewertung starten
        </button>
      </div>

      {loading && <p style={{ fontSize: 13, color: "var(--muted)" }}>Lade Übersicht…</p>}
      {error && <div className="notice error">{error}</div>}

      {!loading && !error && (
        <>
          <div className="usage-kpis">
            <div className="usage-kpi">
              <small>Repositories</small>
              <b>{repoStats?.total ?? 0}</b>
              <div className="usage-kpi-note">
                davon {repoStats?.byMode.GREENFIELD ?? 0} Greenfield (ohne Repository)
              </div>
            </div>
            <div className="usage-kpi">
              <small>Anforderungsanalysen</small>
              <b>{scoringStats?.total ?? 0}</b>
            </div>
            <div className="usage-kpi">
              <small>Erfolgsquote (Bewertungen)</small>
              <b>{rate !== null ? `${Math.round(rate * 100)}%` : "–"}</b>
              <div className="usage-kpi-note">Anteil ohne technischen Fehler (Status ≠ Fehler)</div>
            </div>
            <div className="usage-kpi usage-kpi-clickable" onClick={onOpenUsageTab}>
              <small>KI-Kosten (letzte {USAGE_WINDOW_DAYS} Tage)</small>
              <b>{usage ? formatCost(usage.costUsd) : "–"}</b>
              <div className="usage-kpi-note">
                {usage ? `${formatTokens(usage.inputTokens + usage.outputTokens)} Token · Details →` : ""}
              </div>
            </div>
          </div>

          {scoringStats && scoringStats.total > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ margin: "0 0 10px" }}>Bewertungsstatus im Überblick</h3>
              <div className="dashboard-status-chips">
                {Object.entries(scoringStats.byStatus).map(([status, count]) => (
                  <span key={status} className={`status-pill ${SCORING_STATUS_META[status as keyof typeof SCORING_STATUS_META]?.variant ?? "idle"}`}>
                    {SCORING_STATUS_META[status as keyof typeof SCORING_STATUS_META]?.label ?? status}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {topModels.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ margin: "0 0 10px" }}>Verwendete Modelle (letzte {USAGE_WINDOW_DAYS} Tage)</h3>
              <div className="dashboard-status-chips">
                {topModels.map((m) => (
                  <span className="tag" key={m.key}>
                    {m.key} · {m.requestCount} Aufrufe
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="row" style={{ marginTop: 16, alignItems: "stretch" }}>
            <div className="card">
              <h3 style={{ margin: "0 0 10px" }}>Zuletzt analysierte Repositories</h3>
              {recentRepos.length === 0 && (
                <p style={{ fontSize: 13, color: "var(--muted)" }}>Noch keine Repositories analysiert.</p>
              )}
              <ul className="dashboard-list">
                {recentRepos.map((repo) => (
                  <li key={repo.id}>
                    <button className="dashboard-list-item" onClick={() => onUseRepository(repo.id)}>
                      <span className="history-repo">{repo.repositoryUrl}</span>
                      <span className={`status-pill ${REPOSITORY_STATUS_META[repo.status].variant}`}>
                        {repo.mode === "GREENFIELD" ? "Greenfield" : REPOSITORY_STATUS_META[repo.status].label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card">
              <h3 style={{ margin: "0 0 10px" }}>Letzte Bewertungen</h3>
              {recentScorings.length === 0 && (
                <p style={{ fontSize: 13, color: "var(--muted)" }}>Noch keine Bewertungen durchgeführt.</p>
              )}
              <ul className="dashboard-list">
                {recentScorings.map((entry) => (
                  <li key={entry.id}>
                    <button className="dashboard-list-item" onClick={() => onSelectHistoryEntry(entry.id)}>
                      <span className="history-repo">{entry.requirementTitle}</span>
                      <span className={`status-pill ${SCORING_STATUS_META[entry.status].variant}`}>
                        {entry.duClass ?? SCORING_STATUS_META[entry.status].label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
