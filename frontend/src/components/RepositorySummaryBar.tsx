import type { RepositorySnapshot } from "../types";

interface Props {
  snapshot: RepositorySnapshot;
  onChangeRepository: () => void;
}

export function RepositorySummaryBar({ snapshot, onChangeRepository }: Props) {
  return (
    <div className="repo-summary-bar">
      <div>
        <div className="repo-summary-name">
          {snapshot.repositoryUrl.replace(/^https?:\/\//, "")} @ {snapshot.branch}
        </div>
        <div className="repo-summary-meta">
          <code className="file-path">{snapshot.commitSha?.slice(0, 10)}</code>
          {snapshot.profile && <span> · {snapshot.profile.summary}</span>}
        </div>
      </div>
      <button className="btn secondary" onClick={onChangeRepository}>
        Repository wechseln
      </button>
    </div>
  );
}
