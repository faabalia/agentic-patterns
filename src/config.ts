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
} as const;
