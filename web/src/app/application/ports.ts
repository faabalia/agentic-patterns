import { InjectionToken } from '@angular/core';
import type { ApprovalGateway, ChatGateway } from '../domain/chat';

export const CHAT_GATEWAY = new InjectionToken<ChatGateway>('CHAT_GATEWAY');
export const APPROVAL_GATEWAY = new InjectionToken<ApprovalGateway>('APPROVAL_GATEWAY');
