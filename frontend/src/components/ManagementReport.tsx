import { useState } from "react";
import type { DuClass, ScoringResult } from "../types";

interface Props {
  result: ScoringResult;
}

// A friendlier read of the DU class for someone who has never heard of
// "Development Units" - the internal view still shows the raw class/DU
// count for whoever is preparing the quote.
const DU_CLASS_CUSTOMER_LABELS: Record<DuClass, string> = {
  XS: "Sehr kleiner Umfang",
  S: "Kleiner Umfang",
  M: "Mittlerer Umfang",
  L: "Größerer Umfang",
  XL: "Umfangreiches Vorhaben",
  XXL: "Großprojekt",
};

// Fixed, always-true value proposition for choosing custom development over
// a low-code platform - not derived from the requirement's own scores
// (unlike the comparison table below), since these hold regardless of this
// specific requirement's complexity profile.
const CUSTOM_DEVELOPMENT_BENEFITS = [
  "Nahtlose Integration in Ihr bestehendes System",
  "Volle Eigentumsrechte & Kontrolle über den Code",
  "Keine wiederkehrenden Plattform- oder Lizenzkosten",
  "Erweiterbar für zukünftige Anforderungen, ohne Plattformgrenzen",
  "Direkter Support durch das Team, das Ihr System bereits kennt",
];

