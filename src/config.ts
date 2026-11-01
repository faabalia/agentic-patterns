// Presupuestos y límites centralizados: "límites en todas partes".
export const MODELS = {
  fast: "claude-haiku-5-5", // router y clasificadores
  smart: "claude-sonnet-5-5", // agentes y generación
} as const;

export const LIMITS = {
  maxInputChars: 8_000,
  routerMinConfidence: 0.7,
  maxAgentSteps: 8,
  toolTimeoutMs: 30_000,
  outputRetries: 2,
  maxTokens: 1_024,
  maxModelCallsPerMessage: 12, // presupuesto de llamadas al modelo de agente por mensaje (incluye reintentos)
  approvalTimeoutMs: 120_000, // espera máxima de una aprobación humana en la web
  webPort: 8787,
  webHost: "127.0.0.1", // solo loopback: no expone la API a la red local
  maxBodyBytes: 32_768,
} as const;
