import { describe, expect, it } from "vitest";

import { pageTurn } from "@/lib/journal/pager";

describe("pageTurn", () => {
  const width = 400;

  it("quedarse en la pagina de en medio no cambia de dia", () => {
    expect(pageTurn(400, width)).toBe(0);
    expect(pageTurn(380, width)).toBe(0);
  });

  it("acabar en la primera pagina es ir al dia anterior", () => {
    expect(pageTurn(0, width)).toBe(-1);
    expect(pageTurn(30, width)).toBe(-1);
  });

  it("acabar en la ultima pagina es ir al dia siguiente", () => {
    expect(pageTurn(800, width)).toBe(1);
    expect(pageTurn(770, width)).toBe(1);
  });

  it("un ancho de cero no divide por cero", () => {
    expect(pageTurn(100, 0)).toBe(0);
  });
});
