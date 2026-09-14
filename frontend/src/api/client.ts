import type { Requirement, RepositorySnapshot, ScoringResult } from "../types";

export class ApiError extends Error {}

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

export function analyzeRepository(repositoryUrl: string, branch: string): Promise<RepositorySnapshot> {
  return postJson<RepositorySnapshot>("/api/repository/analyze", { repositoryUrl, branch });
}

export function scoreRequirement(snapshotId: string, requirement: Requirement): Promise<ScoringResult> {
  return postJson<ScoringResult>("/api/requirement/score", { snapshotId, requirement });
}
