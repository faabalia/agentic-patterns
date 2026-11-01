import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SseApprovalGateway } from './approval-sse.gateway';
import type { ApprovalHandlers } from '../domain/chat';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const fn = listener as (event: MessageEvent) => void;
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, payload: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(payload) } as MessageEvent);
    }
  }

  emitRaw(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent);
    }
  }

  open() {
    this.onopen?.();
  }

  fail() {
    this.onerror?.();
  }
}

const originalEventSource = globalThis.EventSource;

function handlers() {
  const calls = {
    requests: [] as unknown[],
    resolutions: [] as unknown[],
    connections: [] as string[],
  };
  const value: ApprovalHandlers = {
    onRequest: (request) => calls.requests.push(request),
    onResolved: (resolution) => calls.resolutions.push(resolution),
    onConnection: (status) => calls.connections.push(status),
  };
  return { value, calls };
}

describe('SseApprovalGateway', () => {
  let gateway: SseApprovalGateway;
  let http: HttpTestingController;

  beforeEach(() => {
    FakeEventSource.instances = [];
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    TestBed.configureTestingModule({
      providers: [SseApprovalGateway, provideHttpClient(), provideHttpClientTesting()],
    });
    gateway = TestBed.inject(SseApprovalGateway);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
    http.verify();
  });

  it('abre el stream y notifica el estado de la conexión', () => {
    const { value, calls } = handlers();
    gateway.connect(value);

    expect(FakeEventSource.instances[0]?.url).toBe('/api/events');
    FakeEventSource.instances[0]?.open();
    FakeEventSource.instances[0]?.fail();

    expect(calls.connections).toEqual(['connected', 'disconnected']);
  });

  it('parsea las peticiones de aprobación', () => {
    const { value, calls } = handlers();
    gateway.connect(value);

    FakeEventSource.instances[0]?.emit('approval', {
      id: 'apr-1',
      action: 'issue_refund',
      args: { invoiceId: 'INV-1001' },
      customerId: 'cus-demo',
      userMessage: 'Reembolsa',
    });

    expect(calls.requests).toEqual([
      {
        id: 'apr-1',
        action: 'issue_refund',
        args: { invoiceId: 'INV-1001' },
        customerId: 'cus-demo',
        userMessage: 'Reembolsa',
      },
    ]);
  });

  it('ignora eventos malformados sin romper el stream', () => {
    const { value, calls } = handlers();
    gateway.connect(value);

    FakeEventSource.instances[0]?.emitRaw('approval', '{no-json');
    FakeEventSource.instances[0]?.emit('approval', { id: 42 });

    expect(calls.requests).toEqual([]);
  });

  it('notifica las resoluciones', () => {
    const { value, calls } = handlers();
    gateway.connect(value);

    FakeEventSource.instances[0]?.emit('approval-resolved', { id: 'apr-1', decision: { status: 'approved' } });

    expect(calls.resolutions).toEqual([{ id: 'apr-1', status: 'approved' }]);
  });

  it('cierra el stream al darse de baja', () => {
    const { value } = handlers();
    const unsubscribe = gateway.connect(value);

    unsubscribe();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });

  it('envía la decisión codificando el id', async () => {
    const promise = gateway.decide('apr/1', { decision: 'reject', reason: 'importe incorrecto' });
    const req = http.expectOne('/api/approvals/apr%2F1');

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ decision: 'reject', reason: 'importe incorrecto' });

    req.flush(null, { status: 204, statusText: 'No Content' });
    await expect(promise).resolves.toBeUndefined();
  });
});
