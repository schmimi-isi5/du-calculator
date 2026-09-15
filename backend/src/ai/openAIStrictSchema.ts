// OpenAI's structured-output "strict" mode (see OpenAICompatibleProvider)
// requires every object property to appear in `required` - an optional
// field is expressed as a nullable type instead of an absent key - and
// `additionalProperties: false` on every object. zod's own `toJSONSchema()`
// produces plain, standard JSON Schema (optional fields simply omitted from
// `required`), so this adapter walks that output and rewrites it to match
// OpenAI's stricter subset. Callers must treat `null` the same as "absent"
// for any field that was originally optional.
import { toJSONSchema, type ZodType } from "zod";

type JsonSchemaNode = Record<string, unknown>;

function isRecord(value: unknown): value is JsonSchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeNullable(propertySchema: JsonSchemaNode): void {
  if (Array.isArray(propertySchema.type)) {
    if (!propertySchema.type.includes("null")) propertySchema.type.push("null");
    return;
  }
  if (typeof propertySchema.type === "string") {
    propertySchema.type = [propertySchema.type, "null"];
    return;
  }
  if (Array.isArray(propertySchema.anyOf)) {
    propertySchema.anyOf = [...propertySchema.anyOf, { type: "null" }];
    return;
  }
  // $ref or another shape with no direct `type` - wrap it instead of
  // guessing how to mutate it in place.
  const wrapped = { ...propertySchema };
  for (const key of Object.keys(propertySchema)) delete propertySchema[key];
  propertySchema.anyOf = [wrapped, { type: "null" }];
}

function walk(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(walk);
    return;
  }
  if (!isRecord(node)) return;

  if (node.type === "object" && isRecord(node.properties)) {
    const properties = node.properties;
    const originallyRequired = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
    const allKeys = Object.keys(properties);

    for (const key of allKeys) {
      const propertySchema = properties[key];
      if (isRecord(propertySchema)) {
        walk(propertySchema);
        if (!originallyRequired.has(key)) makeNullable(propertySchema);
      }
    }

    node.required = allKeys;
    node.additionalProperties = false;
  }

  // Recurse into every nested schema container regardless of the branch
  // above, so arrays-of-objects, $defs, and composition keywords are covered.
  if (isRecord(node.items)) walk(node.items);
  if (isRecord(node.$defs)) Object.values(node.$defs).forEach(walk);
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(node[key])) (node[key] as unknown[]).forEach(walk);
  }
}

export function toOpenAIStrictJsonSchema(schema: ZodType): Record<string, unknown> {
  const jsonSchema = toJSONSchema(schema) as JsonSchemaNode;
  walk(jsonSchema);
  return jsonSchema;
}
