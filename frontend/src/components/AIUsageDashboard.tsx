import { useEffect, useMemo, useState } from "react";
import { ApiError, getAIUsageConfig, getAIUsageLog, getAIUsageSummary } from "../api/client";
import type { AIUsageBreakdownEntry, AIUsageConfig, AIUsageLogEntry, AIUsageSummary } from "../types";

type Preset = "today" | "yesterday" | "last7days" | "thisMonth" | "custom";

const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Heute" },
  { key: "yesterday", label: "Gestern" },
  { key: "last7days", label: "Letzte 7 Tage" },
  { key: "thisMonth", label: "Dieser Monat" },
  { key: "custom", label: "Zeitraum wählen" },
];

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function presetRange(preset: Preset, customFrom: string, customTo: string): { from: Date; to: Date } | null {
  const now = new Date();
  const todayStart = startOfDay(now);

  switch (preset) {
    case "today":
      return { from: todayStart, to: now };
    case "yesterday": {
      const from = new Date(todayStart);
      from.setDate(from.getDate() - 1);
      return { from, to: todayStart };
    }
    case "last7days": {
      const from = new Date(todayStart);
      from.setDate(from.getDate() - 7);
      return { from, to: now };
    }
    case "thisMonth": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from, to: now };
    }
    case "custom": {
      if (!customFrom || !customTo) return null;
      const from = startOfDay(new Date(customFrom));
      const to = new Date(customTo);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }
  }
}

