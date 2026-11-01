import { describe, expect, it } from "vitest";
import { escapeForTag, normalize, sanitizeForPrompt } from "./untrusted.js";

describe("normalize", () => {
  it("aplica NFKC y recorta espacios", () => {
    expect(normalize("  ﬁ  ")).toBe("fi");
  });

  it("elimina caracteres invisibles, bidi, BOM y tag chars", () => {
    expect(normalize("a\u200Bb\u202Ec\uFEFFd\u{E0001}e")).toBe("abcde");
  });
});

describe("escapeForTag", () => {
  it("escapa los delimitadores y el ampersand", () => {
    expect(escapeForTag("<a>&</a>")).toBe("&lt;a&gt;&amp;&lt;/a&gt;");
  });
});

describe("sanitizeForPrompt", () => {
  it("colapsa espacios y saltos de línea en una sola línea", () => {
    expect(sanitizeForPrompt("a\n\t  b")).toBe("a b");
  });

  it("normaliza, escapa y recorta en ese orden", () => {
    expect(sanitizeForPrompt("  <x>&\u200B  ")).toBe("&lt;x&gt;&amp;");
  });

  it("limita la longitud antes de escapar", () => {
    expect(sanitizeForPrompt("a".repeat(10), 4)).toBe("aaaa");
  });

  it("devuelve cadena vacía si no queda contenido", () => {
    expect(sanitizeForPrompt(" \u200B ")).toBe("");
  });
});
