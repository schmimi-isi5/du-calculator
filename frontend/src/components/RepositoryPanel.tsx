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
  const statusMeta = REPOSITORY_STATUS_META[snapshot?.status ?? "NOT_ANALYZED"];

  return (
    <div className="card">
      <h2>Repository analysieren</h2>
      <div className="row">
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
        <button className="btn secondary" onClick={onAnalyze} disabled={loading}>
          {loading ? "Analysiere…" : "Repository analysieren"}
        </button>
        <button className="btn secondary" onClick={onGreenfield} disabled={loading} title="Neue Anforderung ohne bestehendes Repository bewerten - Greenfield-Modus">
          Kein Repository vorhanden (Greenfield)
        </button>
        <span className={`status-pill ${statusMeta.variant}`}>{statusMeta.label}</span>
      </div>

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
