import { TestBed } from '@angular/core/testing';
import { ApprovalPanel } from './approval-panel';
import type { ApprovalRequest } from '../../domain/chat';

const APPROVAL: ApprovalRequest = {
  id: 'apr-1',
  action: 'issue_refund',
  args: { invoiceId: 'INV-1001', amount: 120 },
  customerId: 'cus-demo',
  userMessage: 'Reembólsame la INV-1001',
};

describe('ApprovalPanel', () => {
  function create(approvals: ApprovalRequest[]) {
    const fixture = TestBed.createComponent(ApprovalPanel);
    fixture.componentRef.setInput('approvals', approvals);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ApprovalPanel] });
  });

  it('muestra los datos de la acción pendiente', () => {
    const fixture = create([APPROVAL]);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('issue_refund');
    expect(text).toContain('cus-demo');
    expect(text).toContain('Reembólsame la INV-1001');
    expect(text).toContain('INV-1001');
  });

  it('no renderiza nada sin aprobaciones', () => {
    const fixture = create([]);
    expect((fixture.nativeElement as HTMLElement).querySelector('section')).toBeNull();
  });

  it('emite la aprobación', () => {
    const fixture = create([APPROVAL]);
    const emitted: unknown[] = [];
    fixture.componentInstance.decide.subscribe((event) => emitted.push(event));

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-action="approve"]')
      ?.click();

    expect(emitted).toEqual([{ id: 'apr-1', decision: { decision: 'approve' } }]);
  });

  it('emite el rechazo con el motivo escrito', () => {
    const fixture = create([APPROVAL]);
    const emitted: unknown[] = [];
    fixture.componentInstance.decide.subscribe((event) => emitted.push(event));

    const textarea = (fixture.nativeElement as HTMLElement).querySelector('textarea')!;
    textarea.value = '  importe incorrecto  ';
    textarea.dispatchEvent(new Event('input'));

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-action="reject"]')
      ?.click();

    expect(emitted).toEqual([
      { id: 'apr-1', decision: { decision: 'reject', reason: 'importe incorrecto' } },
    ]);
  });
});
