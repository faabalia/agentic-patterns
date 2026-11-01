import { handle } from "../index.js";
import { setApprovalHandler } from "../approvals.js";
import { SAFE_FALLBACK } from "../guards.js";
import { LIMITS } from "../config.js";
import { ApprovalBroker } from "./application/approval-broker.js";
import { ChatService } from "./application/chat-service.js";
import { createWebServer, listenWebServer } from "./infrastructure/http-server.js";

/* Composition root del canal web: une el pipeline existente con el broker de aprobaciones. */

function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Falta ANTHROPIC_API_KEY en el entorno.");
    process.exit(1);
  }

  // Demo: en producción vendría de la sesión autenticada, nunca del cliente.
  const customerId = process.env.DEMO_CUSTOMER_ID ?? "cus-demo";

  const broker = new ApprovalBroker({ timeoutMs: LIMITS.approvalTimeoutMs });
  setApprovalHandler((call) => broker.request(call));

  const chat = new ChatService(async (message) => {
    try {
      return await handle(message, customerId);
    } catch (error) {
      // Solo el tipo de error: nunca texto del usuario o del modelo sin enmascarar.
      console.error("[web] fallo del pipeline:", error instanceof Error ? error.name : "desconocido");
      return SAFE_FALLBACK;
    }
  });

  const server = createWebServer({
    chat,
    broker,
    maxBodyBytes: LIMITS.maxBodyBytes,
  });

  listenWebServer(server)
    .then(() => {
      console.log(
        `API web en http://${LIMITS.webHost}:${LIMITS.webPort} (cliente ${customerId})`,
      );
    })
    .catch((error: unknown) => {
      console.error("[web] no se pudo arrancar:", error instanceof Error ? error.name : "desconocido");
      process.exit(1);
    });

  const shutdown = () => {
    broker.dispose();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
