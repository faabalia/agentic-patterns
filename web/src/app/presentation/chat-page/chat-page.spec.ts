import { TestBed } from '@angular/core/testing';
import { ChatPage } from './chat-page';
import { ChatStore } from '../../application/chat-store';
import { APPROVAL_GATEWAY, CHAT_GATEWAY } from '../../application/ports';
import type {
  ApprovalDecision,
  ApprovalHandlers,
  ApprovalRequest,
  ChatGateway,
} from '../../domain/chat';

class FakeChatGateway implements ChatGateway {
  calls: string[] = [];
  private pending: ((value: string) => void)[] = [];

  send(message: string): Promise<string> {
    this.calls.push(message);
    if (this.defer) {
      return new Promise((resolve) => this.pending.push(resolve));
    }
    return Promise.resolve(`eco: ${message}`);
  }

  defer = false;

  respond(value: string) {
    this.pending.shift()?.(value);
  }
}

class FakeApprovalGateway {
  handlers?: ApprovalHandlers;
  decisions: { id: string; decision: ApprovalDecision }[] = [];

  connect(handlers: ApprovalHandlers): () => void {
    this.handlers = handlers;
    return () => {};
  }

  async decide(id: string, decision: ApprovalDecision): Promise<void> {
    this.decisions.push({ id, decision });
  }

  request(request: ApprovalRequest) {
    this.handlers?.onRequest(request);
  }

  connection(status: 'connected' | 'disconnected') {
    this.handlers?.onConnection(status);
  }
}

const APPROVAL: ApprovalRequest = {
  id: 'apr-1',
  action: 'issue_refund',
  args: { invoiceId: 'INV-1001' },
  customerId: 'cus-demo',
  userMessage: 'Reembólsame la INV-1001',
};

describe('ChatPage', () => {
  let chat: FakeChatGateway;
  let approvals: FakeApprovalGateway;

  beforeEach(() => {
    chat = new FakeChatGateway();
    approvals = new FakeApprovalGateway();
    TestBed.configureTestingModule({
      imports: [ChatPage],
      providers: [
        ChatStore,
        { provide: CHAT_GATEWAY, useValue: chat },
        { provide: APPROVAL_GATEWAY, useValue: approvals },
      ],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(ChatPage);
    fixture.detectChanges();
    return fixture;
  }

  function submit(fixture: ReturnType<typeof create>, text: string) {
    const element = fixture.nativeElement as HTMLElement;
    const textarea = element.querySelector('textarea')!;
    textarea.value = text;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  it('envía el mensaje y muestra la respuesta', async () => {
    const fixture = create();
    submit(fixture, 'hola');

    await fixture.whenStable();
    fixture.detectChanges();

    expect(chat.calls).toEqual(['hola']);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('eco: hola');
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
  });

  it('deshabilita el formulario mientras espera', async () => {
    chat.defer = true;
    const fixture = create();
    submit(fixture, 'hola');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(element.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true);

    chat.respond('tarde');
    await fixture.whenStable();
  });

  it('muestra las aprobaciones y envía la decisión', async () => {
    const fixture = create();
    approvals.request(APPROVAL);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('issue_refund');

    element.querySelector<HTMLButtonElement>('[data-action="approve"]')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(approvals.decisions).toEqual([{ id: 'apr-1', decision: { decision: 'approve' } }]);
    expect(element.querySelector('[data-action="approve"]')).toBeNull();
  });

  it('refleja el estado de la conexión', () => {
    const fixture = create();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Sin conexión');

    approvals.connection('connected');
    fixture.detectChanges();
    expect(element.textContent).toContain('Conectado');
  });
});
