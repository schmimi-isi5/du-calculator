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

const STATUS_VARIANT_COLOR: Record<string, string> = {
  idle: "var(--muted)",
  progress: "var(--teal)",
  success: "var(--green)",
  warn: "var(--warn)",
  error: "var(--danger)",
};

/** Proportional horizontal stacked bar - one segment per category, colored by the same status-pill variant used elsewhere, so a status always has the same color whether shown as a pill, a chip, or a chart segment. */
function StackedBar({ segments }: { segments: { key: string; label: string; count: number; variant: string }[] }) {
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  if (total === 0) return null;
  return (
    <div>
      <div className="stacked-bar">
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <div
              key={s.key}
              className="stacked-bar-segment"
              style={{ width: `${(s.count / total) * 100}%`, background: STATUS_VARIANT_COLOR[s.variant] ?? "var(--muted)" }}
              title={`${s.label}: ${s.count}`}
            />
          ))}
      </div>
      <div className="stacked-bar-legend">
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <span className="stacked-bar-legend-item" key={s.key}>
              <span className="stacked-bar-legend-dot" style={{ background: STATUS_VARIANT_COLOR[s.variant] ?? "var(--muted)" }} />
              {s.label}: {s.count} ({Math.round((s.count / total) * 100)}%)
            </span>
          ))}
      </div>
    </div>
  );
}

/** Horizontal bar list, one row per item, bar length proportional to the largest value in the list - used for cost/usage-by-model, where an absolute scale would make a small model invisible. */
function BarChartList({ rows }: { rows: { key: string; label: string; value: number; displayValue: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="bar-chart-list">
      {rows.map((r) => (
        <div className="bar-chart-row" key={r.key}>
          <span className="bar-chart-row-label" title={r.label}>
            {r.label}
          </span>
          <div className="bar-chart-track">
            <div className="bar-chart-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="bar-chart-row-value">{r.displayValue}</span>
        </div>
      ))}
    </div>
  );
}

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

          <div className="row" style={{ marginTop: 16, alignItems: "stretch" }}>
            {scoringStats && scoringStats.total > 0 && (
              <div className="card">
                <h3 style={{ margin: "0 0 10px" }}>Bewertungsstatus im Überblick</h3>
                <StackedBar
                  segments={Object.entries(scoringStats.byStatus).map(([status, count]) => ({
                    key: status,
                    label: SCORING_STATUS_META[status as keyof typeof SCORING_STATUS_META]?.label ?? status,
                    count,
                    variant: SCORING_STATUS_META[status as keyof typeof SCORING_STATUS_META]?.variant ?? "idle",
                  }))}
                />
              </div>
            )}

            {repoStats && repoStats.total > 0 && (
              <div className="card">
                <h3 style={{ margin: "0 0 10px" }}>Repositories: bestehend vs. Greenfield</h3>
                <StackedBar
                  segments={[
                    { key: "EXISTING_SYSTEM", label: "Bestehendes Repository", count: repoStats.byMode.EXISTING_SYSTEM ?? 0, variant: "progress" },
                    { key: "GREENFIELD", label: "Greenfield", count: repoStats.byMode.GREENFIELD ?? 0, variant: "success" },
                  ]}
                />
              </div>
            )}
          </div>

          {topModels.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ margin: "0 0 10px" }}>KI-Kosten nach Modell (letzte {USAGE_WINDOW_DAYS} Tage)</h3>
              <BarChartList
                rows={topModels.map((m) => ({
                  key: m.key,
                  label: m.key,
                  value: m.costUsd ?? m.requestCount,
                  displayValue: m.costUsd !== null ? formatCost(m.costUsd) : `${m.requestCount} Aufrufe (Kosten unbekannt)`,
                }))}
              />
              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
                Balkenlänge nach Kosten, sofern bekannt - sonst nach Anzahl Aufrufe.
              </p>
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