// Price/DU are the actual quote - a report meant to drive a purchase
// decision needs to show them to the customer, not hide them. What stays
// internal-only is anything that reveals cost structure or margin: hours,
// the implied hourly rate, and euro figures for the *alternative*
// approaches (their relative % and DU-equivalent are customer-safe;
// translating that into a second euro figure invites "just do it via n8n
// for X€ less" instead of "here is what n8n would roughly take, relatively").
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
  // The customer is quoted the Commercial DU (Base DU adjusted for effort/
  // cost/innovation/risk - see commercialEngine.ts), not the raw technical
  // Base DU figure - see CLAUDE.md "Base DU vs Commercial DU". Falls back to
  // Base DU for a legacy result that never computed a Commercial DU.
  const customerFacingDU = du.commercialDevelopmentUnits ?? du.developmentUnits;
  const runtimeCosts = du.directCosts
    ? (
        [
          ["KI/API-Nutzung", du.directCosts.aiApiCost],
          ["Infrastruktur", du.directCosts.infrastructureCost],
          ["Third-Party", du.directCosts.thirdPartyCost],
          ["Sonstiges", du.directCosts.otherDirectCost],
        ] as const
      ).filter(([, item]) => item.costType === "RECURRING_RUNTIME" || item.costType === "BOTH")
    : [];
  const suggestions = result.impactAnalysis?.suggestedDecomposition ?? [];
  const created = result.impactAnalysis?.create ?? [];
  const modified = result.impactAnalysis?.modify ?? [];
  const reused = result.impactAnalysis?.reusable ?? [];

  const alternatives = (du.alternativeApproaches ?? []).filter((a) => a.id !== "classicalDevelopment");
  const bestAlternative = alternatives.reduce<(typeof alternatives)[number] | null>(
    (best, a) => (best === null || a.relativeEffort < best.relativeEffort ? a : best),
    null,
  );
  const alternativesAreClose = bestAlternative !== null && bestAlternative.relativeEffort >= 0.6;

  const technologyAlternatives = (du.technologyComparison ?? []).filter((a) => a.technology !== "AI_NATIVE");
  const bestTechnologyAlternative = technologyAlternatives.reduce<(typeof technologyAlternatives)[number] | null>(
    (best, a) => (best === null || a.relativeEffortFactor < best.relativeEffortFactor ? a : best),
    null,
  );
  const technologyAlternativesAreClose = bestTechnologyAlternative === null || bestTechnologyAlternative.relativeEffortFactor >= 0.85;

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

      {view === "customer" ? (
        <div className="report-recommendation">
          <div className="report-recommendation-label">Unsere Empfehlung</div>
          <div className="report-recommendation-headline">Maßgeschneiderte Umsetzung</div>
          <div className="report-price-hero">
            {du.price !== null ? `${du.price.toLocaleString("de-DE")} €` : "Preis auf Anfrage"}
          </div>
          <div className="report-price-note">
            einmalig · {customerFacingDU !== null ? `${customerFacingDU} Development Units` : DU_CLASS_CUSTOMER_LABELS[du.duClass]}
            {du.isRoughEstimate && " · grobe Schätzung, siehe unten"}
          </div>
        </div>
      ) : (
        <div className="report-summary-grid">
          <div className="report-summary-item">
            <small>DU-Klasse</small>
            <b>{du.duClass}</b>
          </div>
          <div className="report-summary-item">
            <small>Base DU (technisch)</small>
            <b>{du.developmentUnits !== null ? `${du.developmentUnits} DU` : "Zerlegung erforderlich"}</b>
          </div>
          <div className="report-summary-item">
            <small>Commercial DU (angeboten)</small>
            <b>{du.commercialDevelopmentUnits != null ? `${du.commercialDevelopmentUnits} DU` : "–"}</b>
          </div>
          <div className="report-summary-item">
            <small>Preis</small>
            <b>{du.price !== null ? `${du.price.toLocaleString("de-DE")} €` : "–"}</b>
          </div>
          <div className="report-summary-item">
            <small>DU Confidence</small>
            <b>
              {Math.round(du.overallConfidence * 100)}% ({du.confidenceLevel})
            </b>
          </div>
        </div>
      )}

      {du.isRoughEstimate && (
        <div className="notice" style={{ marginTop: 10 }}>
          Diese Anforderung wurde als Großprojekt (Klasse XXL) eingestuft - der Preis oben ist eine grobe
          Hochrechnung, keine belastbare Schätzung. Eine Zerlegung in kleinere, einzeln beauftragbare Pakete wird
          empfohlen{suggestions.length > 0 ? " - siehe Vorschläge unten." : "."}
        </div>
      )}

      {view === "customer" && (
        <div className="report-section">
          <h4>Ihre Vorteile</h4>
          <ul className="benefit-list">
            {CUSTOM_DEVELOPMENT_BENEFITS.map((benefit) => (
              <li key={benefit}>{benefit}</li>
            ))}
          </ul>
        </div>
      )}

      {view === "customer" && (created.length > 0 || modified.length > 0 || reused.length > 0) && (
        <div className="report-section">
          <h4>Was Sie erhalten</h4>
          {created.length > 0 && (
            <>
              <div className="report-included-label">Neu für Sie entwickelt</div>
              <ul className="context-list">
                {created.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </>
          )}
          {modified.length > 0 && (
            <>
              <div className="report-included-label">Angepasst an Ihre Anforderung</div>
              <ul className="context-list">
                {modified.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </>
          )}
          {reused.length > 0 && (
            <>
              <div className="report-included-label">Bereits vorhanden - ohne Mehrkosten wiederverwendet</div>
              <ul className="context-list">
                {reused.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {view === "internal" && du.effortEstimate && (
        <div className="report-section">
          <h4>KI-native Aufwandsschätzung (Personalzeit)</h4>
          <p className="report-note" style={{ marginBottom: 10 }}>
            Diese Spanne ist Personalzeit (Analyse, Briefing/Steuerung der Coding Agents, Review, Korrekturen,
            individuelle Entwicklungsanteile, Tests, Deployment) - nicht KI-Rechenzeit. Reine KI-API-Kosten werden
            separat unter "KI-Kosten" erfasst. Diese Schätzung ist eine eigenständige Experten-Einschätzung für genau
            diese Anforderung - bewusst NICHT aus der DU-Klasse abgeleitet (siehe DU-Bewertung oben).
          </p>
          <div className="report-summary-grid">
            <div className="report-summary-item">
              <small>Spanne</small>
              <b>
                {du.effortEstimate.minHours.toFixed(0)}–{du.effortEstimate.maxHours.toFixed(0)} Std.
              </b>
            </div>
            <div className="report-summary-item">
              <small>Wahrscheinlich</small>
              <b>{du.effortEstimate.likelyHours.toFixed(0)} Std.</b>
            </div>
            <div className="report-summary-item">
              <small>Effort Confidence</small>
              <b>{Math.round(du.effortEstimate.confidence * 100)}%</b>
            </div>
          </div>
          <p className="report-note">{du.effortEstimate.rationale.de}</p>
          <p className="report-note">
            Der Preis oben ergibt sich {du.pricingStrategy === "HOURLY"
              ? `direkt aus ${du.effortEstimate.likelyHours.toFixed(0)} Std. × konfiguriertem Stundensatz`
              : "aus der DU-Anzahl × einem konfigurierten Festpreis pro DU"}
            . DU-Confidence ({Math.round(du.overallConfidence * 100)}%) und Effort Confidence sind bewusst getrennte
            Größen - eine sichere DU-Einstufung bedeutet nicht automatisch eine sichere Aufwandsschätzung.
          </p>
        </div>
      )}

      {view === "internal" && du.commercialCalculation?.estimateStatus === "REQUIRES_CLARIFICATION" && (
        <div className="notice" style={{ marginTop: 10 }}>
          Die Effort Confidence dieser Anforderung ist sehr niedrig - statt eines automatischen Risikoaufschlags
          empfiehlt das System, die Anforderung zunächst besser zu verstehen oder zu zerlegen (Discovery), bevor ein
          belastbares Angebot erstellt wird. Der unten gezeigte Commercial-DU-Wert ist nur eine interne
          Referenzgröße, keine belastbare Kalkulationsgrundlage.
        </div>
      )}

      {view === "internal" && du.commercialCalculation?.effortAnalysis && (
        <div className="report-section">
          <h4>Effort Benchmark & Produktivität</h4>
          <p className="report-note" style={{ marginBottom: 10 }}>
            Der Benchmark ist ein vorläufiger Vergleichswert für den typischerweise erwarteten Aufwand dieser
            Base-DU-Klasse - <b>keine Definition einer Development Unit</b>. Ein Produktivitätsgewinn (Aufwand unter
            Benchmark) reduziert Commercial DU standardmäßig nicht automatisch.
          </p>
          <div className="report-summary-grid">
            <div className="report-summary-item">
              <small>Benchmark ({du.commercialCalculation.effortAnalysis.benchmark.class})</small>
              <b>{du.commercialCalculation.effortAnalysis.benchmark.expectedLikelyHours.toFixed(0)} Std.</b>
            </div>
            <div className="report-summary-item">
              <small>Vorhergesagt (wahrsch.)</small>
              <b>{du.commercialCalculation.effortAnalysis.predictedLikelyHours.toFixed(0)} Std.</b>
            </div>
            <div className="report-summary-item">
              <small>Benchmark-Status</small>
              <b>
                {du.commercialCalculation.effortAnalysis.benchmark.calibrationStatus} (n=
                {du.commercialCalculation.effortAnalysis.benchmark.sampleSize})
              </b>
            </div>
            {du.commercialCalculation.effortAnalysis.productivityGain && (
              <div className="report-summary-item">
                <small>Produktivitätsgewinn</small>
                <b>
                  {du.commercialCalculation.effortAnalysis.productivityGain.hours.toFixed(0)} Std. (
                  {Math.round(du.commercialCalculation.effortAnalysis.productivityGain.percent * 100)}%)
                </b>
              </div>
            )}
            {du.commercialCalculation.effortAnalysis.positiveEffortOverrun && (
              <div className="report-summary-item">
                <small>Mehraufwand ggü. Benchmark</small>
                <b>
                  +{du.commercialCalculation.effortAnalysis.positiveEffortOverrun.hours.toFixed(0)} Std. (+
                  {Math.round(du.commercialCalculation.effortAnalysis.positiveEffortOverrun.percent * 100)}%)
                </b>
              </div>
            )}
          </div>
        </div>
      )}

      {view === "internal" && du.commercialCalculation && (
        <div className="report-section">
          <h4>Kaufmännische Kalkulation (Commercial DU)</h4>
          <p className="report-note" style={{ marginBottom: 10 }}>
            Base DU beschreibt den technischen Umfang (Scope/Komplexität/Risiko) - Commercial DU ist die tatsächlich
            angebotene kaufmännische Einheit, angepasst um Aufwand-, Kosten-, Innovations- und Risikofaktoren. Keine
            feste Stunden-Umrechnung ({"commercialDU ≠ hours / const"}) - jede Anpassung ist einzeln unten
            aufgeschlüsselt und gedeckelt.
          </p>
          <div className="report-summary-grid">
            <div className="report-summary-item">
              <small>Base DU</small>
              <b>{du.commercialCalculation.baseDU ?? "–"}</b>
            </div>
            <div className="report-summary-item">
              <small>Commercial DU</small>
              <b>{du.commercialCalculation.suggestedCommercialDU ?? "–"}</b>
            </div>
            <div className="report-summary-item">
              <small>Commercial DU Confidence</small>
              <b>{Math.round(du.commercialCalculation.commercialDUConfidence * 100)}%</b>
            </div>
            <div className="report-summary-item">
              <small>Kalibrierungsstatus</small>
              <b>{du.commercialCalculation.calibrationStatus}</b>
            </div>
          </div>
          <table className="approach-table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Faktor</th>
                <th>Δ DU</th>
                <th>Begründung</th>
              </tr>
            </thead>
            <tbody>
              {du.commercialCalculation.adjustments.map((adj) => (
                <tr key={adj.label}>
                  <td>{adj.label}</td>
                  <td>
                    {adj.deltaDU > 0 ? "+" : ""}
                    {adj.deltaDU}
                  </td>
                  <td>{adj.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {du.commercialCalculation.guardrailApplied && (
            <p className="report-note report-note-warning" style={{ marginTop: 10 }}>
              COMMERCIAL_DU_GUARDRAIL_APPLIED: {du.commercialCalculation.guardrailReason} (vor Begrenzung:{" "}
              {du.commercialCalculation.commercialDUBeforeGuardrail}, danach:{" "}
              {du.commercialCalculation.commercialDUAfterGuardrail})
            </p>
          )}
        </div>
      )}

      {view === "internal" && (du.directCosts || du.implementationNovelty || du.reusableInnovationIp || du.innovation) && (
        <div className="report-section">
          <h4>Direkte Kosten, Implementation Novelty & Reusable IP</h4>
          {du.directCosts && (
            <div className="report-summary-grid" style={{ marginBottom: 10 }}>
              {(
                [
                  ["KI/API", du.directCosts.aiApiCost],
                  ["Infrastruktur", du.directCosts.infrastructureCost],
                  ["Third-Party", du.directCosts.thirdPartyCost],
                  ["Sonstiges", du.directCosts.otherDirectCost],
                ] as const
              ).map(([label, item]) => (
                <div className="report-summary-item" key={label}>
                  <small>{label}</small>
                  <b>{item.status === "ESTIMATED" ? `${item.amountEur?.toLocaleString("de-DE")} €` : item.status}</b>
                </div>
              ))}
            </div>
          )}
          {du.implementationNovelty && (
            <p className="report-note">
              Implementation Novelty <b>{du.implementationNovelty.level}</b> (
              {Math.round(du.implementationNovelty.confidence * 100)}% Confidence): {du.implementationNovelty.rationale}
            </p>
          )}
          {du.reusableInnovationIp && (
            <p className="report-note">
              Reusable Innovation / IP <b>{du.reusableInnovationIp.level}</b> (
              {Math.round(du.reusableInnovationIp.confidence * 100)}% Confidence): {du.reusableInnovationIp.rationale}
              {du.reusableInnovationIp.level !== "NONE" && " - rein informativ, noch kein automatischer Preis-/DU-Aufschlag."}
            </p>
          )}
          {!du.implementationNovelty && du.innovation && (
            <p className="report-note">
              Innovationsgrad <b>{du.innovation.level}</b> ({Math.round(du.innovation.confidence * 100)}% Confidence,
              älteres Berechnungsmodell): {du.innovation.rationale}
            </p>
          )}
        </div>
      )}

      {view === "internal" && du.timeEstimate && (
        <div className="report-section">
          <h4>Interner Personalaufwand (Schätzung, älteres Berechnungsmodell)</h4>
          <p className="report-note" style={{ marginBottom: 10 }}>
            Beide Werte sind Personalzeit (Mitarbeiter), keine KI-Rechenzeit - die KI selbst "kostet" hier keine
            Stunden, sondern nur die separat unter "KI-Kosten" erfasste API-Nutzung. Der Unterschied ist, WIE die
            Person arbeitet: "KI-Prompting" ist die Zeit, die eine Person damit verbringt, KI-Agenten für die
            KI-lastigen Teile zu briefen, zu prüfen und zu korrigieren; "Klassische Entwicklung" ist Zeit, die eine
            Person mit klassischer, manueller Umsetzung verbringt. Beides sind Personentätigkeiten - der Split zeigt
            nur, welcher Arbeitsmodus für welchen Anteil dieser Anforderung überwiegt (abgeleitet aus dem
            KI-Komplexitäts-Anteil am Gesamtscore).
          </p>
          <div className="report-summary-grid">
            <div className="report-summary-item">
              <small>Gesamtaufwand (Personal)</small>
              <b>{du.timeEstimate.totalHours.toFixed(1)} Std.</b>
            </div>
            <div className="report-summary-item">
              <small>davon KI-Prompting</small>
              <b>{du.timeEstimate.promptingHours.toFixed(1)} Std.</b>
            </div>
            <div className="report-summary-item">
              <small>davon klassische Entwicklung</small>
              <b>{du.timeEstimate.developmentHours.toFixed(1)} Std.</b>
            </div>
          </div>
          <p className="report-note">{du.timeEstimate.rationale.de}</p>
          <p className="report-note">
            Der Aufwand ist eine eigenständige Experten-Einschätzung der KI für genau diese Anforderung - nicht
            rechnerisch aus der DU-Klasse abgeleitet. Der Preis oben ergibt sich direkt aus{" "}
            {du.timeEstimate.totalHours.toFixed(1)} Std. × konfiguriertem Stundensatz (BILLING_RATE_PER_HOUR), damit
            ein Preis rechnerisch nie unter dem gewünschten Stundensatz liegen kann.
          </p>
          {du.timeEstimate.hasSignificantDeviationFromDuReference && (
            <p className="report-note report-note-warning">
              Hinweis: Der grobe DU-Referenzwert ({du.timeEstimate.hoursPerDU} Std./DU × {du.developmentUnits} DU ={" "}
              {du.timeEstimate.referenceHoursFromDU.toFixed(1)} Std.) weicht deutlich von der KI-Schätzung ab. Das ist
              kein Fehler - DU-Klasse und Zeitschätzung sind bewusst unabhängige Größen -, aber ein guter Anlass, die
              Begründung oben genauer zu prüfen.
            </p>
          )}
        </div>
      )}

      {du.technologyComparison && du.technologyComparison.length > 0 ? (
        <div className="report-section">
          <h4>Technologievergleich</h4>
          <p className="report-note">
            {technologyAlternativesAreClose
              ? "Für diesen Umfang ist der Unterschied zu Low-Code-Plattformen wie n8n oder Intrexx gering - die KI-native Individualentwicklung bietet Ihnen die oben genannten Vorteile ohne nennenswerten Aufpreis."
              : "Je nach Anforderung kann eine Low-Code-Plattform wie n8n oder Intrexx mehr oder weniger Aufwand bedeuten als unsere KI-native Individualentwicklung - wir zeigen das hier bewusst in beide Richtungen."}
            {" "}Grobe, evidenzbasierte Einschätzung relativ zur KI-nativen Individualentwicklung (Referenzwert, 100%) -
            kein Ersatz für eine belastbare Machbarkeitsprüfung je Plattform. Keine Technologie wird hier als
            "beste" markiert.
          </p>
          <div className="approach-table-wrap">
            <table className="approach-table">
              <thead>
                <tr>
                  <th>Ansatz</th>
                  <th>Aufwand im Vergleich</th>
                  {view === "internal" && <th>Std. (wahrsch.)</th>}
                  {view === "internal" && <th>Fit</th>}
                  {view === "internal" && <th>Bestehende Assets</th>}
                  <th>Vorteile</th>
                  <th>Nachteile</th>
                </tr>
              </thead>
              <tbody>
                {du.technologyComparison.map((tech) => {
                  const isBaseline = tech.technology === "AI_NATIVE";
                  const percent = Math.round(tech.relativeEffortFactor * 100);
                  const contributionsTitle = tech.contributions
                    .map((c) => `${c.label}: ${c.direction === "decreases" ? "-" : "+"}${Math.abs(c.contribution)}`)
                    .join("\n");
                  return (
                    <tr key={tech.technology} className={isBaseline ? "baseline" : ""}>
                      <td title={contributionsTitle}>
                        {tech.label}
                        {tech.varianceFlag === "HIGH_VARIANCE_COMPARISON" && (
                          <span
                            title="Großer Technologieunterschied prognostiziert - Treiber prüfen (siehe Tooltip auf dem Namen)."
                            style={{ marginLeft: 6, cursor: "help" }}
                          >
                            ⚠️
                          </span>
                        )}
                      </td>
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
                      {view === "internal" && <td>{tech.estimatedHours.likelyHours.toFixed(0)} Std.</td>}
                      {view === "internal" && <td>{Math.round(tech.fit * 100)}%</td>}
                      {view === "internal" && (
                        <td>{tech.assetLeverage !== null ? `${Math.round(tech.assetLeverage * 100)}%` : "unbekannt"}</td>
                      )}
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
      ) : du.alternativeApproaches && du.alternativeApproaches.length > 0 ? (
        <div className="report-section">
          <h4>Transparenter Vergleich der Umsetzungsansätze (älteres Berechnungsmodell)</h4>
          <p className="report-note">
            {alternativesAreClose
              ? "Für diesen Umfang ist der Unterschied zu Low-Code-Plattformen wie n8n oder Intrexx gering - die maßgeschneiderte Umsetzung bietet Ihnen die oben genannten Vorteile ohne nennenswerten Aufpreis."
              : "Low-Code-Plattformen wie n8n oder Intrexx könnten Teile davon schneller umsetzen - wir zeigen das hier bewusst transparent. Für die genannten Vorteile (Integration, Kontrolle, keine Plattformbindung) empfehlen wir dennoch die maßgeschneiderte Umsetzung."}
            {" "}Grobe, evidenzbasierte Schätzung relativ zur klassischen Entwicklung - kein Ersatz für eine
            belastbare Machbarkeitsprüfung je Plattform.
          </p>
          <div className="approach-table-wrap">
            <table className="approach-table">
              <thead>
                <tr>
                  <th>Ansatz</th>
                  <th>Aufwand im Vergleich</th>
                  <th>Ersparnis</th>
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
                  const isBaseline = approach.id === "classicalDevelopment";
                  const savingsPercent = Math.round((1 - approach.relativeEffort) * 100);
                  return (
                    <tr key={approach.id} className={isBaseline ? "baseline" : ""}>
                      <td>{approach.label}</td>
                      <td>
                        <div className="effort-bar-cell">
                          <div className="effort-bar-track">
                            <div
                              className={`effort-bar-fill ${isBaseline ? "baseline" : ""}`}
                              style={{ width: `${Math.round(approach.relativeEffort * 100)}%` }}
                            />
                          </div>
                          <span className="effort-bar-label">{Math.round(approach.relativeEffort * 100)}%</span>
                        </div>
                      </td>
                      <td>
                        {isBaseline ? (
                          <span style={{ color: "var(--muted)" }}>Basiswert</span>
                        ) : (
                          <span className="savings-badge">-{savingsPercent}%</span>
                        )}
                      </td>
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
      ) : (
        <div className="report-section">
          <h4>Transparenter Vergleich der Umsetzungsansätze</h4>
          <p className="report-note">
            Für diese ältere Bewertung liegt noch kein Plattformvergleich vor (vor Einführung dieses Features
            durchgeführt). Erneut bewerten, um ihn zu erhalten.
          </p>
        </div>
      )}

      {view === "customer" && runtimeCosts.length > 0 && (
        <div className="report-section">
          <h4>Laufende Kosten</h4>
          <p className="report-note">
            Über den einmaligen Preis oben hinaus können folgende laufende Kosten im Betrieb entstehen:
          </p>
          <ul className="context-list">
            {runtimeCosts.map(([label, item]) => (
              <li key={label}>
                {label}: {item.status === "ESTIMATED" ? `verbrauchsabhängig, ca. ${item.amountEur?.toLocaleString("de-DE")} €` : "noch nicht belastbar kalkulierbar"}
              </li>
            ))}
          </ul>
        </div>
      )}

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
        <div className="report-section report-assessment">
          <h4>Fachliche Einschätzung</h4>
          <p>{result.overallAssessment.de}</p>
        </div>
      )}

      {view === "customer" && (
        <div className="report-cta">Haben Sie Fragen zu diesem Angebot? Sprechen Sie uns gerne an.</div>
      )}
    </div>
  );
}