function formatCost(costUsd: number | null): string {
  if (costUsd === null) return "unbekannt";
  return `$${costUsd.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function formatTokens(tokens: number): string {
  return tokens.toLocaleString("de-DE");
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadUsageLogCsv(entries: AIUsageLogEntry[]): void {
  const header = [
    "Zeitpunkt",
    "Bezug",
    "Vorgang",
    "Provider",
    "Modell",
    "Input-Token",
    "Output-Token",
    "Cache geschrieben",
    "Cache gelesen",
    "Kosten (USD)",
  ];
  const rows = entries.map((entry) => [
    entry.createdAt,
    entry.label ?? "",
    entry.operation,
    entry.provider,
    entry.model,
    entry.inputTokens,
    entry.outputTokens,
    entry.cacheCreationInputTokens,
    entry.cacheReadInputTokens,
    entry.costUsd ?? "",
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ki-kosten-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function AIUsageDashboard() {
  const [preset, setPreset] = useState<Preset>("today");
  const [customFrom, setCustomFrom] = useState(toDateInputValue(new Date()));
  const [customTo, setCustomTo] = useState(toDateInputValue(new Date()));
  const [summary, setSummary] = useState<AIUsageSummary | null>(null);
  const [logEntries, setLogEntries] = useState<AIUsageLogEntry[]>([]);
  const [aiConfig, setAiConfig] = useState<AIUsageConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => presetRange(preset, customFrom, customTo), [preset, customFrom, customTo]);

  useEffect(() => {
    getAIUsageConfig()
      .then(setAiConfig)
      .catch(() => {
        // Non-critical - the dashboard still works without this label.
      });
  }, []);

  useEffect(() => {
    if (!range) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getAIUsageSummary(range.from, range.to), getAIUsageLog(range.from, range.to)])
      .then(([summaryResult, logResult]) => {
        if (!cancelled) {
          setSummary(summaryResult);
          setLogEntries(logResult);
        }
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
  }, [range]);

  return (
    <div className="card">
      <div className="actions" style={{ marginTop: 0, justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>KI-Kosten &amp; Token-Verbrauch</h2>
        {aiConfig && (
          <span className="tag">
            Aktiv: {aiConfig.provider} / {aiConfig.model}
          </span>
        )}
      </div>

      <div className="tabs" style={{ marginBottom: preset === "custom" ? 10 : 16 }}>
        {PRESETS.map((p) => (
          <button key={p.key} className={preset === p.key ? "active" : ""} onClick={() => setPreset(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="row" style={{ marginBottom: 16 }}>
          <div>
            <label htmlFor="usageFrom">Von</label>
            <input id="usageFrom" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="usageTo">Bis</label>
            <input id="usageTo" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        </div>
      )}

      {loading && <p style={{ fontSize: 13, color: "var(--muted)" }}>Lade Nutzungsdaten…</p>}
      {error && <div className="notice error">{error}</div>}

      {!loading && !error && summary && (
        <>
          <div className="usage-kpis">
            <div className="usage-kpi">
              <small>Kosten</small>
              <b>{formatCost(summary.costUsd)}</b>
              {summary.unknownCostRequestCount > 0 && (
                <div className="usage-kpi-note">
                  {summary.unknownCostRequestCount} Aufruf(e) ohne bekannten Preis nicht enthalten
                </div>
              )}
            </div>
            <div className="usage-kpi">
              <small>Anfragen</small>
              <b>{summary.requestCount}</b>
            </div>
            <div className="usage-kpi">
              <small>Input-Token</small>
              <b>{formatTokens(summary.inputTokens)}</b>
            </div>
            <div className="usage-kpi">
              <small>Output-Token</small>
              <b>{formatTokens(summary.outputTokens)}</b>
            </div>
            <div className="usage-kpi">
              <small>Cache-Schreibvorgänge</small>
              <b>{formatTokens(summary.cacheCreationInputTokens)}</b>
            </div>
            <div className="usage-kpi">
              <small>Cache-Treffer</small>
              <b>{formatTokens(summary.cacheReadInputTokens)}</b>
            </div>
          </div>

          {summary.requestCount === 0 && (
            <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 14 }}>
              Keine KI-Aufrufe im gewählten Zeitraum.
            </p>
          )}

          {summary.byModel.length > 0 && (
            <>
              <div className="context-section-title" style={{ marginTop: 18 }}>
                Nach Modell
              </div>
              <UsageBreakdownTable entries={summary.byModel} />
            </>
          )}

          {summary.byOperation.length > 0 && (
            <>
              <div className="context-section-title" style={{ marginTop: 18 }}>
                Nach Vorgang
              </div>
              <UsageBreakdownTable entries={summary.byOperation} />
            </>
          )}

          {logEntries.length > 0 && (
            <>
              <div
                className="actions"
                style={{ marginTop: 18, marginBottom: 0, justifyContent: "space-between" }}
              >
                <div className="context-section-title" style={{ marginTop: 0 }}>
                  Detailliertes Log ({logEntries.length})
                </div>
                <button className="btn secondary" onClick={() => downloadUsageLogCsv(logEntries)}>
                  CSV exportieren
                </button>
              </div>
              <UsageLogTable entries={logEntries} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function UsageLogTable({ entries }: { entries: AIUsageLogEntry[] }) {
  return (
    <div className="usage-table-wrap">
      <table className="usage-table">
        <thead>
          <tr>
            <th>Zeitpunkt</th>
            <th>Bezug</th>
            <th>Vorgang</th>
            <th>Modell</th>
            <th>Input</th>
            <th>Output</th>
            <th>Cache geschrieben</th>
            <th>Cache gelesen</th>
            <th>Kosten</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{new Date(entry.createdAt).toLocaleString("de-DE")}</td>
              <td className="history-repo">{entry.label ?? "–"}</td>
              <td>{entry.operation}</td>
              <td>
                {entry.provider} / {entry.model}
              </td>
              <td>{formatTokens(entry.inputTokens)}</td>
              <td>{formatTokens(entry.outputTokens)}</td>
              <td>{formatTokens(entry.cacheCreationInputTokens)}</td>
              <td>{formatTokens(entry.cacheReadInputTokens)}</td>
              <td>{formatCost(entry.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsageBreakdownTable({ entries }: { entries: AIUsageBreakdownEntry[] }) {
  return (
    <div className="usage-table-wrap">
      <table className="usage-table">
        <thead>
          <tr>
            <th></th>
            <th>Anfragen</th>
            <th>Input</th>
            <th>Output</th>
            <th>Cache geschrieben</th>
            <th>Cache gelesen</th>
            <th>Kosten</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.key}>
              <td>{entry.key}</td>
              <td>{entry.requestCount}</td>
              <td>{formatTokens(entry.inputTokens)}</td>
              <td>{formatTokens(entry.outputTokens)}</td>
              <td>{formatTokens(entry.cacheCreationInputTokens)}</td>
              <td>{formatTokens(entry.cacheReadInputTokens)}</td>
              <td>{formatCost(entry.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
