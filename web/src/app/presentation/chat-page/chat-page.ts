import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { ChatStore } from '../../application/chat-store';
import { ApprovalPanel } from '../approval-panel/approval-panel';
import type { ApprovalDecisionEvent } from '../approval-panel/approval-panel';

@Component({
  selector: 'app-chat-page',
  imports: [ApprovalPanel],
  templateUrl: './chat-page.html',
  styleUrl: './chat-page.css',
})
export class ChatPage {
  readonly store = inject(ChatStore);
  readonly message = signal('');

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    effect(() => {
      this.store.messages();
      const element = this.list()?.nativeElement;
      if (element) queueMicrotask(() => (element.scrollTop = element.scrollHeight));
    });
  }

  onInput(event: Event): void {
    this.message.set((event.target as HTMLTextAreaElement).value);
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    const text = this.message();
    if (text.trim().length === 0 || this.store.busy()) return;

    this.message.set('');
    void this.store.send(text);
  }

  onDecide(event: ApprovalDecisionEvent): void {
    if (event.decision.decision === 'approve') {
      void this.store.approve(event.id);
    } else {
      void this.store.reject(event.id, event.decision.reason);
    }
  }
}
