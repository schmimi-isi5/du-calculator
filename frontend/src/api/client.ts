import type { Requirement, RepositorySnapshot, ScoringHistoryEntry, ScoringResult } from "../types";

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

export function analyzeRepository(repositoryUrl: string, branch: string): Promise<RepositorySnapshot> {
  return postJson<RepositorySnapshot>("/api/repository/analyze", { repositoryUrl, branch });
}

export function scoreRequirement(snapshotId: string, requirement: Requirement): Promise<ScoringResult> {
  return postJson<ScoringResult>("/api/requirement/score", { snapshotId, requirement });
}

export function getScoringHistory(): Promise<ScoringHistoryEntry[]> {
  return getJson<ScoringHistoryEntry[]>("/api/requirement/history");
}

export function getScoringResult(id: string): Promise<ScoringResult> {
  return getJson<ScoringResult>(`/api/requirement/${encodeURIComponent(id)}`);
}
