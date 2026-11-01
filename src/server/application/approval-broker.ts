import { randomUUID } from "node:crypto";
import type { ApprovalCall, Decision } from "../../approvals.js";

export type ApprovalEvent = ApprovalCall & { id: string };
export type ApprovalResolution = { id: string; decision: Decision };

type Pending = {
  event: ApprovalEvent;
  resolve: (decision: Decision) => void;
  timer: NodeJS.Timeout;
};

/**
 * Cola de aprobaciones en memoria para el canal web.
 * Implementa el mismo contrato que el canal CLI (`ApprovalHandler`).
 */
export class ApprovalBroker {
  private readonly pending = new Map<string, Pending>();
  private readonly requestListeners = new Set<(event: ApprovalEvent) => void>();
  private readonly resolvedListeners = new Set<(event: ApprovalResolution) => void>();

  constructor(private readonly options: { timeoutMs: number; idFactory?: () => string }) {}

  request(call: ApprovalCall): Promise<Decision> {
    const id = (this.options.idFactory ?? randomUUID)();
    const event: ApprovalEvent = { id, ...call };

    return new Promise<Decision>((resolve) => {
      const timer = setTimeout(() => {
        this.finish(id, { status: "rejected", reason: "Tiempo de aprobación agotado" });
      }, this.options.timeoutMs);
      timer.unref?.();

      this.pending.set(id, { event, resolve, timer });
      for (const listener of this.requestListeners) listener(event);
    });
  }

  resolve(id: string, decision: Decision): boolean {
    return this.finish(id, decision);
  }

  onRequest(listener: (event: ApprovalEvent) => void): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  onResolved(listener: (event: ApprovalResolution) => void): () => void {
    this.resolvedListeners.add(listener);
    return () => this.resolvedListeners.delete(listener);
  }

  pendingCount(): number {
    return this.pending.size;
  }

  dispose(): void {
    for (const id of [...this.pending.keys()]) {
      this.finish(id, { status: "rejected", reason: "Servidor detenido" });
    }
    this.requestListeners.clear();
    this.resolvedListeners.clear();
  }

  private finish(id: string, decision: Decision): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;

    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(decision);
    for (const listener of this.resolvedListeners) listener({ id, decision });
    return true;
  }
}
