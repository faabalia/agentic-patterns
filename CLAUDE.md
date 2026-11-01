# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proyecto

Asistente CLI de atención al cliente (tienda online) que implementa patrones agénticos con el SDK de
Anthropic en TypeScript. Código, comentarios, prompts y mensajes al usuario están en español.

## Comandos

```bash
npm install
npm start            # tsx --env-file=.env src/index.ts — CLI interactivo (requiere .env con ANTHROPIC_API_KEY)
npm run typecheck    # tsc --noEmit (strict + noUncheckedIndexedAccess)
npm audit
gitleaks detect --source . -v   # binario aparte (brew install gitleaks), no es un paquete npm
```

No hay framework de tests ni linter. Para probar funciones deterministas (guards, herramientas) sin
llamar a la API, importa los módulos desde un script `.mts` y ejecútalo con
`npx tsx --env-file=.env <script>.mts` (debe ser `.mts`: el top-level await no funciona en `.ts`
fuera de `src/`). Los mensajes de prueba manuales están en el README.

## Arquitectura

Pipeline por mensaje en `handle(rawMessage, customerId)` (`src/index.ts`):

1. **Input guard** (`src/guards.ts`, patrón 02): longitud → `normalize` (NFKC + quitar invisibles)
   → regex de inyección obvia → clasificador LLM (`MODELS.fast`) → `wrapAsUntrustedData`.
   Si falla, devuelve una respuesta fija sin llegar al modelo principal.
2. **Router** (`src/router.ts`, patrón 01): clasifica en `billing | tech | sales | unknown` con
   confianza; `unknown` o `< routerMinConfidence` → escala a humano (`null`).
3. **Agente** (`src/agent.ts`, patrón 08): bucle `modelo → tool_use → executeTool → tool_result`
   con `MODELS.smart`, limitado por `maxAgentSteps` y el presupuesto de la `Session`.
   `executeTool` aplica: herramienta permitida en `TOOLSETS[route]` → validación zod →
   aprobación humana si `risk === "high"` (patrón 09, `src/approvals.ts`) → ejecución con timeout.
   Los resultados correctos se acumulan como `evidence`.
4. **Output guard** (`src/guards.ts`, patrón 03): vacío / secretos-PII / grounding LLM contra
   `evidence`. Si falla, `runAgent` se vuelve a llamar con feedback hasta `outputRetries`;
   agotados, devuelve `SAFE_FALLBACK`.

Piezas transversales:
- `src/llm.ts`: cliente Anthropic único y `structured(schema, opts)`, que fuerza una tool call
  `respond` con el JSON Schema derivado de zod (`z.toJSONSchema`) y valida con `schema.parse`.
  Router, clasificador de riesgo y juez de grounding lo usan.
- `src/tools.ts`: herramientas simuladas con datos en memoria (`INVOICES`). `ToolDef` = nombre,
  descripción, `risk`, esquema zod y `run(args, ctx)`. `TOOLSETS` limita qué ve cada ruta.
- `src/config.ts`: modelos (`claude-haiku-5-5` rápido, `claude-sonnet-5-5` principal) y todos los límites.
- Módulos ESM con `module: NodeNext`: los imports relativos llevan extensión `.js`.
- La identidad del cliente en el CLI es `DEMO_CUSTOMER_ID` (por defecto `cus-demo`).

## Reglas de seguridad (obligatorias)

Este asistente procesa texto no confiable y ejecuta acciones con efectos reales (reembolsos).
Cualquier cambio debe respetar estas reglas; si una tarea exige romper alguna, pregunta antes.

### Identidad y autorización
- El `customerId` lo fija el código (sesión autenticada) y llega a las herramientas por `ToolContext`.
  Nunca puede venir del texto del usuario ni de los argumentos que propone el modelo.
- Toda herramienta que lea o modifique datos de un cliente comprueba la propiedad (ver `ownInvoice`
  en `src/tools.ts`). "No existe" y "no es tuyo" devuelven el mismo error.

### Herramientas
- Cada herramienta declara `risk`. Si mueve dinero, borra datos o es difícil de revertir es `"high"`;
  ante la duda, `"high"`.
- Los argumentos se validan con zod en código (`tool.schema.safeParse`), incluidos los editados por
  el aprobador humano.
- Las acciones con efecto secundario son idempotentes o llevan estado (ej. `refunded` acumulado).
- Las salidas de las herramientas no reflejan el texto del usuario (evita inyección reflejada).
- Los errores de negocio se lanzan con `throw` para que no cuenten como evidencia de éxito.
- Cada destino del router solo expone sus herramientas (`TOOLSETS`).

### Prompts y datos no confiables
- Todo contenido del usuario, de las herramientas o del modelo que se inserte entre etiquetas
  (`<user_message>`, `<mensaje>`, `<evidencia>`, `<respuesta>`) pasa por `escapeForTag`.
- Nunca se concatena texto no confiable ni generado por el modelo en el `system` prompt.
  El feedback de reintento va en el turno de usuario y usa solo mensajes fijos.
- La normalización de entrada (`normalize` en `src/guards.ts`) elimina caracteres invisibles
  (tag chars, bidi, BOM); la longitud se comprueba antes y después de NFKC.

### Human-in-the-loop
- Sin canal de aprobación, la acción se deniega por defecto.
- El aprobador ve cliente, mensaje original, acción y argumentos (con `JSON.stringify`, que escapa
  secuencias de control).
- Hay un único `readline` sobre stdin (`setApprovalInterface`).

### Límites
- Todo límite vive en `src/config.ts`: pasos del agente, timeout de herramientas, reintentos de
  salida, tokens y `maxModelCallsPerMessage`. No añadas bucles sin límite.
- Los timeouts cancelan la herramienta con `AbortSignal` y limpian el temporizador.

### Salida y logs
- El output guard comprueba siempre el grounding, aunque no haya evidencia.
- Antes de registrar texto del usuario o del modelo se aplica `maskPII` (claves `sk-`, IBAN,
  tarjetas válidas por Luhn).

### Secretos y dependencias
- `ANTHROPIC_API_KEY` solo en `.env` (permisos `600`, ignorado por git). `.env.example` lleva un
  placeholder.
- Versiones exactas para dependencias críticas (nada de `latest`).
- Antes de hacer commit: `npm run typecheck`, `npm audit` y `gitleaks detect --source . -v`.

### Al añadir una herramienta nueva
1. Esquema zod estricto (formatos, rangos, longitudes máximas).
2. `risk` declarado.
3. Comprobación de propiedad con `ctx.customerId` si toca datos de cliente.
4. Respetar `ctx.signal` antes de ejecutar efectos secundarios.
5. Añadirla solo al `TOOLSET` del destino que la necesite.
6. Probar intentos de inyección y de acceso a datos de otro cliente. 