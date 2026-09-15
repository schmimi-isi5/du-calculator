import { useState } from "react";
import { analyzeRepository, ApiError, getRepositorySnapshot, getScoringResult, scoreRequirement } from "./api/client";
import { HistoryPanel } from "./components/HistoryPanel";
import { RepositoryPanel } from "./components/RepositoryPanel";
import { RepositoryPicker } from "./components/RepositoryPicker";
import { RepositorySummaryBar } from "./components/RepositorySummaryBar";
import { RequirementPanel } from "./components/RequirementPanel";
import { ResultHero } from "./components/ResultHero";
import { ScoringPanel } from "./components/ScoringPanel";
import type { WizardStep } from "./components/WizardSteps";
import { WizardSteps } from "./components/WizardSteps";
import type { RepositorySnapshot, ScoringResult, UiLanguage } from "./types";

function linesToList(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

type Tab = "new" | "history";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("new");
  const [language, setLanguage] = useState<UiLanguage>("de");
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);

  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [accessToken, setAccessToken] = useState("");
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoRequestError, setRepoRequestError] = useState<string | null>(null);
  const [repoPickerRefreshToken, setRepoPickerRefreshToken] = useState(0);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [constraints, setConstraints] = useState("");
  const [scoringResult, setScoringResult] = useState<ScoringResult | null>(null);
  const [scoringLoading, setScoringLoading] = useState(false);

  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  const [historySelectedId, setHistorySelectedId] = useState<string | null>(null);
  const [historyResult, setHistoryResult] = useState<ScoringResult | null>(null);
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false);
  const [historyDetailError, setHistoryDetailError] = useState<string | null>(null);

  const isRepositoryReady = snapshot?.status === "SNAPSHOT_CREATED";
  const maxReachableStep: WizardStep = scoringLoading || scoringResult ? 3 : isRepositoryReady ? 2 : 1;

  async function handleAnalyze() {
    setRepoLoading(true);
    setRepoRequestError(null);
    setSnapshot(null);
    setScoringResult(null);
    try {
      const result = await analyzeRepository(repositoryUrl, branch, accessToken);
      setSnapshot(result);
      if (result.status === "SNAPSHOT_CREATED") {
        setRepoPickerRefreshToken((token) => token + 1);
      }
    } catch (err) {
      setRepoRequestError(err instanceof ApiError ? err.message : "Unerwarteter Fehler.");
    } finally {
      setRepoLoading(false);
    }
  }

  async function handleUseExistingRepository(id: string) {
    setRepoLoading(true);
    setRepoRequestError(null);
    setScoringResult(null);
    try {
      const result = await getRepositorySnapshot(id);
      setSnapshot(result);
      setRepositoryUrl(result.repositoryUrl);
      setBranch(result.branch);
    } catch (err) {
      setRepoRequestError(err instanceof ApiError ? err.message : "Unerwarteter Fehler.");
    } finally {
      setRepoLoading(false);
    }
  }

  function handleChangeRepository() {
    setSnapshot(null);
    setScoringResult(null);
    setWizardStep(1);
  }

  async function handleScore() {
    if (!snapshot || snapshot.status !== "SNAPSHOT_CREATED") return;
    setWizardStep(3);
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
      // A new scoring result was persisted - the history list should reflect it next time it's viewed.
      setHistoryRefreshToken((token) => token + 1);
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
        overallAssessment: null,
        openQuestions: [],
        errorMessage: err instanceof ApiError ? err.message : "Unerwarteter Fehler.",
        scoredAt: null,
      });
    } finally {
      setScoringLoading(false);
    }
  }

  async function handleSelectHistoryEntry(id: string) {
    setHistorySelectedId(id);
    setHistoryDetailLoading(true);
    setHistoryDetailError(null);
    setHistoryResult(null);
    try {
      const result = await getScoringResult(id);
      setHistoryResult(result);
    } catch (err) {
      setHistoryDetailError(err instanceof ApiError ? err.message : "Unerwarteter Fehler.");
    } finally {
      setHistoryDetailLoading(false);
    }
  }

  const canSubmitRequirement = isRepositoryReady && title.trim().length > 0 && description.trim().length > 0;

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
        <div className="tabs">
          <button className={activeTab === "new" ? "active" : ""} onClick={() => setActiveTab("new")}>
            Neue Bewertung
          </button>
          <button className={activeTab === "history" ? "active" : ""} onClick={() => setActiveTab("history")}>
            Historie
          </button>
        </div>

        {activeTab === "new" && (
          <>
            <WizardSteps currentStep={wizardStep} maxReachableStep={maxReachableStep} onStepClick={setWizardStep} />

            {wizardStep === 1 && (
              <div className="wizard-single-column">
                <RepositoryPicker
                  activeSnapshotId={snapshot?.id ?? null}
                  onUse={handleUseExistingRepository}
                  refreshToken={repoPickerRefreshToken}
                />

                <RepositoryPanel
                  repositoryUrl={repositoryUrl}
                  branch={branch}
                  accessToken={accessToken}
                  loading={repoLoading}
                  requestError={repoRequestError}
                  snapshot={snapshot}
                  onChangeRepositoryUrl={setRepositoryUrl}
                  onChangeBranch={setBranch}
                  onChangeAccessToken={setAccessToken}
                  onAnalyze={handleAnalyze}
                />

                {isRepositoryReady && (
                  <div className="wizard-next">
                    <button className="btn primary" onClick={() => setWizardStep(2)}>
                      Weiter: Anforderung stellen →
                    </button>
                  </div>
                )}
              </div>
            )}

            {wizardStep === 2 && snapshot && (
              <div className="wizard-single-column">
                <RepositorySummaryBar snapshot={snapshot} onChangeRepository={handleChangeRepository} />

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
              </div>
            )}

            {wizardStep === 3 && snapshot && (
              <div className="grid">
                <section>
                  <RepositorySummaryBar snapshot={snapshot} onChangeRepository={handleChangeRepository} />

                  <div className="wizard-back">
                    <button className="btn secondary" onClick={() => setWizardStep(2)}>
                      ← Zurück zur Anforderung
                    </button>
                  </div>

                  <ScoringPanel
                    loading={scoringLoading}
                    result={scoringResult}
                    language={language}
                    onChangeLanguage={setLanguage}
                  />
                </section>

                <aside>
                  <ResultHero result={scoringResult} />
                </aside>
              </div>
            )}
          </>
        )}

        {activeTab === "history" && (
          <div className="grid">
            <section>
              <HistoryPanel
                selectedId={historySelectedId}
                onSelect={handleSelectHistoryEntry}
                refreshToken={historyRefreshToken}
              />

              {historyDetailError && <div className="notice error">{historyDetailError}</div>}

              {historySelectedId && (
                <ScoringPanel
                  loading={historyDetailLoading}
                  result={historyResult}
                  language={language}
                  onChangeLanguage={setLanguage}
                />
              )}
            </section>

            <aside>{historySelectedId && <ResultHero result={historyResult} />}</aside>
          </div>
        )}
      </main>
    </>
  );
}
