import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalBroker } from "./approval-broker.js";

const CALL = {
  name: "issue_refund",
  args: { invoiceId: "INV-1001", amount: 120 },
  customerId: "cus-demo",
  userMessage: "Reembólsame la INV-1001",
};

describe("ApprovalBroker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emite la petición con un id único y los datos de la llamada", async () => {
    const broker = new ApprovalBroker({ timeoutMs: 1_000, idFactory: () => "apr-1" });
    const requests: unknown[] = [];
    broker.onRequest((event) => requests.push(event));

    const pending = broker.request(CALL);

    expect(requests).toEqual([{ id: "apr-1", ...CALL }]);
    broker.dispose();
    await expect(pending).resolves.toMatchObject({ status: "rejected" });
  });

  it("resuelve la promesa cuando una persona aprueba", async () => {
    const broker = new ApprovalBroker({ timeoutMs: 1_000, idFactory: () => "apr-1" });

    const pending = broker.request(CALL);
    const resolved = broker.resolve("apr-1", { status: "approved" });

    expect(resolved).toBe(true);
    await expect(pending).resolves.toEqual({ status: "approved" });
    expect(broker.pendingCount()).toBe(0);
  });

  it("resuelve el rechazo con motivo", async () => {
    const broker = new ApprovalBroker({ timeoutMs: 1_000, idFactory: () => "apr-1" });

    const pending = broker.request(CALL);
    broker.resolve("apr-1", { status: "rejected", reason: "importe incorrecto" });

    await expect(pending).resolves.toEqual({ status: "rejected", reason: "importe incorrecto" });
  });

  it("notifica la resolución a los suscriptores", async () => {
    const broker = new ApprovalBroker({ timeoutMs: 1_000, idFactory: () => "apr-1" });
    const events: unknown[] = [];
    broker.onResolved((event) => events.push(event));

    const pending = broker.request(CALL);
    broker.resolve("apr-1", { status: "approved" });
    await pending;

    expect(events).toEqual([{ id: "apr-1", decision: { status: "approved" } }]);
  });

  it("rechaza por defecto cuando se agota el tiempo", async () => {
    const broker = new ApprovalBroker({ timeoutMs: 500, idFactory: () => "apr-1" });
    const events: unknown[] = [];
    broker.onResolved((event) => events.push(event));

    const pending = broker.request(CALL);
    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toEqual({
      status: "rejected",
      reason: "Tiempo de aprobación agotado",
    });
    expect(events).toEqual([
      { id: "apr-1", decision: { status: "rejected", reason: "Tiempo de aprobación agotado" } },
    ]);
    expect(broker.pendingCount()).toBe(0);
  });

  it("ignora resoluciones de ids desconocidos o ya resueltos", async () => {
    const broker = new ApprovalBroker({ timeoutMs: 1_000, idFactory: () => "apr-1" });

    const pending = broker.request(CALL);
    expect(broker.resolve("otro", { status: "approved" })).toBe(false);
    expect(broker.resolve("apr-1", { status: "approved" })).toBe(true);
    expect(broker.resolve("apr-1", { status: "rejected", reason: "tarde" })).toBe(false);

    await expect(pending).resolves.toEqual({ status: "approved" });
  });

  it("cancela las peticiones pendientes al liberarse", async () => {
    const broker = new ApprovalBroker({ timeoutMs: 1_000, idFactory: () => "apr-1" });

    const pending = broker.request(CALL);
    broker.dispose();

    await expect(pending).resolves.toMatchObject({ status: "rejected" });
    expect(broker.pendingCount()).toBe(0);
  });

  it("permite darse de baja de los eventos", async () => {
    const broker = new ApprovalBroker({ timeoutMs: 1_000, idFactory: () => "apr-1" });
    const requests: unknown[] = [];
    const unsubscribe = broker.onRequest((event) => requests.push(event));
    unsubscribe();

    const pending = broker.request(CALL);
    expect(requests).toEqual([]);
    broker.dispose();
    await pending;
  });
});
