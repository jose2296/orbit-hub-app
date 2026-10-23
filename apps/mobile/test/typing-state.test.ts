import { describe, expect, it } from "vitest";

import { isTyping } from "@/lib/typing-state";

describe("isTyping", () => {
  it("en la web escribir es tener el foco: no hay evento de teclado", () => {
    expect(isTyping({ focused: true, keyboardHeight: 0, platform: "web" })).toBe(true);
    expect(isTyping({ focused: false, keyboardHeight: 0, platform: "web" })).toBe(false);
  });

  it("en Android el sistema da el foco al primer campo al abrir la pantalla, sin teclado: no es escribir", () => {
    expect(isTyping({ focused: true, keyboardHeight: 0, platform: "android" })).toBe(false);
  });

  it("con el foco y el teclado abierto, si", () => {
    expect(isTyping({ focused: true, keyboardHeight: 320, platform: "android" })).toBe(true);
    expect(isTyping({ focused: true, keyboardHeight: 320, platform: "ios" })).toBe(true);
  });

  it("con el teclado abierto pero el foco en otro sitio, no", () => {
    expect(isTyping({ focused: false, keyboardHeight: 320, platform: "android" })).toBe(false);
  });
});
