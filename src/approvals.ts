import type { Interface } from "node:readline/promises";

/* ─────────────── Patrón 09 · Human-in-the-loop ─────────────── */

export type Decision =
  | { status: "approved"; editedArgs?: unknown }
  | { status: "rejected"; reason: string };

/**
 * Implementación CLI de la cola de aprobación.
 * En producción: ticket en BD + notificación (Slack, email, panel)
 * y espera asíncrona con timeout.
 */
let rl: Interface | undefined;

/** Comparte el readline del CLI: dos interfaces sobre stdin se disputarían la respuesta. */
export function setApprovalInterface(iface: Interface) {
  rl = iface;
}

export async function requestApproval(call: {
  name: string;
  args: unknown;
  customerId: string;
  userMessage: string;
}): Promise<Decision> {
  // Sin canal de aprobación no se ejecuta nada: denegar por defecto.
  if (!rl) return { status: "rejected", reason: "No hay canal de aprobación disponible" };

  console.log("\n⚠️  APROBACIÓN REQUERIDA");
  console.log(`   Cliente:    ${call.customerId}`);
  // JSON.stringify escapa caracteres de control: evita secuencias ANSI que falseen el aviso.
  console.log(`   Mensaje:    ${JSON.stringify(call.userMessage.slice(0, 300))}`);
  console.log(`   Acción:     ${call.name}`);
  console.log(`   Argumentos: ${JSON.stringify(call.args)}`);
  const answer = (await rl.question("   ¿Aprobar? [s]í / [n]o: ")).trim().toLowerCase();

  if (answer === "s" || answer === "si" || answer === "sí") return { status: "approved" };

  const reason = (await rl.question("   Motivo del rechazo: ")).trim() || "Sin motivo indicado";
  return { status: "rejected", reason };
}
