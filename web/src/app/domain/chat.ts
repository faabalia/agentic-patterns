export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  pending?: boolean;
  error?: boolean;
};

export type ApprovalRequest = {
  id: string;
  action: string;
  args: unknown;
  customerId: string;
  userMessage: string;
};

export type ApprovalResolution = {
  id: string;
  status: 'approved' | 'rejected';
};

export type ApprovalDecision = {
  decision: 'approve' | 'reject';
  reason?: string;
};

export type ConnectionStatus = 'connected' | 'disconnected';

/** Puerto de salida hacia el asistente. */
export interface ChatGateway {
  send(message: string): Promise<string>;
}

export type ApprovalHandlers = {
  onRequest(request: ApprovalRequest): void;
  onResolved(resolution: ApprovalResolution): void;
  onConnection(status: ConnectionStatus): void;
};

/** Puerto de salida hacia el canal de aprobaciones. */
export interface ApprovalGateway {
  connect(handlers: ApprovalHandlers): () => void;
  decide(id: string, decision: ApprovalDecision): Promise<void>;
}

/** Error con mensaje seguro para mostrar al usuario. */
export class ChatGatewayError extends Error {}
