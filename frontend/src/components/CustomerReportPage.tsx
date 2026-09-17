import { useEffect, useState } from "react";
import { ApiError, getCustomerReport } from "../api/client";
import { CUSTOM_DEVELOPMENT_BENEFITS, DU_CLASS_CUSTOMER_LABELS } from "../customerReportContent";
import type { CustomerReport } from "../types";

interface Props {
  scoringId: string;
}

// Standalone, no-login public page for a single shareable link
// (/report/:id, routed in main.tsx) - deliberately separate from App.tsx's
// tab shell so this page never pulls in internal navigation or data. Only
// ever fed by the customer-safe GET /api/requirement/:id/customer-report
// endpoint (backend/src/api/customerReport.ts) - never the full internal
// scoring result.
export function CustomerReportPage({ scoringId }: Props) {
  const [report, setReport] = useState<CustomerReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCustomerReport(scoringId)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Dieser Link konnte nicht geladen werden. Bitte prüfen Sie die Adresse oder wenden Sie sich an Ihren Ansprechpartner.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scoringId]);

  return (
    <div className="public-report-page">
      <header className="public-report-header">
        <span className="public-report-brand">ISIFIVE</span>
        {report && (
          <button className="btn" onClick={() => window.print()}>
            Als PDF speichern / Drucken
          </button>
        )}
      </header>

      <div className="public-report-body">
        {loading && <p style={{ fontSize: 13, color: "var(--muted)" }}>Lade Angebot…</p>}
        {error && <div className="notice error">{error}</div>}

        {report && !loading && !error && <CustomerReportContent report={report} />}
      </div>
    </div>
  );
}

