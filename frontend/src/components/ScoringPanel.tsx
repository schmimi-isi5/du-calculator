import { DIMENSION_ORDER } from "../types";
import type { ScoringResult } from "../types";
import { SCORING_STATUS_META } from "../statusMeta";

interface Props {
  loading: boolean;
  result: ScoringResult | null;
}

export function ScoringPanel({ loading, result }: Props) {
  const statusMeta = SCORING_STATUS_META[loading ? "ANALYZING" : result?.status ?? "NOT_STARTED"];

  return (
    <div className="card">
      <h2>3 · AI Scoring</h2>
      <span className={`status-pill ${statusMeta.variant}`}>{statusMeta.label}</span>

      {!result && !loading && (
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>
          Noch keine Bewertung. Repository analysieren und Anforderung erfassen.
        </p>
      )}

      {result?.status === "ERROR" && result.errorMessage && (
        <div className="notice error" style={{ marginTop: 10 }}>{result.errorMessage}</div>
      )}

      {result?.status === "NEEDS_CLARIFICATION" && (
        <div className="notice" style={{ marginTop: 10 }}>
          Die Confidence ist zu gering für eine belastbare DU-Schätzung. Offene Fragen:
          <ul className="open-questions">
            {result.openQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      {result?.status === "DECOMPOSITION_REQUIRED" && (
        <div className="notice" style={{ marginTop: 10 }}>
          Diese Anforderung ist zu groß für eine einzelne DU-Schätzung (Klasse XXL). Bitte in kleinere,
          bewertbare Requirements zerlegen.
        </div>
      )}

      {result?.impactAnalysis && (
        <div className="profile-section">
          <strong style={{ fontSize: 13 }}>Impact Analysis</strong>
          <div className="impact-grid" style={{ marginTop: 8 }}>
            <ImpactBlock title="Existing" items={result.impactAnalysis.existing} />
            <ImpactBlock title="Reusable" items={result.impactAnalysis.reusable} />
            <ImpactBlock title="Modify" items={result.impactAnalysis.modify} />
            <ImpactBlock title="Create" items={result.impactAnalysis.create} />
            <ImpactBlock title="Data Changes" items={result.impactAnalysis.dataChanges} />
            <ImpactBlock title="Integrations" items={result.impactAnalysis.integrations} />
            <ImpactBlock title="Tests" items={result.impactAnalysis.tests} />
            <ImpactBlock title="Risks" items={result.impactAnalysis.risks} />
          </div>
        </div>
      )}

      {result?.dimensionScores && (
        <div style={{ marginTop: 8 }}>
          {DIMENSION_ORDER.map(([key, label, weight]) => {
            const dim = result.dimensionScores![key];
            return (
              <div className="dim" key={key}>
                <div className="dim-top">
                  <span className="dim-name">
                    {label} <span className="dim-weight">({weight}%)</span>
                  </span>
                  <span className="dim-score">{dim.score}/5</span>
                  <span className={`confidence-badge ${confidenceBucket(dim.confidence)}`}>
                    {Math.round(dim.confidence * 100)}%
                  </span>
                </div>
                <div className="dim-rationale">{dim.rationale}</div>
                {dim.evidence.map((ev, i) => (
                  <div className="evidence-line" key={i}>
                    <code className="file-path">{ev.file}</code> — {ev.reason}
                  </div>
                ))}
                {dim.missingInformation.length > 0 && (
                  <div className="dim-missing">Fehlende Information: {dim.missingInformation.join("; ")}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ImpactBlock({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="impact-block">
      <h4>{title}</h4>
      <ul className="impact-list">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function confidenceBucket(confidence: number): "HIGH" | "MEDIUM" | "LOW" {
  if (confidence >= 0.85) return "HIGH";
  if (confidence >= 0.65) return "MEDIUM";
  return "LOW";
}
