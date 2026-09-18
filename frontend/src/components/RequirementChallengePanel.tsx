import { useState } from "react";
import { CHALLENGE_TYPE_LABELS } from "../types";
import type {
  ChallengeProposalAction,
  RequirementChallengeExpectedImpact,
  RequirementChallengeProposal,
  RequirementContext,
} from "../types";

interface Props {
  context: RequirementContext;
  challengeLoading: boolean;
  challengeError: string | null;
  decidingProposalId: string | null;
  approveLoading: boolean;
  approveError: { message: string; reasons?: string[] } | null;
  onRunChallenge: () => void;
  onDecideProposal: (proposalId: string, action: ChallengeProposalAction, editedText?: string) => void;
  onApprove: () => void;
}

const IMPACT_DIRECTION_LABELS: Record<string, string> = {
  LOWER: "↓ geringer",
  SAME: "= gleich",
  HIGHER: "↑ höher",
  UNKNOWN: "? unbekannt",
  BETTER: "↑ besser",
  WORSE: "↓ schlechter",
};

const IMPACT_FIELD_LABELS: { key: keyof RequirementChallengeExpectedImpact; label: string }[] = [
  { key: "scope", label: "Umfang" },
  { key: "complexity", label: "Komplexität" },
  { key: "maintainability", label: "Wartbarkeit" },
  { key: "reuse", label: "Wiederverwendung" },
  { key: "implementationFreedom", label: "Umsetzungsfreiheit" },
];