function CustomerReportContent({ report }: { report: CustomerReport }) {
  const technologyAlternatives = report.technologyComparison.filter((t) => t.technology !== "AI_NATIVE");
  const bestAlternative = technologyAlternatives.reduce<(typeof technologyAlternatives)[number] | null>(
    (best, a) => (best === null || a.relativeEffortFactor < best.relativeEffortFactor ? a : best),
    null,
  );
  const alternativesAreClose = bestAlternative === null || bestAlternative.relativeEffortFactor >= 0.85;

  return (
    <div className="card report">
      <div className="report-header">
        <h3>{report.requirement.title}</h3>
        <p>{report.requirement.description}</p>
      </div>

      <div className="report-recommendation">
        <div className="report-recommendation-label">Unsere Empfehlung</div>
        <div className="report-recommendation-headline">Maßgeschneiderte Umsetzung</div>
        <div className="report-price-hero">
          {report.price !== null ? `${report.price.toLocaleString("de-DE")} €` : "Preis auf Anfrage"}
        </div>
        <div className="report-price-note">
          einmalig ·{" "}
          {report.developmentUnits !== null
            ? `${report.developmentUnits} Development Units`
            : DU_CLASS_CUSTOMER_LABELS[report.duClass]}
          {report.isRoughEstimate && " · grobe Schätzung, siehe unten"}
        </div>
      </div>

      {report.isRoughEstimate && (
        <div className="notice" style={{ marginTop: 10 }}>
          Diese Anforderung wurde als Großprojekt eingestuft - der Preis oben ist eine grobe Hochrechnung, keine
          belastbare Schätzung. Eine Zerlegung in kleinere, einzeln beauftragbare Pakete wird empfohlen
          {report.suggestedDecomposition.length > 0 ? " - siehe Vorschläge unten." : "."}
        </div>
      )}

      <div className="report-section">
        <h4>Ihre Vorteile</h4>
        <ul className="benefit-list">
          {CUSTOM_DEVELOPMENT_BENEFITS.map((benefit) => (
            <li key={benefit}>{benefit}</li>
          ))}
        </ul>
      </div>

      {(report.created.length > 0 || report.modified.length > 0 || report.reused.length > 0) && (
        <div className="report-section">
          <h4>Was Sie erhalten</h4>
          {report.created.length > 0 && (
            <>
              <div className="report-included-label">Neu für Sie entwickelt</div>
              <ul className="context-list">
                {report.created.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </>
          )}
          {report.modified.length > 0 && (
            <>
              <div className="report-included-label">Angepasst an Ihre Anforderung</div>
              <ul className="context-list">
                {report.modified.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </>
          )}
          {report.reused.length > 0 && (
            <>
              <div className="report-included-label">Bereits vorhanden - ohne Mehrkosten wiederverwendet</div>
              <ul className="context-list">
                {report.reused.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {report.technologyComparison.length > 0 && (
        <div className="report-section">
          <h4>Technologievergleich</h4>
          <p className="report-note">
            {alternativesAreClose
              ? "Für diesen Umfang ist der Unterschied zu Low-Code-Plattformen wie n8n oder Intrexx gering - die KI-native Individualentwicklung bietet Ihnen die oben genannten Vorteile ohne nennenswerten Aufpreis."
              : "Je nach Anforderung kann eine Low-Code-Plattform wie n8n oder Intrexx mehr oder weniger Aufwand bedeuten als unsere KI-native Individualentwicklung - wir zeigen das hier bewusst in beide Richtungen."}{" "}
            Grobe, evidenzbasierte Einschätzung relativ zur KI-nativen Individualentwicklung (Referenzwert, 100%) -
            kein Ersatz für eine belastbare Machbarkeitsprüfung je Plattform.
          </p>
          <div className="approach-table-wrap">
            <table className="approach-table">
              <thead>
                <tr>
                  <th>Ansatz</th>
                  <th>Aufwand im Vergleich</th>
                  <th>Vorteile</th>
                  <th>Nachteile</th>
                </tr>
              </thead>
              <tbody>
                {report.technologyComparison.map((tech) => {
                  const isBaseline = tech.technology === "AI_NATIVE";
                  const percent = Math.round(tech.relativeEffortFactor * 100);
                  return (
                    <tr key={tech.technology} className={isBaseline ? "baseline" : ""}>
                      <td>{tech.label}</td>
                      <td>
                        <div className="effort-bar-cell">
                          <div className="effort-bar-track">
                            <div
                              className={`effort-bar-fill ${
                                isBaseline ? "baseline" : percent > 100 ? "over-baseline" : ""
                              }`}
                              style={{ width: `${Math.min(percent, 100)}%` }}
                            />
                          </div>
                          <span className="effort-bar-label">{percent}%</span>
                        </div>
                      </td>
                      <td>
                        <ul className="tech-advantage-list">
                          {tech.advantages.map((a, i) => (
                            <li key={i}>{a}</li>
                          ))}
                        </ul>
                      </td>
                      <td>
                        <ul className="tech-disadvantage-list">
                          {tech.disadvantages.map((d, i) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report.runtimeCosts.length > 0 && (
        <div className="report-section">
          <h4>Laufende Kosten</h4>
          <p className="report-note">
            Über den einmaligen Preis oben hinaus können folgende laufende Kosten im Betrieb entstehen:
          </p>
          <ul className="context-list">
            {report.runtimeCosts.map((item) => (
              <li key={item.label}>
                {item.label}:{" "}
                {item.status === "ESTIMATED"
                  ? `verbrauchsabhängig, ca. ${item.amountEur?.toLocaleString("de-DE")} €`
                  : "noch nicht belastbar kalkulierbar"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.suggestedDecomposition.length > 0 && (
        <div className="report-section">
          <h4>Vorschlag zur Zerlegung</h4>
          <div className="decomposition-list">
            {report.suggestedDecomposition.map((item, i) => (
              <div className="decomposition-item" key={i}>
                <div className="decomposition-item-title">{item.title}</div>
                <div className="decomposition-item-description">{item.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.overallAssessment && (
        <div className="report-section report-assessment">
          <h4>Fachliche Einschätzung</h4>
          <p>{report.overallAssessment.de}</p>
        </div>
      )}

      <div className="report-cta">Haben Sie Fragen zu diesem Angebot? Sprechen Sie uns gerne an.</div>
    </div>
  );
}
