import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { toInputSchema } from "./llm.js";

/* Herramientas simuladas. Diséñalas como una buena API:
   nombres inequívocos, parámetros estrictos, errores accionables. */

export type Risk = "low" | "high";

export type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  risk: Risk;
  schema: S;
  run: (args: z.infer<S>) => Promise<string>;
};

// Datos de ejemplo
const INVOICES: Record<string, { amount: number; status: string; date: string }> = {
  "INV-1001": { amount: 49.9, status: "pagada", date: "2026-09-15" },
  "INV-1002": { amount: 120.0, status: "pendiente", date: "2026-10-02" },
};

const lookupInvoice: ToolDef<z.ZodObject<{ invoiceId: z.ZodString }>> = {
  name: "lookup_invoice",
  description: "Consulta el importe, estado y fecha de una factura por su ID (formato INV-XXXX). Solo lectura.",
  risk: "low",
  schema: z.object({ invoiceId: z.string().regex(/^INV-\d{4}$/) }),
  run: async ({ invoiceId }) => {
    const inv = INVOICES[invoiceId];
    if (!inv) return `Error: la factura ${invoiceId} no existe. Pide al usuario que verifique el ID.`;
    return JSON.stringify({ invoiceId, ...inv });
  },
};

const issueRefund: ToolDef<z.ZodObject<{ invoiceId: z.ZodString; amount: z.ZodNumber; reason: z.ZodString }>> = {
  name: "issue_refund",
  description:
    "Emite un reembolso sobre una factura PAGADA. EFECTO SECUNDARIO: mueve dinero y es difícil de revertir.",
  risk: "high",
  schema: z.object({
    invoiceId: z.string().regex(/^INV-\d{4}$/),
    amount: z.number().positive().max(500),
    reason: z.string().min(5),
  }),
  run: async ({ invoiceId, amount }) => {
    const inv = INVOICES[invoiceId];
    if (!inv) return `Error: la factura ${invoiceId} no existe.`;
    if (inv.status !== "pagada") return `Error: la factura ${invoiceId} no está pagada, no se puede reembolsar.`;
    if (amount > inv.amount) return `Error: el importe supera el de la factura (${inv.amount}).`;
    return `Reembolso de ${amount} EUR emitido sobre ${invoiceId}.`;
  },
};

const searchDocs: ToolDef<z.ZodObject<{ query: z.ZodString }>> = {
  name: "search_docs",
  description: "Busca en la base de conocimiento de soporte técnico. Solo lectura.",
  risk: "low",
  schema: z.object({ query: z.string().min(2) }),
  run: async ({ query }) =>
    `Resultados para "${query}": 1) Reinicia la app y borra la caché. 2) Si persiste, actualiza a la v3.2.`,
};

const getPlans: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "get_plans",
  description: "Lista los planes y precios vigentes. Solo lectura.",
  risk: "low",
  schema: z.object({}),
  run: async () => JSON.stringify([{ plan: "Starter", eur: 9 }, { plan: "Pro", eur: 29 }, { plan: "Team", eur: 79 }]),
};

export const TOOLS: Record<string, ToolDef<any>> = Object.fromEntries(
  [lookupInvoice, issueRefund, searchDocs, getPlans].map((t) => [t.name, t]),
);

/** Cada destino del router recibe SOLO las herramientas que necesita. */
export const TOOLSETS = {
  billing: ["lookup_invoice", "issue_refund"],
  tech: ["search_docs"],
  sales: ["get_plans"],
} as const;

export function toApiTools(names: readonly string[]): Anthropic.Tool[] {
  return names.map((n) => {
    const t = TOOLS[n]!;
    return {
      name: t.name,
      description: t.description,
      input_schema: toInputSchema(t.schema),
    };
  });
}
