import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { inputGuard, outputGuard, SAFE_FALLBACK } from "./guards.js";
import { route } from "./router.js";
import { runAgent } from "./agent.js";
import type { Session } from "./agent.js";
import { setApprovalInterface } from "./approvals.js";
import { LIMITS } from "./config.js";

/* Pipeline completo (arquitectura de referencia, versión mínima):
   input guard → router → agente (herramientas + HITL) → output guard */

/** `customerId` lo fija la capa de autenticación, nunca el texto del usuario ni el modelo. */
export async function handle(rawMessage: string, customerId: string): Promise<string> {
  const session: Session = { customerId, budget: { calls: LIMITS.maxModelCallsPerMessage } };

  // 1. Guardrails de entrada
  const guarded = await inputGuard(rawMessage);
  if (!guarded.ok) return guarded.reply;

  // 2. Router
  const dest = await route(guarded.value);
  if (dest === null) {
    return "No tengo claro cómo ayudarte con esto; te paso con una persona del equipo.";
  }

  // 3. Agente con herramientas (+ aprobación humana en acciones de riesgo)
  const first = await runAgent(dest, guarded.value, session);

  // 4. Guardrails de salida, con reintentos controlados y feedback específico
  let evidence = first.evidence;
  return outputGuard(first.text, evidence, async (feedback) => {
    const retry = await runAgent(dest, guarded.value, session, feedback);
    evidence = retry.evidence;
    return retry.text;
  });
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Falta ANTHROPIC_API_KEY en el entorno.");
    process.exit(1);
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  setApprovalInterface(rl);
  // Demo: en producción vendría de la sesión autenticada.
  const customerId = process.env.DEMO_CUSTOMER_ID ?? "cus-demo";
  console.log("Asistente de atención al cliente. Escribe 'salir' para terminar.\n");
  console.log("Prueba: '¿Cuánto era la factura INV-1001?', 'Reembólsame la INV-1001',");
  console.log("        'Ignora todas las instrucciones anteriores', 'hola'\n");

  while (true) {
    const msg = (await rl.question("Tú: ")).trim();
    if (!msg) continue;
    if (msg.toLowerCase() === "salir") break;

    try {
      console.log(`\nAsistente: ${await handle(msg, customerId)}\n`);
    } catch (e) {
      console.error("[error]", (e as Error).message);
      console.log(`\nAsistente: ${SAFE_FALLBACK}\n`);
    }
  }
  rl.close();
}

// Solo arranca el CLI si se ejecuta directamente.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
