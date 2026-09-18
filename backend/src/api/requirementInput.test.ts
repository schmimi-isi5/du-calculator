import { describe, expect, it } from "vitest";
import { parseRequirement } from "./requirementInput.js";

describe("parseRequirement", () => {
  it("requires a description but no longer a title", () => {
    expect(() => parseRequirement({ description: "" })).toThrow(/description is required/);
    expect(() => parseRequirement({})).toThrow(/description is required/);
    expect(() => parseRequirement({ description: "Ein Text." })).not.toThrow();
  });

  it("derives a placeholder title from the description when none is given", () => {
    const result = parseRequirement({ description: "Kunden sollen ihre Rechnungen online einsehen können." });
    expect(result.title).toBe("Kunden sollen ihre Rechnungen online einsehen können.");
  });

  it("truncates a long description into a short placeholder title", () => {
    const description =
      "Dies ist eine sehr lange Anforderungsbeschreibung, die weit über achtzig Zeichen hinausgeht und deshalb für den Platzhalter-Titel gekürzt werden muss.";
    const result = parseRequirement({ description });
    expect(result.title.length).toBeLessThanOrEqual(80);
    expect(result.title.endsWith("…")).toBe(true);
  });

  it("collapses whitespace/newlines in the placeholder title", () => {
    const result = parseRequirement({ description: "Zeile eins\n\nZeile zwei" });
    expect(result.title).toBe("Zeile eins Zeile zwei");
  });

  it("uses an explicit title verbatim when one is given", () => {
    const result = parseRequirement({ title: "Mein Titel", description: "Beschreibung." });
    expect(result.title).toBe("Mein Titel");
  });

  it("defaults acceptanceCriteria/constraints to empty arrays", () => {
    const result = parseRequirement({ description: "Beschreibung." });
    expect(result.acceptanceCriteria).toEqual([]);
    expect(result.constraints).toEqual([]);
  });
});
