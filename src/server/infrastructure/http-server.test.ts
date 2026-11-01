import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebServer, listenWebServer } from "./http-server.js";
import type { ApprovalEvent, ApprovalResolution } from "../application/approval-broker.js";
import type { Decision } from "../../approvals.js";

type FakeBroker = {
  onRequest: (listener: (event: ApprovalEvent) => void) => () => void;
  onResolved: (listener: (event: ApprovalResolution) => void) => () => void;
  resolve: (id: string, decision: Decision) => boolean;
  pendingCount: () => number;
  emitRequest: (event: ApprovalEvent) => void;
  emitResolved: (event: ApprovalResolution) => void;
};

function createFakeBroker(): FakeBroker {
  const requests = new Set<(event: ApprovalEvent) => void>();
  const resolutions = new Set<(event: ApprovalResolution) => void>();
  const pending = new Map<string, Decision>();

  return {
    onRequest: (listener) => {
      requests.add(listener);
      return () => requests.delete(listener);
    },
    onResolved: (listener) => {
      resolutions.add(listener);
      return () => resolutions.delete(listener);
    },
    resolve: (id, decision) => {
      if (!pending.has(id)) return false;
      pending.delete(id);
      for (const listener of resolutions) listener({ id, decision });
      return true;
    },
    pendingCount: () => pending.size,
    emitRequest: (event) => {
      pending.set(event.id, { status: "rejected", reason: "sin decidir" });
      for (const listener of requests) listener(event);
    },
    emitResolved: (event) => {
      for (const listener of resolutions) listener(event);
    },
  };
}

const servers: Server[] = [];

async function start(deps: {
  chat?: { send: (message: string) => Promise<string> };
  broker?: FakeBroker;
}) {
  const broker = deps.broker ?? createFakeBroker();
  const chat = deps.chat ?? { send: vi.fn().mockResolvedValue("respuesta") };
  const server = createWebServer({
    chat,
    broker,
    maxBodyBytes: 1_024,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, chat, broker };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function rawRequest(
  base: string,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: string }> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string,
  timeoutMs = 2_000,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (!text.includes(needle)) {
    if (Date.now() > deadline) throw new Error(`No se recibió "${needle}": ${text}`);
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("servidor HTTP", () => {
  it("expone un healthcheck sin datos sensibles", async () => {
    const { base, broker } = await start({});
    const res = await fetch(`${base}/api/health`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", pendingApprovals: 0 });
    expect(broker.pendingCount()).toBe(0);
  });

  it("devuelve la respuesta del caso de uso al enviar un mensaje", async () => {
    const { base, chat } = await start({});
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hola" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: "respuesta" });
    expect(chat.send).toHaveBeenCalledWith("hola");
  });

  it("rechaza JSON inválido, cuerpos grandes y tipos incorrectos", async () => {
    const { base } = await start({});

    const invalid = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{no-json",
    });
    expect(invalid.status).toBe(400);

    const wrongType = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: 42 }),
    });
    expect(wrongType.status).toBe(400);

    const tooLarge = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "a".repeat(2_000) }),
    });
    expect(tooLarge.status).toBe(413);

    const noJson = await fetch(`${base}/api/chat`, {
      method: "POST",
      body: JSON.stringify({ message: "hola" }),
    });
    expect(noJson.status).toBe(415);
  });

  it("mapea los errores de validación y de turno en curso", async () => {
    const busy = new Error("ocupado") as Error & { code: string };
    busy.code = "CHAT_BUSY";
    const invalid = new Error("vacío") as Error & { code: string };
    invalid.code = "INVALID_MESSAGE";

    const { base } = await start({
      chat: {
        send: vi.fn(async (message: string) => {
          if (message === "ocupado") throw busy;
          throw invalid;
        }),
      },
    });

    const busyRes = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "ocupado" }),
    });
    expect(busyRes.status).toBe(409);

    const invalidRes = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "vacío" }),
    });
    expect(invalidRes.status).toBe(400);
  });

  it("resuelve una aprobación existente", async () => {
    const { base, broker } = await start({});
    broker.emitRequest({
      id: "apr-1",
      name: "issue_refund",
      args: { invoiceId: "INV-1001" },
      customerId: "cus-demo",
      userMessage: "Reembolsa",
    });

    const res = await fetch(`${base}/api/approvals/apr-1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "reject", reason: "importe incorrecto" }),
    });

    expect(res.status).toBe(204);
  });

  it("devuelve 404 para aprobaciones desconocidas o decisiones inválidas", async () => {
    const { base } = await start({});

    const unknown = await fetch(`${base}/api/approvals/apr-404`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(unknown.status).toBe(404);

    const invalid = await fetch(`${base}/api/approvals/apr-1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "quizá" }),
    });
    expect(invalid.status).toBe(400);

    const noId = await fetch(`${base}/api/approvals/`, { method: "POST" });
    expect(noId.status).toBe(404);
  });

  it("emite peticiones y resoluciones por SSE", async () => {
    const { base, broker } = await start({});
    const controller = new AbortController();
    const res = await fetch(`${base}/api/events`, { signal: controller.signal });

    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();

    broker.emitRequest({
      id: "apr-1",
      name: "issue_refund",
      args: { invoiceId: "INV-1001" },
      customerId: "cus-demo",
      userMessage: "Reembolsa",
    });
    const requestEvent = await readUntil(reader, "event: approval\n");
    expect(requestEvent).toContain('"id":"apr-1"');
    expect(requestEvent).toContain('"name":"issue_refund"');

    broker.emitResolved({ id: "apr-1", decision: { status: "approved" } });
    const resolvedEvent = await readUntil(reader, "event: approval-resolved");
    expect(resolvedEvent).toContain('"status":"approved"');

    controller.abort();
  });

  it("devuelve 404 y 405 en rutas o métodos no soportados, sin CORS", async () => {
    const { base } = await start({});

    const notFound = await fetch(`${base}/api/nada`);
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get("access-control-allow-origin")).toBeNull();

    const wrongMethod = await fetch(`${base}/api/chat`);
    expect(wrongMethod.status).toBe(405);
  });
});

