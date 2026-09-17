import { useState } from "react";
import type { ScoringResult } from "../types";

interface Props {
  result: ScoringResult | null;
}

export function ResultHero({ result }: Props) {
  const [view, setView] = useState<"customer" | "internal">("customer");

  const du = result?.duResult;
  const confidence = result?.confidence;
  const isDecompositionRequired = result?.status === "DECOMPOSITION_REQUIRED";
  const suggestionCount = result?.impactAnalysis?.suggestedDecomposition?.length ?? 0;
  // The headline number is the Commercial DU (the actually offered unit) -
  // falls back to Base DU for a legacy result with no Commercial Model yet.
  const headlineDU = du?.commercialDevelopmentUnits ?? du?.developmentUnits ?? null;

  return (
    <div className={`hero ${view === "internal" ? "internal-mode" : ""} ${isDecompositionRequired ? "decomposition" : ""}`}>
      <div className="actions" style={{ marginTop: 0, justifyContent: "space-between" }}>
        <small>Development Units</small>
        <div className="view-toggle">
          <button className={view === "customer" ? "active" : ""} onClick={() => setView("customer")}>
            Kunde
          </button>
          <button className={view === "internal" ? "active" : ""} onClick={() => setView("internal")}>
            Intern
          </button>
        </div>
      </div>

      {isDecompositionRequired && (
        <div className="hero-alert">
          <span className="hero-alert-icon" aria-hidden="true">
            ⚠️
          </span>
          <div>
            <div className="hero-alert-headline">Zerlegung empfohlen</div>
          </div>
        </div>
      )}

      <div className="du-value">
        {du && du.developmentUnits === null ? "Zerlegung erforderlich" : `${headlineDU ?? "–"} DU`}
      </div>
      <div className="du-class">Klasse {du?.duClass ?? "–"}</div>

      <div className="kpis">
        <div className="kpi">
          <small>Weighted Score</small>
          <b>{du ? du.weightedScore.toFixed(2) : "–"}</b>
        </div>
        <div className="kpi">
          <small>Overall Confidence</small>
          <b>
            {confidence ? `${Math.round(confidence.overallConfidence * 100)}% (${confidence.confidenceLevel})` : "–"}
          </b>
        </div>
      </div>

      <div className="hero-summary">
        {summaryText(result)}
        {isDecompositionRequired && suggestionCount > 0 && (
          <> {suggestionCount} Vorschläge dafür weiter unten in der Bewertung.</>
        )}
        <br />
        <br />
        DU ist keine Zeiteinheit, sondern repräsentiert Scope, Komplexität und Risiko.
      </div>

      <div className="internal-only" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.25)" }}>
        {du?.commercialDevelopmentUnits != null && du.developmentUnits !== du.commercialDevelopmentUnits && (
          <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 8 }}>
            Base DU (technisch): {du.developmentUnits ?? "–"} · Commercial DU (angeboten): {du.commercialDevelopmentUnits}
          </div>
        )}
        <small>Preis (intern)</small>
        <div style={{ fontSize: 22, fontWeight: 900 }}>
          {du?.price !== undefined && du?.price !== null ? `${du.price.toLocaleString("de-DE")} €` : "–"}
        </div>

        {du?.effortEstimate && (
          <>
            <small style={{ display: "block", marginTop: 10 }}>Geschätzter KI-nativer Personalaufwand</small>
            <div style={{ fontSize: 16, fontWeight: 800 }}>
              {du.effortEstimate.minHours.toFixed(0)}–{du.effortEstimate.maxHours.toFixed(0)} Std.{" "}
              <span style={{ fontWeight: 600, opacity: 0.85 }}>(wahrsch. {du.effortEstimate.likelyHours.toFixed(0)} Std.)</span>
            </div>
            <div style={{ fontSize: 11, opacity: 0.85 }}>
              Effort Confidence {Math.round(du.effortEstimate.confidence * 100)}% - eigenständig von der KI geschätzt,
              nicht aus der DU-Klasse abgeleitet (reine KI-API-Kosten separat unter „KI-Kosten")
            </div>
          </>
        )}

        {!du?.effortEstimate && du?.timeEstimate && (
          <>
            <small style={{ display: "block", marginTop: 10 }}>Geschätzter interner Personalaufwand</small>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{du.timeEstimate.totalHours.toFixed(1)} Std.</div>
            <div style={{ fontSize: 11, opacity: 0.85 }}>
              davon {du.timeEstimate.promptingHours.toFixed(1)} Std. KI-Prompting, {du.timeEstimate.developmentHours.toFixed(1)}{" "}
              Std. klassische Entwicklung - beides Personalzeit, eigenständig von der KI geschätzt (nicht aus der
              DU-Klasse abgeleitet; reine KI-API-Kosten separat unter „KI-Kosten")
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function summaryText(result: ScoringResult | null): string {
  if (!result) return "Noch keine Bewertung.";
  switch (result.status) {
    case "SCORED":
      return "Bewertung abgeschlossen.";
    case "NEEDS_CLARIFICATION":
      return "Confidence zu gering für eine endgültige DU-Schätzung — siehe offene Fragen.";
    case "DECOMPOSITION_REQUIRED":
      return "Anforderung zu groß (XXL) — Zerlegung in kleinere Requirements empfohlen.";
    case "ERROR":
      return "Bewertung fehlgeschlagen.";
    default:
      return "Bewertung läuft…";
  }
}
