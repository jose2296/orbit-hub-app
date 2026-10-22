import { describe, expect, it } from "vitest";

import { shouldEnterEdit, PRESS_SETTLE_MS } from "@/lib/journal/press";

describe("shouldEnterEdit", () => {
  it("sin ningun enlace pulsado, un toque en el texto abre el editor", () => {
    expect(shouldEnterEdit(0, 10_000)).toBe(true);
  });

  it("si el enlace se pulso justo antes del toque, el toque no abre el editor", () => {
    expect(shouldEnterEdit(10_000 - 40, 10_000)).toBe(false);
  });

  it("si el aviso del enlace llega despues del toque, pero antes de decidir, tampoco", () => {
    // `onPress` espera `PRESS_SETTLE_MS` y entonces decide: un enlace avisado en ese intervalo
    // cuenta, venga antes o despues del toque del contenedor.
    const toque = 10_000;
    const aviso = toque + PRESS_SETTLE_MS - 20;
    expect(shouldEnterEdit(aviso, toque + PRESS_SETTLE_MS)).toBe(false);
  });

  it("un enlace pulsado hace rato no impide escribir ahora", () => {
    expect(shouldEnterEdit(10_000 - 5_000, 10_000)).toBe(true);
  });
});
