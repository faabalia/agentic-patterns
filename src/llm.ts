import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { LIMITS } from "./config.js";

// Lee ANTHROPIC_API_KEY del entorno.
export const client = new Anthropic();

/** zod → JSON Schema válido para `input_schema` de una tool (sin la clave `$schema`). */
export function toInputSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const { $schema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest as Anthropic.Tool.InputSchema;
}

type StructuredOpts = {
  model: string;
  system: string;
  input: string;
  maxTokens?: number;
};

/**
 * Salida estructurada: fuerza una tool call con el esquema de zod y
 * valida el resultado en código. El modelo propone, el código garantiza.
 */
export async function structured<S extends z.ZodType>(
  schema: S,
  opts: StructuredOpts,
): Promise<z.infer<S>> {
  const resp = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? LIMITS.maxTokens,
    system: opts.system,
    messages: [{ role: "user", content: opts.input }],
    tools: [
      {
        name: "respond",
        description: "Devuelve la respuesta con el formato exigido.",
        input_schema: toInputSchema(schema),
      },
    ],
    tool_choice: { type: "tool", name: "respond" },
  });

  const block = resp.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("El modelo no devolvió salida estructurada");
  }
  return schema.parse(block.input);
}

/** Llamada de texto simple. */
export async function text(opts: StructuredOpts): Promise<string> {
  const resp = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? LIMITS.maxTokens,
    system: opts.system,
    messages: [{ role: "user", content: opts.input }],
  });
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
