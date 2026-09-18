import type {
  ActualEffortRecord,
  AIUsageConfig,
  AIUsageLogEntry,
  AIUsageSummary,
  AssumptionAction,
  CustomerReport,
  OllamaStatus,
  QualityLevel,
  Requirement,
  RepositorySnapshot,
  RepositorySnapshotSummary,
  RepositoryStats,
  RequirementContext,
  ScoringHistoryEntry,
  ScoringResult,
  ScoringStats,
  SelectableModelsResponse,
  SettingsSnapshot,
  TechnologyKey,
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

async function putJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Backend nicht erreichbar. Läuft der DU Calculator Server?");
  }
  return handleResponse<T>(response);
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
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

/** GREENFIELD mode (commercial-du-v1 spec section 4) - no repository, creates a synthetic snapshot instantly. */
export function createGreenfieldSnapshot(label?: string): Promise<RepositorySnapshot> {
  return postJson<RepositorySnapshot>("/api/repository/greenfield", { label: label || undefined });
}

export function listRepositorySnapshots(limit?: number): Promise<RepositorySnapshotSummary[]> {
  const query = limit ? `?limit=${limit}` : "";
  return getJson<RepositorySnapshotSummary[]>(`/api/repository${query}`);
}

export function getRepositorySnapshot(id: string): Promise<RepositorySnapshot> {
  return getJson<RepositorySnapshot>(`/api/repository/${encodeURIComponent(id)}`);
}

export function resolveRequirementContext(
  snapshotId: string,
  requirement: Requirement,
  qualityLevel: QualityLevel,
  model?: string,
  privacyMode?: "local-only",
): Promise<RequirementContext> {
  return postJson<RequirementContext>("/api/requirement-context", {
    snapshotId,
    requirement,
    qualityLevel,
    model,
    privacyMode,
  });
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

export interface RequirementReviewUpdate {
  title?: string;
  acceptanceCriteria?: string[];
  constraints?: string[];
}

/** Reviewing/editing the AI-derived title/acceptance criteria/constraints (see RequirementReviewPanel.tsx) - a plain data update, no AI call. */
export function updateRequirementContextRequirement(
  contextId: string,
  update: RequirementReviewUpdate,
): Promise<RequirementContext> {
  return patchJson<RequirementContext>(`/api/requirement-context/${encodeURIComponent(contextId)}/requirement`, update);
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

export function getRepositoryStats(): Promise<RepositoryStats> {
  return getJson<RepositoryStats>("/api/repository/stats");
}

export function getRequirementStats(): Promise<ScoringStats> {
  return getJson<ScoringStats>("/api/requirement/stats");
}

/** No credentials/auth - security is by the unguessable scoring id only. See backend/src/api/customerReport.ts. */
export function getCustomerReport(id: string): Promise<CustomerReport> {
  return getJson<CustomerReport>(`/api/requirement/${encodeURIComponent(id)}/customer-report`);
}

export interface RecordActualEffortInput {
  actualHumanHours: number;
  actualImplementationMethod: TechnologyKey;
  notes?: string;
}

export function recordActualEffort(scoringId: string, input: RecordActualEffortInput): Promise<ActualEffortRecord> {
  return postJson<ActualEffortRecord>(`/api/requirement/${encodeURIComponent(scoringId)}/actual-effort`, input);
}

export function getActualEffortRecords(scoringId: string): Promise<ActualEffortRecord[]> {
  return getJson<ActualEffortRecord[]>(`/api/requirement/${encodeURIComponent(scoringId)}/actual-effort`);
}

export function getAIUsageSummary(from: Date, to: Date): Promise<AIUsageSummary> {
  const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return getJson<AIUsageSummary>(`/api/ai-usage/summary?${params.toString()}`);
}

export function getAIUsageConfig(): Promise<AIUsageConfig> {
  return getJson<AIUsageConfig>("/api/ai-usage/config");
}

export function getSelectableModels(): Promise<SelectableModelsResponse> {
  return getJson<SelectableModelsResponse>("/api/ai-usage/models");
}

export function getOllamaStatus(): Promise<OllamaStatus> {
  return getJson<OllamaStatus>("/api/ai-usage/ollama-status");
}

export function getSettings(): Promise<SettingsSnapshot> {
  return getJson<SettingsSnapshot>("/api/settings");
}

export function updateDefaultModel(modelId: string | null): Promise<SettingsSnapshot> {
  return putJson<SettingsSnapshot>("/api/settings/default-model", { modelId });
}

export function getAIUsageLog(from: Date, to: Date, limit = 500): Promise<AIUsageLogEntry[]> {
  const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), limit: String(limit) });
  return getJson<AIUsageLogEntry[]>(`/api/ai-usage/log?${params.toString()}`);
}
