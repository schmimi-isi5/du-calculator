import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toOpenAIStrictJsonSchema } from "./openAIStrictSchema.js";

describe("toOpenAIStrictJsonSchema", () => {
  it("puts every property in required, marking originally-optional ones nullable", () => {
    const schema = z.object({
      title: z.string(),
      note: z.string().optional(),
    });

    const result = toOpenAIStrictJsonSchema(schema) as Record<string, unknown>;

    expect(result.required).toEqual(["title", "note"]);
    expect(result.additionalProperties).toBe(false);
    const properties = result.properties as Record<string, { type: unknown }>;
    expect(properties.note?.type).toEqual(["string", "null"]);
    expect(properties.title?.type).toBe("string");
  });

  it("recurses into nested objects and arrays of objects", () => {
    const schema = z.object({
      items: z.array(
        z.object({
          name: z.string(),
          detail: z.string().optional(),
        }),
      ),
    });

    const result = toOpenAIStrictJsonSchema(schema) as any;
    const itemSchema = result.properties.items.items;

    expect(itemSchema.required).toEqual(["name", "detail"]);
    expect(itemSchema.additionalProperties).toBe(false);
    expect(itemSchema.properties.detail.type).toEqual(["string", "null"]);
  });

  it("leaves already-required fields untouched", () => {
    const schema = z.object({ a: z.string(), b: z.number() });
    const result = toOpenAIStrictJsonSchema(schema) as any;

    expect(result.required).toEqual(["a", "b"]);
    expect(result.properties.a.type).toBe("string");
    expect(result.properties.b.type).toBe("number");
  });
});
