import { LIMITS } from "../../config.js";

/** Puerto del caso de uso: cualquier transporte (CLI, web) puede inyectar su agente. */
export type ChatAgent = (message: string) => Promise<string>;

export class ChatValidationError extends Error {
  readonly code = "INVALID_MESSAGE";
}

export class ChatBusyError extends Error {
  readonly code = "CHAT_BUSY";
}

/**
 * Caso de uso "enviar mensaje".
 * Mantiene un único turno en curso para que las aprobaciones no se crucen.
 */
export class ChatService {
  private busy = false;

  constructor(private readonly agent: ChatAgent) {}

  async send(rawMessage: string): Promise<string> {
    if (rawMessage.trim().length === 0) {
      throw new ChatValidationError("El mensaje está vacío");
    }
    if (rawMessage.length > LIMITS.maxInputChars) {
      throw new ChatValidationError(`El mensaje supera ${LIMITS.maxInputChars} caracteres`);
    }
    if (this.busy) {
      throw new ChatBusyError("Ya hay un mensaje en curso");
    }

    this.busy = true;
    try {
      return await this.agent(rawMessage);
    } finally {
      this.busy = false;
    }
  }
}
