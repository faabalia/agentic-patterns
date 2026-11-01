import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { APPROVAL_GATEWAY, CHAT_GATEWAY } from './application/ports';
import { SseApprovalGateway } from './infrastructure/approval-sse.gateway';
import { HttpChatGateway } from './infrastructure/chat-http.gateway';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    { provide: CHAT_GATEWAY, useClass: HttpChatGateway },
    { provide: APPROVAL_GATEWAY, useClass: SseApprovalGateway },
  ],
};
