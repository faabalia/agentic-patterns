import { TestBed } from '@angular/core/testing';
import { ChatStore } from './chat-store';
import { APPROVAL_GATEWAY, CHAT_GATEWAY } from './ports';
import type {
  ApprovalDecision,
  ApprovalHandlers,
  ApprovalRequest,
  ChatGateway,
} from '../domain/chat';
import { ChatGatewayError as GatewayError } from '../domain/chat';

class FakeChatGateway implements ChatGateway {
  calls: string[] = [];
  private resolveNext?: (value: string) => void;
  private rejectNext?: (error: unknown) => void;

  send(message: string): Promise<string> {
    this.calls.push(message);
    return new Promise((resolve, reject) => {
      this.resolveNext = resolve;
      this.rejectNext = reject;
    });
  }

  respond(value: string) {
    this.resolveNext?.(value);
  }

  fail(error: Error) {
    this.rejectNext?.(error);
  }
}

class FakeApprovalGateway {
  handlers?: ApprovalHandlers;
  decisions: { id: string; decision: ApprovalDecision }[] = [];
  connect(handlers: ApprovalHandlers): () => void {
    this.handlers = handlers;
    return () => {
      this.handlers = undefined;
    };
  }

  async decide(id: string, decision: ApprovalDecision): Promise<void> {
    this.decisions.push({ id, decision });
  }

  request(request: ApprovalRequest) {
    this.handlers?.onRequest(request);
  }

  resolved(id: string, status: 'approved' | 'rejected') {
    this.handlers?.onResolved({ id, status });
  }

  connection(status: 'connected' | 'disconnected') {
    this.handlers?.onConnection(status);
  }
}

const APPROVAL: ApprovalRequest = {
  id: 'apr-1',
  action: 'issue_refund',
  args: { invoiceId: 'INV-1001', amount: 120 },
  customerId: 'cus-demo',
  userMessage: 'Reembólsame la INV-1001',
};

describe('ChatStore', () => {
  let chat: FakeChatGateway;
  let approvals: FakeApprovalGateway;
  let store: ChatStore;

  beforeEach(() => {
    chat = new FakeChatGateway();
    approvals = new FakeApprovalGateway();
    TestBed.configureTestingModule({
      providers: [
        ChatStore,
        { provide: CHAT_GATEWAY, useValue: chat },
        { provide: APPROVAL_GATEWAY, useValue: approvals },
      ],
    });
    store = TestBed.inject(ChatStore);
  });

  it('añade el mensaje del usuario y actualiza la respuesta del asistente', async () => {
    const sending = store.send('¿Cuánto era la factura INV-1001?');

    expect(store.messages().map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(store.messages()[1]?.pending).toBe(true);
    expect(store.busy()).toBe(true);

    chat.respond('La factura INV-1001 son 120 €.');
    await sending;

    expect(store.messages()[1]).toMatchObject({
      role: 'assistant',
      text: 'La factura INV-1001 son 120 €.',
      pending: false,
    });
    expect(store.busy()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('ignora mensajes vacíos y no llama al gateway', async () => {
    await store.send('   ');
    expect(chat.calls).toEqual([]);
    expect(store.messages()).toEqual([]);
  });

  it('ignora un segundo envío mientras hay uno en curso', async () => {
    const sending = store.send('primero');
    await store.send('segundo');

    expect(chat.calls).toEqual(['primero']);
    chat.respond('ok');
    await sending;
  });

  it('muestra un mensaje seguro cuando el gateway falla', async () => {
    const sending = store.send('hola');
    chat.fail(new GatewayError('No se pudo contactar con el asistente.'));
    await sending;

    expect(store.error()).toBe('No se pudo contactar con el asistente.');
    expect(store.messages()[1]).toMatchObject({
      role: 'assistant',
      text: 'No se pudo contactar con el asistente.',
      error: true,
      pending: false,
    });
    expect(store.busy()).toBe(false);
  });

  it('recibe aprobaciones por el canal y las elimina al resolverse', () => {
    approvals.request(APPROVAL);
    expect(store.pendingApprovals()).toHaveLength(1);
    expect(store.pendingApprovals()[0]?.action).toBe('issue_refund');

    approvals.resolved('apr-1', 'approved');
    expect(store.pendingApprovals()).toEqual([]);
  });

  it('envía la aprobación y retira la tarjeta', async () => {
    approvals.request(APPROVAL);

    await store.approve('apr-1');

    expect(approvals.decisions).toEqual([{ id: 'apr-1', decision: { decision: 'approve' } }]);
    expect(store.pendingApprovals()).toEqual([]);
  });

  it('envía el rechazo con motivo recortado y retira la tarjeta', async () => {
    approvals.request(APPROVAL);

    await store.reject('apr-1', '  importe incorrecto  ');

    expect(approvals.decisions).toEqual([
      { id: 'apr-1', decision: { decision: 'reject', reason: 'importe incorrecto' } },
    ]);
    expect(store.pendingApprovals()).toEqual([]);
  });

  it('mantiene la tarjeta y avisa si no se puede enviar la decisión', async () => {
    approvals.request(APPROVAL);
    approvals.decide = async () => {
      throw new Error('red');
    };

    await store.approve('apr-1');

    expect(store.pendingApprovals()).toHaveLength(1);
    expect(store.error()).toBe('No se pudo enviar la decisión. Inténtalo de nuevo.');
  });

  it('expone el estado de la conexión SSE', () => {
    expect(store.connection()).toBe('disconnected');
    approvals.connection('connected');
    expect(store.connection()).toBe('connected');
  });
});
