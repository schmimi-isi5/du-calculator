import { useState } from "react";
import type { RepositorySnapshot } from "../types";
import { REPOSITORY_STATUS_META } from "../statusMeta";

interface Props {
  repositoryUrl: string;
  branch: string;
  accessToken: string;
  loading: boolean;
  requestError: string | null;
  snapshot: RepositorySnapshot | null;
  onChangeRepositoryUrl: (value: string) => void;
  onChangeBranch: (value: string) => void;
  onChangeAccessToken: (value: string) => void;
  onAnalyze: () => void;
  onGreenfield: () => void;
}

// The single most important decision on this screen is "existing repository
// or not" - it decides the whole rest of the flow (real code analysis vs.
// synthetic Greenfield snapshot). Surfacing it as an explicit either/or
// choice up front, rather than as a URL form plus an easy-to-miss escape
// button below it, is the intuitiveness fix from the UI/UX review.
type SourceMode = "existing" | "greenfield";

export function RepositoryPanel({
  repositoryUrl,
  branch,
  accessToken,
  loading,
  requestError,
  snapshot,
  onChangeRepositoryUrl,
  onChangeBranch,
  onChangeAccessToken,
  onAnalyze,
  onGreenfield,
}: Props) {
  const [mode, setMode] = useState<SourceMode>("existing");
  const statusMeta = REPOSITORY_STATUS_META[snapshot?.status ?? "NOT_ANALYZED"];

  return (
    <div className="card">
      <h2>Repository auswählen</h2>
      <p className="panel-intro">
        Gibt es bereits ein Repository, in das diese Anforderung eingebaut werden soll?
      </p>

      <div className="mode-toggle">
        <button
          type="button"
          className={mode === "existing" ? "active" : ""}
          onClick={() => setMode("existing")}
          disabled={loading}
        >
          Ja, bestehendes Repository
        </button>
        <button
          type="button"
          className={mode === "greenfield" ? "active" : ""}
          onClick={() => setMode("greenfield")}
          disabled={loading}
        >
          Nein, neues Vorhaben (Greenfield)
        </button>
      </div>

      {mode === "existing" ? (
        <>
          <div className="row" style={{ marginTop: 14 }}>
            <div>
              <label htmlFor="repositoryUrl">Repository URL</label>
              <input
                id="repositoryUrl"
                value={repositoryUrl}
                onChange={(e) => onChangeRepositoryUrl(e.target.value)}
                placeholder="https://github.com/org/repo.git"
              />
            </div>
            <div>
              <label htmlFor="branch">Branch</label>
              <input
                id="branch"
                value={branch}
                onChange={(e) => onChangeBranch(e.target.value)}
                placeholder="main"
              />
            </div>
          </div>

          <details className="inline-details">
            <summary>Privates Repository? Access Token hinterlegen</summary>
            <label htmlFor="accessToken">Access Token</label>
            <input
              id="accessToken"
              type="password"
              autoComplete="off"
              value={accessToken}
              onChange={(e) => onChangeAccessToken(e.target.value)}
              placeholder="ghp_… (nur für diesen Clone-Vorgang, wird nicht gespeichert)"
            />
          </details>

          <div className="actions">
            <button className="btn primary" onClick={onAnalyze} disabled={loading || !repositoryUrl.trim()}>
              {loading ? "Analysiere…" : "Repository analysieren"}
            </button>
            <span className={`status-pill ${statusMeta.variant}`}>{statusMeta.label}</span>
          </div>
        </>
      ) : (
        <>
          <p className="panel-intro" style={{ marginTop: 14 }}>
            Ohne Repository wird die Anforderung eigenständig bewertet - es gibt dann keine wiederverwendbaren
            Bestandteile, und "Bestehende Assets" bleibt in der Auswertung leer.
          </p>
          <div className="actions">
            <button className="btn primary" onClick={onGreenfield} disabled={loading}>
              {loading ? "Wird angelegt…" : "Ohne Repository starten"}
            </button>
            <span className={`status-pill ${statusMeta.variant}`}>{statusMeta.label}</span>
          </div>
        </>
      )}

      {requestError && <div className="notice error" style={{ marginTop: 10 }}>{requestError}</div>}

      {snapshot?.status === "ERROR" && snapshot.errorMessage && (
        <div className="notice error" style={{ marginTop: 10 }}>{snapshot.errorMessage}</div>
      )}

      {snapshot?.status === "SNAPSHOT_CREATED" && (
        <div className="repo-result">
          <div className="repo-result-meta">
            <code className="file-path">{snapshot.commitSha?.slice(0, 10)}</code>
            <span>·</span>
            <span>{snapshot.analyzedAt ? new Date(snapshot.analyzedAt).toLocaleString("de-DE") : "–"}</span>
            <span>·</span>
            <span>{snapshot.fileTree.length} Dateien berücksichtigt</span>
          </div>

          {snapshot.profile && <p className="repo-result-summary">{snapshot.profile.summary}</p>}

          {snapshot.profile && (
            <details className="inline-details">
              <summary>Technisches Profil im Detail</summary>

              <TagSection label="Sprachen" items={snapshot.profile.languages} />
              <TagSection label="Frameworks" items={snapshot.profile.frameworks} />
              <TagSection label="Services" items={snapshot.profile.services} />
              <TagSection label="Datenmodelle" items={snapshot.profile.dataModels} />
              <TagSection label="Integrationen" items={snapshot.profile.integrations} />
              <TagSection label="AI-Komponenten" items={snapshot.profile.aiComponents} />
              <TagSection label="Tests" items={snapshot.profile.tests} />
              <TagSection label="Deployment" items={snapshot.profile.deployment} />

              {snapshot.profile.findings.length > 0 && (
                <div className="profile-section">
                  <strong style={{ fontSize: 12 }}>Findings</strong>
                  {snapshot.profile.findings.map((finding, i) => (
                    <div className="finding" key={i}>
                      <span className={`finding-status ${finding.status}`}>{finding.status}</span>
                      {finding.finding}
                      {finding.evidence.map((ev, j) => (
                        <div className="evidence-line" key={j}>
                          <code className="file-path">{ev.file}</code> — {ev.reason}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function TagSection({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="profile-section">
      <strong style={{ fontSize: 12 }}>{label}</strong>
      <div className="tag-list">
        {items.map((item, i) => (
          <span className="tag" key={i}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
