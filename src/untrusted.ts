/* Tratamiento de texto no confiable: normalización, escapado y límites. */

// Caracteres de control e invisibles (zero-width, bidi, word joiners, BOM y
// "tag chars" usados para ASCII smuggling).
const INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;

export function normalize(msg: string): string {
  return msg.normalize("NFKC").replace(INVISIBLE, "").trim();
}

/** Escapa los delimitadores para que el texto no pueda cerrar su etiqueta de datos. */
export function escapeForTag(msg: string): string {
  return msg.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Sanitiza texto que se va a insertar entre etiquetas en un prompt:
 * normaliza, elimina invisibles, colapsa espacios, recorta y escapa delimitadores.
 */
export function sanitizeForPrompt(msg: string, maxLength = 500): string {
  return escapeForTag(
    normalize(msg)
      .replace(/\s+/g, " ")
      .slice(0, maxLength)
      .trim(),
  );
}
