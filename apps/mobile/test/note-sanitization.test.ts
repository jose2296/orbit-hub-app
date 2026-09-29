import { expect, test } from "vitest";

import { NOTE_SANITIZATION } from "../src/lib/notes/sanitization";

/**
 * The regex is not ours, so the only way to know it still allows what the app
 * needs is to ask it. Each case is something a note has actually contained.
 */
function allows(uri: string): boolean {
  return NOTE_SANITIZATION.linkRegex?.test(uri) ?? false;
}

describe("la sanitizacion del editor", () => {
  it("deja pasar la imagen del navegador, que es la que rompe la nota si no", () => {
    // The whole bug: DOMPurify's default drops `blob:`, the editor was handed a
    // picture it could not read, and saving wrote `<img src="">`.
    expect(allows("blob:http://localhost:8082/3b8e9fa5-553d-41b9-8907-8ee97b80b6cb")).toBe(
      true,
    );
  });

  it("deja pasar la imagen de un telefono, que es un fichero de la cache", () => {
    expect(allows("file:///data/user/0/com.orbithub.app/cache/note-images/a.png")).toBe(true);
  });

  it("deja pasar los enlaces que una nota puede llevar", () => {
    expect(allows("https://example.com")).toBe(true);
    expect(allows("http://example.com")).toBe(true);
    expect(allows("mailto:someone@example.com")).toBe(true);
    expect(allows("tel:+34600000000")).toBe(true);
  });

  it("no deja pasar un esquema que nadie necesita, porque la lista sustituye a la de por defecto", () => {
    expect(allows("javascript:alert(1)")).toBe(false);
    expect(allows("vbscript:msgbox(1)")).toBe(false);
  });

  it("no rompe un enlace con ruta, consulta o fragmento", () => {
    expect(allows("https://example.com/a/b?c=1#d")).toBe(true);
  });
});
