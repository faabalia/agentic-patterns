import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { toInputSchema } from "./llm.js";

/* Herramientas simuladas. Diséñalas como una buena API:
   nombres inequívocos, parámetros estrictos, errores accionables. */

export type Risk = "low" | "high";

/** Contexto inyectado por el código (nunca por el modelo): identidad del cliente y cancelación. */
export type ToolContext = { customerId: string; signal: AbortSignal };

export type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  risk: Risk;
  schema: S;
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<string>;
};

// Datos de ejemplo
type Invoice = { customerId: string; amount: number; refunded: number; status: string; date: string };
const INVOICES: Record<string, Invoice> = {
  "INV-1001": { customerId: "cus-demo", amount: 49.9, refunded: 0, status: "pagada", date: "2026-09-15" },
  "INV-1002": { customerId: "cus-demo", amount: 120.0, refunded: 0, status: "pendiente", date: "2026-10-02" },
  "INV-2001": { customerId: "cus-otro", amount: 300.0, refunded: 0, status: "pagada", date: "2026-10-10" },
};

/** Solo devuelve facturas del cliente autenticado; "no existe" y "no es tuya" son indistinguibles. */
function ownInvoice(invoiceId: string, ctx: ToolContext): Invoice | undefined {
  const inv = INVOICES[invoiceId];
  return inv && inv.customerId === ctx.customerId ? inv : undefined;
}

const lookupInvoice: ToolDef<z.ZodObject<{ invoiceId: z.ZodString }>> = {
  name: "lookup_invoice",
  description: "Consulta el importe, estado y fecha de una factura por su ID (formato INV-XXXX). Solo lectura.",
  risk: "low",
  schema: z.object({ invoiceId: z.string().regex(/^INV-\d{4}$/) }),
  run: async ({ invoiceId }, ctx) => {
    const inv = ownInvoice(invoiceId, ctx);
    if (!inv) return `Error: la factura ${invoiceId} no existe. Pide al usuario que verifique el ID.`;
    const { amount, refunded, status, date } = inv;
    return JSON.stringify({ invoiceId, amount, refunded, status, date });
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
  run: async ({ invoiceId, amount }, ctx) => {
    const inv = ownInvoice(invoiceId, ctx);
    if (!inv) throw new Error(`la factura ${invoiceId} no existe`);
    if (inv.status !== "pagada") throw new Error(`la factura ${invoiceId} no admite reembolso (estado: ${inv.status})`);
    // Acumulado: impide reembolsar varias veces la misma factura por encima de su importe.
    const available = Math.round((inv.amount - inv.refunded) * 100) / 100;
    if (amount > available) throw new Error(`el importe supera lo reembolsable (${available} EUR)`);
    if (ctx.signal.aborted) throw new Error("operación cancelada");
    inv.refunded = Math.round((inv.refunded + amount) * 100) / 100;
    if (inv.refunded >= inv.amount) inv.status = "reembolsada";
    return `Reembolso de ${amount} EUR emitido sobre ${invoiceId}.`;
  },
};

const searchDocs: ToolDef<z.ZodObject<{ query: z.ZodString }>> = {
  name: "search_docs",
  description: "Busca en la base de conocimiento de soporte técnico. Solo lectura.",
  risk: "low",
  schema: z.object({ query: z.string().min(2).max(200) }),
  // No se refleja la consulta en la salida: evita inyección reflejada hacia el modelo y el juez.
  run: async () => "Resultados: 1) Reinicia la app y borra la caché. 2) Si persiste, actualiza a la v3.2.",
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
