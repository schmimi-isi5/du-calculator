import { useState } from "react";
import type { ScoringResult } from "../types";

interface Props {
  result: ScoringResult;
}

// Customer view stays DU-denominated (relative %, DU-equivalent), matching
// how the rest of the app already treats price/hours as internal-only (see
// ResultHero's "Preis (intern)") - internal view adds hours and an implied
// €/DU-based price so nothing about actual cost structure leaks to a
// customer-facing printout of this same report.
export function ManagementReport({ result }: Props) {
  const [view, setView] = useState<"customer" | "internal">("customer");
  const du = result.duResult;

  if (!du) {
    return (
      <div className="card report">
        <h2>Management-Report</h2>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          Für diese Bewertung liegt noch kein DU-Ergebnis vor (Status: {result.status}).
        </p>
      </div>
    );
  }

  const pricePerDUImplied = du.price !== null && du.developmentUnits ? du.price / du.developmentUnits : null;
  const suggestions = result.impactAnalysis?.suggestedDecomposition ?? [];

  return (
    <div className="card report">
      <div className="actions" style={{ marginTop: 0, justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Management-Report</h2>
        <div className="view-toggle">
          <button className={view === "customer" ? "active" : ""} onClick={() => setView("customer")}>
            Kunde
          </button>
          <button className={view === "internal" ? "active" : ""} onClick={() => setView("internal")}>
            Intern
          </button>
        </div>
      </div>

      <div className="report-header">
        <h3>{result.requirement.title}</h3>
        <p>{result.requirement.description}</p>
      </div>

      <div className="report-summary-grid">
        <div className="report-summary-item">
          <small>DU-Klasse</small>
          <b>{du.duClass}</b>
        </div>
        <div className="report-summary-item">
          <small>Development Units</small>
          <b>
            {du.isRoughEstimate ? "~" : ""}
            {du.developmentUnits ?? "–"} DU
          </b>
        </div>
        {view === "internal" && (
          <div className="report-summary-item">
            <small>Preis</small>
            <b>{du.price !== null ? `${du.price.toLocaleString("de-DE")} €` : "–"}</b>
          </div>
        )}
        <div className="report-summary-item">
          <small>Confidence</small>
          <b>
            {Math.round(du.overallConfidence * 100)}% ({du.confidenceLevel})
          </b>
        </div>
      </div>

      {du.isRoughEstimate && (
        <div className="notice" style={{ marginTop: 10 }}>
          Diese Anforderung wurde als Klasse XXL eingestuft - die DU-Zahl oben ist eine grobe Hochrechnung, keine
          belastbare Schätzung. Eine Zerlegung in kleinere Anforderungen wird empfohlen
          {suggestions.length > 0 ? " - siehe Vorschläge unten." : "."}
        </div>
      )}

      {view === "internal" && (
        <div className="report-section">
          <h4>Interner Aufwand (Schätzung)</h4>
          <div className="report-summary-grid">
            <div className="report-summary-item">
              <small>Gesamtaufwand</small>
              <b>{du.timeEstimate.totalHours.toFixed(1)} Std.</b>
            </div>
            <div className="report-summary-item">
              <small>Prompting-Zeit</small>
              <b>{du.timeEstimate.promptingHours.toFixed(1)} Std.</b>
            </div>
            <div className="report-summary-item">
              <small>Entwicklungszeit</small>
              <b>{du.timeEstimate.developmentHours.toFixed(1)} Std.</b>
            </div>
          </div>
          <p className="report-note">
            Annahme: {du.timeEstimate.hoursPerDU} Std./DU (konfigurierbar, keine gemessene Kennzahl - DU
            repräsentiert Scope/Komplexität/Risiko, keine Zeit).
            {du.price !== null &&
              ` Vergleich: ${du.price.toLocaleString("de-DE")} € Erlös über ${du.timeEstimate.totalHours.toFixed(1)} Std. internen Aufwand ≈ ${(du.price / du.timeEstimate.totalHours).toFixed(0)} €/Std. kalkulatorischer Satz.`}
          </p>
        </div>
      )}

      <div className="report-section">
        <h4>Vergleich: Umsetzungsansätze</h4>
        <p className="report-note">
          Grobe, evidenzbasierte Schätzung relativ zur klassischen Entwicklung - basierend auf den bewerteten
          Dimensionen dieser Anforderung. Kein Ersatz für eine belastbare Machbarkeitsprüfung je Plattform.
        </p>
        <div className="approach-table-wrap">
          <table className="approach-table">
            <thead>
              <tr>
                <th>Ansatz</th>
                <th>Rel. Aufwand</th>
                <th>DU-Äquivalent</th>
                {view === "internal" && <th>Std.</th>}
                {view === "internal" && <th>Preis (Ä.)</th>}
                <th>Einschätzung</th>
              </tr>
            </thead>
            <tbody>
              {du.alternativeApproaches.map((approach) => {
                const duEquivalent =
                  du.developmentUnits !== null ? Math.round(du.developmentUnits * approach.relativeEffort) : null;
                const priceEquivalent =
                  duEquivalent !== null && pricePerDUImplied !== null ? Math.round(duEquivalent * pricePerDUImplied) : null;
                return (
                  <tr key={approach.id} className={approach.id === "classicalDevelopment" ? "baseline" : ""}>
                    <td>{approach.label}</td>
                    <td>{Math.round(approach.relativeEffort * 100)}%</td>
                    <td>{duEquivalent !== null ? `~${duEquivalent} DU` : "–"}</td>
                    {view === "internal" && <td>{approach.estimatedHours.toFixed(1)} Std.</td>}
                    {view === "internal" && (
                      <td>{priceEquivalent !== null ? `${priceEquivalent.toLocaleString("de-DE")} €` : "–"}</td>
                    )}
                    <td>{approach.rationale}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="report-section">
          <h4>Vorschlag zur Zerlegung</h4>
          <div className="decomposition-list">
            {suggestions.map((item, i) => (
              <div className="decomposition-item" key={i}>
                <div className="decomposition-item-title">{item.title}</div>
                <div className="decomposition-item-description">{item.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.overallAssessment && (
        <div className="report-section">
          <h4>Gesamteinschätzung</h4>
          <p>{result.overallAssessment.de}</p>
        </div>
      )}
    </div>
  );
}