describe("endurecimiento de red", () => {
  const approvalEvent = {
    id: "apr-1",
    name: "issue_refund",
    args: { invoiceId: "INV-1001" },
    customerId: "cus-demo",
    userMessage: "Reembolsa",
  };

  it("escucha solo en loopback por defecto", async () => {
    const server = createWebServer({
      chat: { send: async () => "ok" },
      broker: createFakeBroker(),
      maxBodyBytes: 1_024,
    });
    servers.push(server);

    await listenWebServer(server, { port: 0 });

    expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
  });

  it("rechaza peticiones con Host no loopback, también en SSE", async () => {
    const { base } = await start({});

    const health = await rawRequest(base, "/api/health", {
      headers: { host: "evil.example:8787" },
    });
    expect(health.status).toBe(403);
    expect(health.body).toContain("Host no permitido");

    const events = await rawRequest(base, "/api/events", {
      headers: { host: "evil.example:8787" },
    });
    expect(events.status).toBe(403);
  });

  it("acepta Host loopback, incluido IPv6", async () => {
    const { base } = await start({});

    const localhost = await rawRequest(base, "/api/health", {
      headers: { host: "localhost:8787" },
    });
    const ipv6 = await rawRequest(base, "/api/health", {
      headers: { host: "[::1]:8787" },
    });

    expect(localhost.status).toBe(200);
    expect(ipv6.status).toBe(200);
  });

  it("rechaza Origins externos, opacos o no HTTP", async () => {
    const { base } = await start({});

    for (const origin of ["http://evil.example", "null", "file://"]) {
      const res = await rawRequest(base, "/api/health", { headers: { origin } });
      expect(res.status).toBe(403);
      expect(res.body).toContain("Origen no permitido");
    }
  });

  it("acepta el Origin del dev server y loopback IPv6", async () => {
    const { base } = await start({});

    const angular = await rawRequest(base, "/api/health", {
      headers: { origin: "http://localhost:4200" },
    });
    const ipv6 = await rawRequest(base, "/api/health", {
      headers: { origin: "http://[::1]:4200" },
    });

    expect(angular.status).toBe(200);
    expect(ipv6.status).toBe(200);
  });

  it("no permite aprobar reembolsos desde un Origin externo", async () => {
    const { base, broker } = await start({});
    broker.emitRequest(approvalEvent);

    const res = await rawRequest(base, "/api/approvals/apr-1", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify({ decision: "approve" }),
    });

    expect(res.status).toBe(403);
    expect(broker.pendingCount()).toBe(1);
  });

  it("no permite aprobar reembolsos con Host externo", async () => {
    const { base, broker } = await start({});
    broker.emitRequest(approvalEvent);

    const res = await rawRequest(base, "/api/approvals/apr-1", {
      method: "POST",
      headers: { "content-type": "application/json", host: "evil.example:8787" },
      body: JSON.stringify({ decision: "approve" }),
    });

    expect(res.status).toBe(403);
    expect(broker.pendingCount()).toBe(1);
  });
});
