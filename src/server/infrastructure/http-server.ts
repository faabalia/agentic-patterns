import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { ApprovalEvent, ApprovalResolution } from "../application/approval-broker.js";
import type { Decision } from "../../approvals.js";
import { LIMITS } from "../../config.js";

const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "::1"] as const;

export type ChatPort = {
  send(message: string): Promise<string>;
};

export type ApprovalPort = {
  onRequest(listener: (event: ApprovalEvent) => void): () => void;
  onResolved(listener: (event: ApprovalResolution) => void): () => void;
  resolve(id: string, decision: Decision): boolean;
  pendingCount(): number;
};

export type WebServerDeps = {
  chat: ChatPort;
  broker: ApprovalPort;
  maxBodyBytes: number;
  heartbeatMs?: number;
  /** Hostnames permitidos en `Host`/`Origin`; por defecto solo loopback. */
  allowedHostnames?: readonly string[];
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createWebServer(deps: WebServerDeps): Server {
  return createServer((req, res) => {
    handle(req, res, deps).catch((error: unknown) => {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      // No se registra el texto del usuario ni del modelo: solo el tipo de fallo.
      console.error("[web] error interno:", error instanceof Error ? error.name : "desconocido");
      sendJson(res, 500, { error: "Error interno del asistente" });
    });
  });
}

/** Arranca el servidor en loopback por defecto (evita exponerlo a la LAN). */
export function listenWebServer(
  server: Server,
  options: { port?: number; host?: string } = {},
): Promise<void> {
  const port = options.port ?? LIMITS.webPort;
  const host = options.host ?? LIMITS.webHost;

  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, deps: WebServerDeps) {
  assertAllowedRequest(req, deps);

  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";

  if (pathname === "/api/health") {
    requireMethod(method, "GET");
    sendJson(res, 200, { status: "ok", pendingApprovals: deps.broker.pendingCount() });
    return;
  }

  if (pathname === "/api/events") {
    requireMethod(method, "GET");
    openEventStream(req, res, deps);
    return;
  }

  if (pathname === "/api/chat") {
    requireMethod(method, "POST");
    const body = await readJsonObject(req, deps.maxBodyBytes);
    if (typeof body.message !== "string") {
      throw new HttpError(400, "El campo message debe ser texto");
    }

    try {
      const reply = await deps.chat.send(body.message);
      sendJson(res, 200, { reply });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "CHAT_BUSY") {
        throw new HttpError(409, "Ya hay un mensaje en curso");
      }
      if (error instanceof Error && "code" in error && error.code === "INVALID_MESSAGE") {
        throw new HttpError(400, error.message);
      }
      throw error;
    }
    return;
  }

  if (pathname.startsWith("/api/approvals/")) {
    const id = decodeURIComponent(pathname.slice("/api/approvals/".length));
    if (id.length === 0) throw new HttpError(404, "Aprobación no encontrada");
    requireMethod(method, "POST");

    const body = await readJsonObject(req, deps.maxBodyBytes);
    const decision = toDecision(body);
    if (!deps.broker.resolve(id, decision)) {
      throw new HttpError(404, "Aprobación no encontrada o ya resuelta");
    }
    res.writeHead(204, securityHeaders());
    res.end();
    return;
  }

  throw new HttpError(404, "Ruta no encontrada");
}

function toDecision(body: Record<string, unknown>): Decision {
  if (body.decision === "approve") return { status: "approved" };
  if (body.decision === "reject") {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    return { status: "rejected", reason: reason || "Sin motivo indicado" };
  }
  throw new HttpError(400, "La decisión debe ser approve o reject");
}

function requireMethod(actual: string, expected: string) {
  if (actual !== expected) throw new HttpError(405, `Método no permitido; usa ${expected}`);
}

/**
 * Defensa contra DNS rebinding: un dominio atacante puede resolver a 127.0.0.1,
 * así que además de escuchar en loopback se valida `Host` y, si existe, `Origin`.
 */
function assertAllowedRequest(req: IncomingMessage, deps: WebServerDeps) {
  const allowed = new Set(deps.allowedHostnames ?? LOOPBACK_HOSTNAMES);

  const host = req.headers.host;
  if (typeof host !== "string" || !allowed.has(hostnameOf(host))) {
    throw new HttpError(403, "Host no permitido");
  }

  const origin = req.headers.origin;
  if (origin === undefined) return;
  if (typeof origin !== "string") throw new HttpError(403, "Origen no permitido");

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new HttpError(403, "Origen no permitido");
  }

  const protocolAllowed = parsed.protocol === "http:" || parsed.protocol === "https:";
  if (!protocolAllowed || !allowed.has(normalizeHostname(parsed.hostname))) {
    throw new HttpError(403, "Origen no permitido");
  }
}

function hostnameOf(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end > 0 ? value.slice(1, end) : value;
  }
  const colon = value.indexOf(":");
  return colon === -1 ? value : value.slice(0, colon);
}

function normalizeHostname(name: string): string {
  const value = name.trim().toLowerCase();
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function securityHeaders(): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...securityHeaders(),
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonObject(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Content-Type debe ser application/json");
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new HttpError(413, "Cuerpo de la petición demasiado grande");
    }
    chunks.push(buffer);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON inválido");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "Se esperaba un objeto JSON");
  }
  return parsed as Record<string, unknown>;
}

function openEventStream(req: IncomingMessage, res: ServerResponse, deps: WebServerDeps) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff",
  });

  const write = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  write("ready", { pendingApprovals: deps.broker.pendingCount() });

  const offRequest = deps.broker.onRequest((event) => write("approval", event));
  const offResolved = deps.broker.onResolved((event) => write("approval-resolved", event));

  const heartbeat = setInterval(() => res.write(": ping\n\n"), deps.heartbeatMs ?? 15_000);
  heartbeat.unref?.();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    offRequest();
    offResolved();
  };

  req.on("close", cleanup);
  res.on("close", cleanup);
}
