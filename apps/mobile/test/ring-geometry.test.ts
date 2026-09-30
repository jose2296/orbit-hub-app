import { describe, expect, it } from "vitest";

import { cuartosDeProgreso } from "../src/components/media/ring-geometry";

/**
 * The angles of a ring that fills.
 *
 * This is the part of the rating a screenshot cannot check. A ring that is fifteen
 * degrees out is not obviously wrong: it looks like a design. So what is tested
 * here is the arithmetic — how far round each quarter is, which ones are drawn at
 * all, and the two ways a number can be nonsense.
 */
const giros = (ratio: number) => cuartosDeProgreso(ratio).map((c) => c.giro);

describe("cuartosDeProgreso", () => {
  it("a cero no hay nada, y no se dibuja ningun cuarto", () => {
    const c = cuartosDeProgreso(0);
    expect(c.every((q) => q.giro === 0)).toBe(true);
    expect(c.every((q) => !q.visible)).toBe(true);
  });

  it("a la mitad, dos cuartos enteros y el tercero sin empezar", () => {
    expect(giros(0.5)).toEqual([90, 90, 0, 0]);
    expect(cuartosDeProgreso(0.5).map((q) => q.visible)).toEqual([true, true, false, false]);
  });

  it("a uno, los cuatro enteros", () => {
    expect(giros(1)).toEqual([90, 90, 90, 90]);
  });

  it("un cuarto es un cuarto, medido y no redondeado", () => {
    expect(giros(0.25)).toEqual([90, 0, 0, 0]);
  });

  it("en mitad de un cuarto, ese cuarto va por la mitad", () => {
    // 0.125 son dos octavos de vuelta: el primer cuarto, a la mitad.
    expect(giros(0.125)[0]).toBeCloseTo(45, 5);
  });

  it("0,62 no se redondea a 0,5 ni a 0,75", () => {
    const g = giros(0.62);
    expect(g[0]).toBe(90);
    expect(g[1]).toBe(90);
    // 0,62 son 2,48 cuartos: el tercero va por el 48% de sus 90 grados.
    expect(g[2]).toBeCloseTo(0.48 * 90, 5);
    expect(g[3]).toBe(0);
  });

  it("el circulo empieza arriba y no a las tres", () => {
    // El primer cuarto son los grados 0 a 90medidos desde las doce, que es el
    // cuadrante superior derecho. Si el anillo empezara a las tres, el primero
    // estaria en 90 a 180 y un cuarto de la puntuacion caeria abajo.
    expect(giros(0.01)[0]).toBeLessThan(5);
  });

  it("nada se pasa de un cuarto, aunque el ratio se pase de uno", () => {
    for (const g of giros(4)) expect(g).toBeLessThanOrEqual(90);
  });

  it("un numero que no es un numero vale cero y no rompe", () => {
    expect(giros(Number.NaN)).toEqual([0, 0, 0, 0]);
    expect(giros(Number.POSITIVE_INFINITY)).toEqual([0, 0, 0, 0]);
    expect(giros(-3)).toEqual([0, 0, 0, 0]);
  });

  it("un cuarto lleno y el siguiente a cero se distinguen del que no existe", () => {
    /*
     * La diferencia entre "este cuarto esta lleno" y "este cuarto no se dibuja" es
     * lo que decide si hay un borde de mas en el anillo. Devolver las dos cosas
     * como cero las hace lo mismo y un anillo con un cuarto de mas parece un
     * fallo de dibujo.
     */
    const enElBorde = cuartosDeProgreso(0.25);
    expect(enElBorde[0]).toEqual({ giro: 90, visible: true });
    expect(enElBorde[1]).toEqual({ giro: 0, visible: false });
  });
});
