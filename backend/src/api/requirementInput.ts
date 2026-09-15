import type { Requirement } from "../domain/types.js";

export function parseRequirement(input: unknown): Requirement {
  if (typeof input !== "object" || input === null) {
    throw new Error("requirement is required.");
  }
  const value = input as Record<string, unknown>;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const description = typeof value.description === "string" ? value.description.trim() : "";

  if (!title) throw new Error("requirement.title is required.");
  if (!description) throw new Error("requirement.description is required.");

  return {
    title,
    description,
    acceptanceCriteria: toStringArray(value.acceptanceCriteria),
    constraints: toStringArray(value.constraints),
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}
