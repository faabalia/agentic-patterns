import { JsonPipe } from '@angular/common';
import { Component, input, output, signal } from '@angular/core';
import type { ApprovalDecision, ApprovalRequest } from '../../domain/chat';

export type ApprovalDecisionEvent = { id: string; decision: ApprovalDecision };

@Component({
  selector: 'app-approval-panel',
  imports: [JsonPipe],
  templateUrl: './approval-panel.html',
  styleUrl: './approval-panel.css',
})
export class ApprovalPanel {
  readonly approvals = input.required<ApprovalRequest[]>();
  readonly decide = output<ApprovalDecisionEvent>();

  private readonly reasons = signal<Record<string, string>>({});

  reasonFor(id: string): string {
    return this.reasons()[id] ?? '';
  }

  setReason(id: string, value: string): void {
    this.reasons.update((reasons) => ({ ...reasons, [id]: value }));
  }

  approve(id: string): void {
    this.decide.emit({ id, decision: { decision: 'approve' } });
  }

  reject(id: string): void {
    const reason = this.reasonFor(id).trim();
    this.decide.emit({
      id,
      decision: reason ? { decision: 'reject', reason } : { decision: 'reject' },
    });
  }
}
