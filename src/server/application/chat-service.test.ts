import { describe, expect, it, vi } from "vitest";
import { ChatBusyError, ChatService, ChatValidationError } from "./chat-service.js";
import { LIMITS } from "../../config.js";

describe("ChatService", () => {
  it("delega en el agente y devuelve su respuesta", async () => {
    const agent = vi.fn().mockResolvedValue("La factura INV-1001 son 120 €.");
    const service = new ChatService(agent);

    await expect(service.send("¿Cuánto era la factura INV-1001?")).resolves.toBe(
      "La factura INV-1001 son 120 €.",
    );
    expect(agent).toHaveBeenCalledWith("¿Cuánto era la factura INV-1001?");
  });

  it("rechaza mensajes vacíos o solo con espacios", async () => {
    const agent = vi.fn();
    const service = new ChatService(agent);

    await expect(service.send("   ")).rejects.toBeInstanceOf(ChatValidationError);
    expect(agent).not.toHaveBeenCalled();
  });

  it("rechaza mensajes que superan el límite de longitud", async () => {
    const agent = vi.fn();
    const service = new ChatService(agent);

    await expect(service.send("a".repeat(LIMITS.maxInputChars + 1))).rejects.toBeInstanceOf(
      ChatValidationError,
    );
    expect(agent).not.toHaveBeenCalled();
  });

  it("no permite dos mensajes en curso a la vez", async () => {
    let release!: (value: string) => void;
    const agent = vi.fn().mockReturnValue(
      new Promise<string>((resolve) => {
        release = resolve;
      }),
    );
    const service = new ChatService(agent);

    const first = service.send("primero");
    await expect(service.send("segundo")).rejects.toBeInstanceOf(ChatBusyError);

    release("listo");
    await expect(first).resolves.toBe("listo");
    await expect(service.send("tercero")).resolves.toBe("listo");
  });

  it("libera el turno aunque el agente falle", async () => {
    const agent = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");
    const service = new ChatService(agent);

    await expect(service.send("falla")).rejects.toThrow("boom");
    await expect(service.send("funciona")).resolves.toBe("ok");
  });
});