// Requirement Challenge & Optimization (requirement-challenge-v1) - extends
// the requirement review step: separates the underlying business goal from
// any proposed technical solution and surfaces reviewable proposals the
// user explicitly accepts/rejects/edits before the optimized requirement can
// be approved (only the approved version is ever scored - see
// api/requirementRoutes.ts). Never shows a DU/hours/price number here - this
// stage runs before all five calculation models.
export function RequirementChallengePanel({
  context,
  challengeLoading,
  challengeError,
  decidingProposalId,
  approveLoading,
  approveError,
  onRunChallenge,
  onDecideProposal,
  onApprove,
}: Props) {
  const hasRunChallenge = context.challengeAnalysis !== null || context.challengeProposals.length > 0;
  const pendingCount = context.challengeProposals.filter((p) => p.status === "PENDING").length;
  const isApproved = context.approvalStatus === "APPROVED";

  return (
    <div className="card">
      <div className="actions" style={{ marginTop: 0, justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Anforderung challengen &amp; optimieren</h2>
        <span className="tag">{context.approvalStatus}</span>
      </div>

      {!hasRunChallenge && (
        <>
          <p className="panel-intro">
            Die KI trennt das eigentliche Geschäftsziel von einer möglicherweise unnötig konkreten technischen
            Lösung (z. B. eine genannte Datenbank oder Technologie) und schlägt vor, wo die Anforderung schlanker
            oder wiederverwendbarer formuliert werden könnte. Nichts wird automatisch übernommen - jeder Vorschlag
            wird von dir bestätigt, abgelehnt oder bearbeitet.
          </p>
          <div className="actions">
            <button className="btn primary" disabled={challengeLoading} onClick={onRunChallenge}>
              {challengeLoading ? "Wird analysiert…" : "Anforderung challengen (KI)"}
            </button>
          </div>
        </>
      )}

      {challengeError && <div className="notice error">{challengeError}</div>}

      {hasRunChallenge && (
        <>
          {context.challengeAnalysis && (
            <div className="context-section">
              <div className="context-section-title">Erkannter Zweck</div>
              <p className="assumption-text" style={{ marginTop: 6 }}>{context.challengeAnalysis.goal}</p>
              <p className="assumption-reason">{context.challengeAnalysis.problemStatement}</p>
              <div className="assumption-meta">
                Lösungsspezifität der Formulierung: {context.challengeAnalysis.solutionSpecificity}
              </div>
            </div>
          )}

          <div className="context-section">
            <div className="context-section-title">
              Optimierungsvorschläge {context.challengeProposals.length > 0 ? `(${context.challengeProposals.length})` : ""}
            </div>
            {context.challengeProposals.length === 0 ? (
              <p className="context-hint">Keine Vorschläge - die Anforderung liest sich bereits schlank und klar.</p>
            ) : (
              context.challengeProposals.map((proposal, index) => (
                <ProposalCard
                  key={proposal.id}
                  index={index + 1}
                  proposal={proposal}
                  busy={decidingProposalId === proposal.id}
                  onDecide={(action, editedText) => onDecideProposal(proposal.id, action, editedText)}
                />
              ))
            )}
          </div>

          <div className="context-section">
            <div className="context-section-title">Optimierte Anforderung (Vorschau)</div>
            <div className="optimized-requirement-preview">
              <strong>{context.requirement.title}</strong>
              <p>{context.requirement.description}</p>
              {context.requirement.acceptanceCriteria.length > 0 && (
                <>
                  <div className="optimized-requirement-preview-label">Akzeptanzkriterien</div>
                  <ul className="context-list">
                    {context.requirement.acceptanceCriteria.map((ac) => (
                      <li key={ac}>{ac}</li>
                    ))}
                  </ul>
                </>
              )}
              {context.requirement.constraints.length > 0 && (
                <>
                  <div className="optimized-requirement-preview-label">Randbedingungen</div>
                  <ul className="context-list">
                    {context.requirement.constraints.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>

          <div className="context-section">
            {isApproved ? (
              <div className="privacy-mode-callout">
                <strong>✓ Optimierte Anforderung freigegeben</strong>
                <span className="privacy-mode-callout-subtitle">
                  Diese Fassung ist die Grundlage für die Bewertung. Eine spätere Änderung erfordert eine erneute
                  Freigabe.
                </span>
              </div>
            ) : (
              <>
                {pendingCount > 0 && (
                  <p className="context-hint">
                    Noch {pendingCount} offene{pendingCount > 1 ? "" : "r"} Vorschlag{pendingCount > 1 ? "e" : ""} - du
                    kannst offene Vorschläge auch bewusst überspringen und trotzdem freigeben.
                  </p>
                )}
                {approveError && (
                  <div className="notice error">
                    {approveError.message}
                    {approveError.reasons && approveError.reasons.length > 0 && (
                      <ul className="context-list" style={{ marginTop: 6 }}>
                        {approveError.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <div className="actions">
                  <button className="btn primary" disabled={approveLoading} onClick={onApprove}>
                    {approveLoading ? "Wird freigegeben…" : "Optimierte Anforderung freigeben"}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ProposalCard({
  index,
  proposal,
  busy,
  onDecide,
}: {
  index: number;
  proposal: RequirementChallengeProposal;
  busy: boolean;
  onDecide: (action: ChallengeProposalAction, editedText?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(proposal.editedChange ?? proposal.proposedChange);
  const isDecided = proposal.status !== "PENDING";

  return (
    <div className={`assumption-row status-${proposal.status === "REJECTED" ? "REJECTED" : "ACTIVE"}`}>
      <div className="assumption-top">
        <strong>
          {index}. {proposal.title}
        </strong>
        <span className="criticality-badge MEDIUM">{CHALLENGE_TYPE_LABELS[proposal.type]}</span>
        <span className="assumption-status-label">{proposal.status}</span>
      </div>

      <p className="assumption-reason">
        <em>Original:</em> „{proposal.originalText}“
      </p>
      <p className="assumption-text">{proposal.issue}</p>

      {editing ? (
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} />
      ) : (
        <p className="assumption-text">
          → {proposal.status === "EDITED" && proposal.editedChange ? proposal.editedChange : proposal.proposedChange}
        </p>
      )}

      <p className="assumption-reason">{proposal.rationale}</p>

      {proposal.evidence.length > 0 && (
        <ul className="context-list">
          {proposal.evidence.map((e, i) => (
            <li key={i}>
              <span className="context-source-tag">{e.sourceType}</span> {e.reference} - {e.description}
            </li>
          ))}
        </ul>
      )}

      <div className="impact-badges">
        {IMPACT_FIELD_LABELS.map(({ key, label }) => (
          <span key={key} className="impact-badge">
            {label}: {IMPACT_DIRECTION_LABELS[proposal.expectedImpact[key]] ?? proposal.expectedImpact[key]}
          </span>
        ))}
      </div>

      <div className="assumption-meta">Confidence {Math.round(proposal.confidence * 100)}%</div>

      <div className="actions">
        {editing ? (
          <>
            <button
              className="btn primary"
              disabled={busy || draft.trim().length === 0}
              onClick={() => {
                onDecide("EDIT", draft.trim());
                setEditing(false);
              }}
            >
              Speichern
            </button>
            <button className="btn secondary" disabled={busy} onClick={() => setEditing(false)}>
              Abbrechen
            </button>
          </>
        ) : (
          <>
            {proposal.status !== "ACCEPTED" && (
              <button className="btn primary" disabled={busy} onClick={() => onDecide("ACCEPT")}>
                Übernehmen
              </button>
            )}
            <button className="btn secondary" disabled={busy} onClick={() => setEditing(true)}>
              Bearbeiten
            </button>
            {proposal.status !== "REJECTED" && (
              <button className="btn secondary" disabled={busy} onClick={() => onDecide("REJECT")}>
                Ablehnen
              </button>
            )}
            {isDecided && <span className="context-hint" style={{ margin: 0 }}>Entscheidung kann jederzeit geändert werden.</span>}
          </>
        )}
      </div>
    </div>
  );
}
