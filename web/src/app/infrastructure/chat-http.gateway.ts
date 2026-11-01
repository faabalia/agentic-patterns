import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ChatGateway } from '../domain/chat';
import { ChatGatewayError } from '../domain/chat';

@Injectable({ providedIn: 'root' })
export class HttpChatGateway implements ChatGateway {
  private readonly http = inject(HttpClient);

  async send(message: string): Promise<string> {
    try {
      const response = await firstValueFrom(
        this.http.post<{ reply?: unknown }>('/api/chat', { message }),
      );
      return typeof response?.reply === 'string' ? response.reply : '';
    } catch (error) {
      throw new ChatGatewayError(userMessageFor(error));
    }
  }
}

function userMessageFor(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 409) return 'Ya hay un mensaje en curso.';
    if (error.status === 400) return 'Mensaje no válido.';
    if (error.status === 413) return 'El mensaje es demasiado largo.';
  }
  return 'No se pudo contactar con el asistente.';
}
