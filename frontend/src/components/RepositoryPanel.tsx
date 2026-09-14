import type { RepositorySnapshot } from "../types";
import { REPOSITORY_STATUS_META } from "../statusMeta";

interface Props {
  repositoryUrl: string;
  branch: string;
  loading: boolean;
  requestError: string | null;
  snapshot: RepositorySnapshot | null;
  onChangeRepositoryUrl: (value: string) => void;
  onChangeBranch: (value: string) => void;
  onAnalyze: () => void;
}

export function RepositoryPanel({
  repositoryUrl,
  branch,
  loading,
  requestError,
  snapshot,
  onChangeRepositoryUrl,
  onChangeBranch,
  onAnalyze,
}: Props) {
  const statusMeta = REPOSITORY_STATUS_META[snapshot?.status ?? "NOT_ANALYZED"];

  return (
    <div className="card">
      <h2>1 · Repository</h2>
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

      <div className="actions">
        <button className="btn secondary" onClick={onAnalyze} disabled={loading}>
          {loading ? "Analysiere…" : "Repository analysieren"}
        </button>
        <span className={`status-pill ${statusMeta.variant}`}>{statusMeta.label}</span>
      </div>

      {requestError && <div className="notice error" style={{ marginTop: 10 }}>{requestError}</div>}

      {snapshot?.status === "ERROR" && snapshot.errorMessage && (
        <div className="notice error" style={{ marginTop: 10 }}>{snapshot.errorMessage}</div>
      )}

      {snapshot?.status === "SNAPSHOT_CREATED" && (
        <div className="repo-result">
          <dl>
            <dt>Commit SHA</dt>
            <dd>
              <code className="file-path">{snapshot.commitSha}</code>
            </dd>
            <dt>Analysiert am</dt>
            <dd>{snapshot.analyzedAt ? new Date(snapshot.analyzedAt).toLocaleString("de-DE") : "–"}</dd>
            <dt>Berücksichtigte Dateien</dt>
            <dd>{snapshot.fileTree.length}</dd>
          </dl>

          {snapshot.profile && (
            <>
              <p style={{ margin: "0 0 10px" }}>{snapshot.profile.summary}</p>

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
            </>
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
