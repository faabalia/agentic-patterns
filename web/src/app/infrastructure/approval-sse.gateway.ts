import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  ApprovalDecision,
  ApprovalGateway,
  ApprovalHandlers,
  ApprovalRequest,
  ApprovalResolution,
} from '../domain/chat';

@Injectable({ providedIn: 'root' })
export class SseApprovalGateway implements ApprovalGateway {
  private readonly http = inject(HttpClient);

  connect(handlers: ApprovalHandlers): () => void {
    const source = new EventSource('/api/events');

    source.onopen = () => handlers.onConnection('connected');
    source.onerror = () => handlers.onConnection('disconnected');

    source.addEventListener('approval', (event) => {
      const request = parseApproval((event as MessageEvent).data);
      if (request) handlers.onRequest(request);
    });

    source.addEventListener('approval-resolved', (event) => {
      const resolution = parseResolution((event as MessageEvent).data);
      if (resolution) handlers.onResolved(resolution);
    });

    return () => source.close();
  }

  async decide(id: string, decision: ApprovalDecision): Promise<void> {
    await firstValueFrom(
      this.http.post(`/api/approvals/${encodeURIComponent(id)}`, decision),
    );
  }
}

function parseApproval(raw: unknown): ApprovalRequest | null {
  const data = parseObject(raw);
  if (!data) return null;

  const { id, action, customerId, userMessage, args } = data;
  if (
    typeof id !== 'string' ||
    typeof action !== 'string' ||
    typeof customerId !== 'string' ||
    typeof userMessage !== 'string'
  ) {
    return null;
  }
  return { id, action, args, customerId, userMessage };
}

function parseResolution(raw: unknown): ApprovalResolution | null {
  const data = parseObject(raw);
  if (!data) return null;

  const id = data['id'];
  if (typeof id !== 'string') return null;

  const decision = asObject(data['decision']);
  const status = decision?.['status'];
  if (status !== 'approved' && status !== 'rejected') return null;

  return { id, status };
}

function parseObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  try {
    return asObject(JSON.parse(raw));
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
