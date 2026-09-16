import { DIMENSION_ORDER, QUALITY_LEVEL_META } from "../types";
import type { ScoringResult, UiLanguage } from "../types";
import { SCORING_STATUS_META } from "../statusMeta";

interface Props {
  loading: boolean;
  result: ScoringResult | null;
  language: UiLanguage;
  onChangeLanguage: (language: UiLanguage) => void;
}

export function ScoringPanel({ loading, result, language, onChangeLanguage }: Props) {
  const statusMeta = SCORING_STATUS_META[loading ? "ANALYZING" : result?.status ?? "NOT_STARTED"];

  return (
    <div className="card">
      <div className="actions" style={{ marginTop: 0, justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Bewertung</h2>
        <div className="lang-toggle">
          <button className={language === "de" ? "active" : ""} onClick={() => onChangeLanguage("de")}>
            DE
          </button>
          <button className={language === "en" ? "active" : ""} onClick={() => onChangeLanguage("en")}>
            EN
          </button>
        </div>
      </div>
      <span className={`status-pill ${statusMeta.variant}`}>{statusMeta.label}</span>
      {result && <span className="tag" style={{ marginLeft: 8 }}>{QUALITY_LEVEL_META[result.qualityLevel].label}</span>}
      {result && <span className="tag" style={{ marginLeft: 8 }}>{result.model}</span>}

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
          {/* Absent on results scored before this feature shipped - the generic
              text above still stands on its own in that case. */}
          {(result.impactAnalysis?.suggestedDecomposition?.length ?? 0) > 0 && (
            <div className="decomposition-list">
              {result.impactAnalysis!.suggestedDecomposition.map((item, i) => (
                <div className="decomposition-item" key={i}>
                  <div className="decomposition-item-title">{item.title}</div>
                  <div className="decomposition-item-description">{item.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {result?.status === "ASSESSMENT_WITH_ASSUMPTIONS" && (
        <div className="notice" style={{ marginTop: 10 }}>
          Vorläufige Bewertung: basiert auf {result.assumptionsUsed.length} dokumentierten Annahme
          {result.assumptionsUsed.length === 1 ? "" : "n"} (siehe „Getroffene Annahmen“ oben). Du kannst sie
          bestätigen, bearbeiten oder verwerfen und danach neu bewerten lassen.
        </div>
      )}

      {result?.requirement && (
        <div className="profile-section">
          <strong style={{ fontSize: 13 }}>{result.requirement.title}</strong>
          <p style={{ margin: "6px 0 0", fontSize: 13 }}>{result.requirement.description}</p>
          {result.requirement.acceptanceCriteria.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 800, marginTop: 8 }}>Akzeptanzkriterien</div>
              <ul className="context-list">
                {result.requirement.acceptanceCriteria.map((criterion, i) => (
                  <li key={i}>{criterion}</li>
                ))}
              </ul>
            </>
          )}
          {result.requirement.constraints.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 800, marginTop: 8 }}>Randbedingungen</div>
              <ul className="context-list">
                {result.requirement.constraints.map((constraint, i) => (
                  <li key={i}>{constraint}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {result?.overallAssessment && (
        <div className="overall-assessment">
          <strong style={{ fontSize: 13 }}>Gesamteinschätzung · Overall Assessment</strong>
          <p style={{ margin: "6px 0 0" }}>{result.overallAssessment[language]}</p>
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
                <div className="dim-summary">{dim.summary[language]}</div>
                <details className="dim-details">
                  <summary>Einzelauswertung · Detailed evaluation</summary>
                  <div className="dim-rationale">{dim.rationale[language]}</div>
                  {dim.evidence.map((ev, i) => (
                    <div className="evidence-line" key={i}>
                      <code className="file-path">{ev.file}</code> — {ev.reason}
                    </div>
                  ))}
                  {/* factsUsed/assumptionsUsed/unresolvedRisks are absent on scoring
                      results persisted before the assumption engine shipped - guard
                      against that older shape instead of crashing the whole page. */}
                  {(dim.factsUsed?.length ?? 0) > 0 && (
                    <div className="dim-trace">Fakten: {dim.factsUsed.join("; ")}</div>
                  )}
                  {(dim.assumptionsUsed?.length ?? 0) > 0 && (
                    <div className="dim-trace">Annahmen verwendet: {dim.assumptionsUsed.length}</div>
                  )}
                  {(dim.unresolvedRisks?.length ?? 0) > 0 && (
                    <div className="dim-missing">Ungelöste Risiken: {dim.unresolvedRisks.join("; ")}</div>
                  )}
                  {dim.missingInformation.length > 0 && (
                    <div className="dim-missing">Fehlende Information: {dim.missingInformation.join("; ")}</div>
                  )}
                </details>
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
