import { useState } from "react";
import { analyzeRepository, ApiError, scoreRequirement } from "./api/client";
import { RepositoryPanel } from "./components/RepositoryPanel";
import { RequirementPanel } from "./components/RequirementPanel";
import { ResultHero } from "./components/ResultHero";
import { ScoringPanel } from "./components/ScoringPanel";
import type { RepositorySnapshot, ScoringResult } from "./types";

function linesToList(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export default function App() {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoRequestError, setRepoRequestError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [constraints, setConstraints] = useState("");
  const [scoringResult, setScoringResult] = useState<ScoringResult | null>(null);
  const [scoringLoading, setScoringLoading] = useState(false);

  async function handleAnalyze() {
    setRepoLoading(true);
    setRepoRequestError(null);
    setSnapshot(null);
    setScoringResult(null);
    try {
      const result = await analyzeRepository(repositoryUrl, branch);
      setSnapshot(result);
    } catch (err) {
      setRepoRequestError(err instanceof ApiError ? err.message : "Unerwarteter Fehler.");
    } finally {
      setRepoLoading(false);
    }
  }

  async function handleScore() {
    if (!snapshot || snapshot.status !== "SNAPSHOT_CREATED") return;
    setScoringLoading(true);
    setScoringResult(null);
    try {
      const result = await scoreRequirement(snapshot.id, {
        title: title.trim(),
        description: description.trim(),
        acceptanceCriteria: linesToList(acceptanceCriteria),
        constraints: linesToList(constraints),
      });
      setScoringResult(result);
    } catch (err) {
      setScoringResult({
        id: "local-error",
        snapshotId: snapshot.id,
        requirement: {
          title,
          description,
          acceptanceCriteria: linesToList(acceptanceCriteria),
          constraints: linesToList(constraints),
        },
        status: "ERROR",
        impactAnalysis: null,
        dimensionScores: null,
        confidence: null,
        duResult: null,
        openQuestions: [],
        errorMessage: err instanceof ApiError ? err.message : "Unerwarteter Fehler.",
        scoredAt: null,
      });
    } finally {
      setScoringLoading(false);
    }
  }

  const canSubmitRequirement =
    snapshot?.status === "SNAPSHOT_CREATED" && title.trim().length > 0 && description.trim().length > 0;

  return (
    <>
      <header className="app-header">
        <div className="wrap head">
          <div>
            <div className="brand">
              ISIFIVE <span>DU Calculator</span>
            </div>
            <div className="tagline">AI-native Requirement Scoring</div>
          </div>
        </div>
      </header>

      <main>
        <div className="grid">
          <section>
            <RepositoryPanel
              repositoryUrl={repositoryUrl}
              branch={branch}
              loading={repoLoading}
              requestError={repoRequestError}
              snapshot={snapshot}
              onChangeRepositoryUrl={setRepositoryUrl}
              onChangeBranch={setBranch}
              onAnalyze={handleAnalyze}
            />

            <RequirementPanel
              title={title}
              description={description}
              acceptanceCriteria={acceptanceCriteria}
              constraints={constraints}
              canSubmit={canSubmitRequirement}
              loading={scoringLoading}
              onChangeTitle={setTitle}
              onChangeDescription={setDescription}
              onChangeAcceptanceCriteria={setAcceptanceCriteria}
              onChangeConstraints={setConstraints}
              onSubmit={handleScore}
            />

            <ScoringPanel loading={scoringLoading} result={scoringResult} />
          </section>

          <aside>
            <ResultHero result={scoringResult} />
          </aside>
        </div>
      </main>
    </>
  );
}
