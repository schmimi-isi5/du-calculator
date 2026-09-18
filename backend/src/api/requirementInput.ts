import type { Requirement } from "../domain/types.js";

const PLACEHOLDER_TITLE_MAX_LENGTH = 80;

/**
 * The user now types one free-text requirement description - no separate
 * title field (see api/requirementContextService.ts runContextResolution,
 * which overwrites this placeholder with the AI's own suggestedTitle on the
 * first resolution round). A title is still derived here, never left empty,
 * so Requirement.title is never blank for a caller that skips resolution
 * entirely or for the brief window before the AI's own title arrives.
 */
function derivePlaceholderTitle(description: string): string {
  const singleLine = description.replace(/\s+/g, " ").trim();
  if (singleLine.length <= PLACEHOLDER_TITLE_MAX_LENGTH) return singleLine;
  return `${singleLine.slice(0, PLACEHOLDER_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

export function parseRequirement(input: unknown): Requirement {
  if (typeof input !== "object" || input === null) {
    throw new Error("requirement is required.");
  }
  const value = input as Record<string, unknown>;
  const description = typeof value.description === "string" ? value.description.trim() : "";
  if (!description) throw new Error("requirement.description is required.");

  const explicitTitle = typeof value.title === "string" ? value.title.trim() : "";
  const title = explicitTitle || derivePlaceholderTitle(description);

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
