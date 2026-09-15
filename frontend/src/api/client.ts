import type {
  AIUsageConfig,
  AIUsageSummary,
  AssumptionAction,
  Requirement,
  RepositorySnapshot,
  RepositorySnapshotSummary,
  RequirementContext,
  ScoringHistoryEntry,
  ScoringResult,
} from "../types";

export class ApiError extends Error {}

async function handleResponse<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(`Unerwartete Serverantwort (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Anfrage fehlgeschlagen (HTTP ${response.status}).`;
    throw new ApiError(message);
  }

  return payload as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Backend nicht erreichbar. Läuft der DU Calculator Server?");
  }
  return handleResponse<T>(response);
}

async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path);
  } catch {
    throw new ApiError("Backend nicht erreichbar. Läuft der DU Calculator Server?");
  }
  return handleResponse<T>(response);
}

export function analyzeRepository(
  repositoryUrl: string,
  branch: string,
  accessToken?: string,
): Promise<RepositorySnapshot> {
  return postJson<RepositorySnapshot>("/api/repository/analyze", {
    repositoryUrl,
    branch,
    accessToken: accessToken || undefined,
  });
}

export function listRepositorySnapshots(): Promise<RepositorySnapshotSummary[]> {
  return getJson<RepositorySnapshotSummary[]>("/api/repository");
}

export function getRepositorySnapshot(id: string): Promise<RepositorySnapshot> {
  return getJson<RepositorySnapshot>(`/api/repository/${encodeURIComponent(id)}`);
}

export function resolveRequirementContext(
  snapshotId: string,
  requirement: Requirement,
): Promise<RequirementContext> {
  return postJson<RequirementContext>("/api/requirement-context", { snapshotId, requirement });
}

export function getRequirementContext(id: string): Promise<RequirementContext> {
  return getJson<RequirementContext>(`/api/requirement-context/${encodeURIComponent(id)}`);
}

export function answerClarifications(
  contextId: string,
  answers: { clarificationId: string; answer: string }[],
): Promise<RequirementContext> {
  return postJson<RequirementContext>(
    `/api/requirement-context/${encodeURIComponent(contextId)}/clarifications/answer`,
    { answers },
  );
}

export function applyAssumptionAction(
  contextId: string,
  assumptionId: string,
  action: AssumptionAction,
  editedText?: string,
): Promise<RequirementContext> {
  return postJson<RequirementContext>(
    `/api/requirement-context/${encodeURIComponent(contextId)}/assumptions/${encodeURIComponent(assumptionId)}`,
    { action, editedText },
  );
}

export function scoreRequirement(contextId: string): Promise<ScoringResult> {
  return postJson<ScoringResult>("/api/requirement/score", { contextId });
}

export function getScoringHistory(): Promise<ScoringHistoryEntry[]> {
  return getJson<ScoringHistoryEntry[]>("/api/requirement/history");
}

export function getScoringResult(id: string): Promise<ScoringResult> {
  return getJson<ScoringResult>(`/api/requirement/${encodeURIComponent(id)}`);
}

export function getAIUsageSummary(from: Date, to: Date): Promise<AIUsageSummary> {
  const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return getJson<AIUsageSummary>(`/api/ai-usage/summary?${params.toString()}`);
}

export function getAIUsageConfig(): Promise<AIUsageConfig> {
  return getJson<AIUsageConfig>("/api/ai-usage/config");
}
