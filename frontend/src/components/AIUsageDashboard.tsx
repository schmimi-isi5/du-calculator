import { useEffect, useMemo, useState } from "react";
import { ApiError, getAIUsageConfig, getAIUsageSummary } from "../api/client";
import type { AIUsageBreakdownEntry, AIUsageConfig, AIUsageSummary } from "../types";

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

export function AIUsageDashboard() {
  const [preset, setPreset] = useState<Preset>("today");
  const [customFrom, setCustomFrom] = useState(toDateInputValue(new Date()));
  const [customTo, setCustomTo] = useState(toDateInputValue(new Date()));
  const [summary, setSummary] = useState<AIUsageSummary | null>(null);
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
    getAIUsageSummary(range.from, range.to)
      .then((result) => {
        if (!cancelled) setSummary(result);
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
        </>
      )}
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
