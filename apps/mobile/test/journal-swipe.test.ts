import { describe, expect, it } from "vitest";

import { classifyDrag, swipeDirection } from "@/lib/journal/swipe";

describe("classifyDrag", () => {
  it("un movimiento pequeno aun no es nada: puede ser un toque", () => {
    expect(classifyDrag(4, 3)).toBe("undecided");
  });

  it("claramente horizontal es un swipe de dias", () => {
    expect(classifyDrag(30, 5)).toBe("horizontal");
    expect(classifyDrag(-30, 8)).toBe("horizontal");
  });

  it("claramente vertical es scroll, y ya no se reconsidera", () => {
    expect(classifyDrag(3, 30)).toBe("vertical");
  });

  it("en diagonal gana el eje que no es ambiguo: si sube mas que avanza, es scroll", () => {
    expect(classifyDrag(20, 25)).toBe("vertical");
    expect(classifyDrag(14, 18)).toBe("vertical");
  });
});

describe("swipeDirection", () => {
  const width = 400;

  it("arrastrar a la izquierda mas de un cuarto de pantalla es el dia siguiente", () => {
    expect(swipeDirection(-120, 0, width)).toBe(1);
  });

  it("arrastrar a la derecha mas de un cuarto es el dia anterior", () => {
    expect(swipeDirection(120, 0, width)).toBe(-1);
  });

  it("un arrastre corto y lento vuelve a su sitio", () => {
    expect(swipeDirection(-40, -100, width)).toBe(0);
    expect(swipeDirection(40, 100, width)).toBe(0);
  });

  it("un golpe rapido cambia de dia aunque sea corto", () => {
    expect(swipeDirection(-50, -900, width)).toBe(1);
    expect(swipeDirection(50, 900, width)).toBe(-1);
  });

  it("el golpe rapido en un sentido y el arrastre en otro no se suman a la mala", () => {
    expect(swipeDirection(-50, 900, width)).toBe(0);
  });

  it("sin ancho no hay swipe", () => {
    expect(swipeDirection(-500, -900, 0)).toBe(0);
  });
});
