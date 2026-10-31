import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

/* ─────────────── Patrón 09 · Human-in-the-loop ─────────────── */

export type Decision =
  | { status: "approved"; editedArgs?: unknown }
  | { status: "rejected"; reason: string };

/**
 * Implementación CLI de la cola de aprobación.
 * En producción: ticket en BD + notificación (Slack, email, panel)
 * y espera asíncrona con timeout.
 */
export async function requestApproval(call: { name: string; args: unknown }): Promise<Decision> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    console.log("\n⚠️  APROBACIÓN REQUERIDA");
    console.log(`   Acción:     ${call.name}`);
    console.log(`   Argumentos: ${JSON.stringify(call.args)}`);
    const answer = (await rl.question("   ¿Aprobar? [s]í / [n]o: ")).trim().toLowerCase();

    if (answer === "s" || answer === "si" || answer === "sí") return { status: "approved" };

    const reason = (await rl.question("   Motivo del rechazo: ")).trim() || "Sin motivo indicado";
    return { status: "rejected", reason };
  } finally {
    rl.close();
  }
}
