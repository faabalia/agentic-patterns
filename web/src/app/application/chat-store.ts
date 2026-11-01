import { Inject, Injectable, signal } from '@angular/core';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ChatGateway,
  ChatMessage,
  ConnectionStatus,
} from '../domain/chat';
import { ChatGatewayError } from '../domain/chat';
import type { ApprovalGateway } from '../domain/chat';
import { APPROVAL_GATEWAY, CHAT_GATEWAY } from './ports';

const GENERIC_CHAT_ERROR = 'No se pudo contactar con el asistente.';
const DECISION_ERROR = 'No se pudo enviar la decisión. Inténtalo de nuevo.';
const THINKING = 'Pensando…';

@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly _messages = signal<ChatMessage[]>([]);
  private readonly _pendingApprovals = signal<ApprovalRequest[]>([]);
  private readonly _busy = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _connection = signal<ConnectionStatus>('disconnected');

  readonly messages = this._messages.asReadonly();
  readonly pendingApprovals = this._pendingApprovals.asReadonly();
  readonly busy = this._busy.asReadonly();
  readonly error = this._error.asReadonly();
  readonly connection = this._connection.asReadonly();

  private readonly chat: ChatGateway;
  private readonly approvals: ApprovalGateway;

  constructor(
    @Inject(CHAT_GATEWAY) chat: ChatGateway,
    @Inject(APPROVAL_GATEWAY) approvals: ApprovalGateway,
  ) {
    this.chat = chat;
    this.approvals = approvals;

    this.approvals.connect({
      onRequest: (request) => this.addApproval(request),
      onResolved: (resolution) => this.removeApproval(resolution.id),
      onConnection: (status) => this._connection.set(status),
    });
  }

  async send(rawMessage: string): Promise<void> {
    const text = rawMessage.trim();
    if (text.length === 0 || this._busy()) return;

    this._error.set(null);
    this._busy.set(true);

    const assistantId = newId();
    this._messages.update((messages) => [
      ...messages,
      { id: newId(), role: 'user', text },
      { id: assistantId, role: 'assistant', text: THINKING, pending: true },
    ]);

    try {
      const reply = await this.chat.send(text);
      this.replaceMessage(assistantId, { text: reply, pending: false });
    } catch (error) {
      const message = error instanceof ChatGatewayError ? error.message : GENERIC_CHAT_ERROR;
      this._error.set(message);
      this.replaceMessage(assistantId, { text: message, pending: false, error: true });
    } finally {
      this._busy.set(false);
    }
  }

  async approve(id: string): Promise<void> {
    await this.decide(id, { decision: 'approve' });
  }

  async reject(id: string, rawReason?: string): Promise<void> {
    const reason = rawReason?.trim();
    await this.decide(id, reason ? { decision: 'reject', reason } : { decision: 'reject' });
  }

  dismissError(): void {
    this._error.set(null);
  }

  private async decide(id: string, decision: ApprovalDecision): Promise<void> {
    this._error.set(null);
    try {
      await this.approvals.decide(id, decision);
      this.removeApproval(id);
    } catch {
      this._error.set(DECISION_ERROR);
    }
  }

  private addApproval(request: ApprovalRequest): void {
    this._pendingApprovals.update((pending) =>
      pending.some((item) => item.id === request.id) ? pending : [...pending, request],
    );
  }

  private removeApproval(id: string): void {
    this._pendingApprovals.update((pending) => pending.filter((item) => item.id !== id));
  }

  private replaceMessage(id: string, patch: Partial<ChatMessage>): void {
    this._messages.update((messages) =>
      messages.map((message) => (message.id === id ? { ...message, ...patch } : message)),
    );
  }
}

function newId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
