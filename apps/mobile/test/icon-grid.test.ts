import { VECTOR_ICON_CATALOG } from "@orbit-hub/contracts";

import { DRAWINGS } from "@/lib/icons/vector-drawings";
import { searchEmojis } from "@/lib/icons/search-emoji";
import {
  DRAWING_COUNT,
  EMOJI_COUNT,
  buildIconGrid,
  cellForIndex,
  rowForIndex,
} from "@/lib/icons/icon-grid";
import { describe, expect, it } from "vitest";

/**
 * The grid the picker shows: every icon, grouped, in full rows.
 *
 * The two things a grid gets wrong are both about size. `flex: 1` on a row that
 * does not fill divides the width between fewer cells and each one comes out
 * wider, so the last row of every category is bigger than the rest — the eye sees
 * that as "some icons take more room than others" without knowing why. And a
 * category bar that filters instead of navigating makes you choose a category
 * before you can see what is in it.
 *
 * So: cells ordered by category, the index of each category's first cell kept so
 * the bar can scroll to it, and the tail padded with invisible cells until the
 * length is a multiple of the column count.
 */

const QUERY = "";

describe("el grid de emojis", () => {
  it("trae el catálogo entero, no una muestra", () => {
    // El picker anterior limitaba a 240 con `scrollEnabled={false}`: 240 celdas
    // montadas siempre y las 1674 restantes inalcanzables.
    const grid = buildIconGrid({ kind: "emoji", query: QUERY, columns: 8 });
    const celdas = grid.cells.filter((cell) => !cell.placeholder).length;
    expect(celdas).toBe(searchEmojis("").length);
    expect(celdas).toBe(EMOJI_COUNT);
  });

  it("viene por defecto el de emojis, que es lo que se busca", () => {
    expect(buildIconGrid({ kind: "emoji", query: "", columns: 8 }).kind).toBe("emoji");
  });

  it("rellena la última fila, y por eso todas las filas tienen el mismo ancho", () => {
    const grid = buildIconGrid({ kind: "emoji", query: QUERY, columns: 8 });
    // Divisible por las columnas es lo que hace que ninguna celda crezca.
    expect(grid.cells.length % 8).toBe(0);
    expect(grid.padding).toBe(grid.cells.filter((cell) => cell.placeholder).length);
    expect(grid.padding).toBeLessThan(8);
  })

  it("las celdas de relleno no se pueden tocar", () => {
    const grid = buildIconGrid({ kind: "emoji", query: QUERY, columns: 7 });
    const relleno = grid.cells.filter((cell) => cell.placeholder);
    for (const cell of relleno) {
      expect(cell.onPick).toBeUndefined();
      expect(cell.label).toBe("");
    }
  });

  it("nunca devuelve el mismo emoji dos veces", () => {
    const grid = buildIconGrid({ kind: "emoji", query: "corazon", columns: 8 });
    const emojis = grid.cells.filter((cell) => !cell.placeholder).map((cell) => cell.id);
    expect(new Set(emojis).size).toBe(emojis.length);
  });

  it("agrupa por categoría y avisa de dónde empieza cada una", () => {
    const grid = buildIconGrid({ kind: "emoji", query: QUERY, columns: 8 });
    const categorias = grid.cells.filter((cell) => !cell.placeholder).map((cell) => cell.category);
    // Cada categoría aparece en un solo tramo: agrupado, no repartido.
    const tramos = new Set<string>();
    let anterior: string | null = null;
    for (const categoria of categorias) {
      if (categoria !== anterior) tramos.add(categoria);
      anterior = categoria;
    }
    expect(tramos.size).toBe(grid.sections.length);
  });

  it("cada categoría apunta a la celda que la abre", () => {
    const grid = buildIconGrid({ kind: "emoji", query: QUERY, columns: 8 });
    for (const section of grid.sections) {
      const celda = grid.cells[section.firstIndex]!;
      expect(celda.category, section.category).toBe(section.category);
      expect(celda.placeholder).toBeFalsy();
    }
  });

  it("buscar reduce el listado y avisa de qué categorías quedan", () => {
    const grid = buildIconGrid({ kind: "emoji", query: "libro", columns: 8 });
    expect(grid.cells.filter((cell) => !cell.placeholder).length).toBeGreaterThan(0);
    expect(grid.sections.length).toBeGreaterThan(0);
    // Con una búsqueda puesta, la barra se queda con las categorías que hay.
    for (const section of grid.sections) {
      expect(grid.cells.some((cell) => cell.category === section.category)).toBe(true);
    }
  });

  it("una palabra que no existe da un grid vacío y no un grid entero", () => {
    const grid = buildIconGrid({ kind: "emoji", query: "qqqqzzz", columns: 8 });
    expect(grid.cells.filter((cell) => !cell.placeholder)).toEqual([]);
    expect(grid.sections).toEqual([]);
    expect(grid.padding).toBe(0);
  });
});

describe("el grid de vectoriales", () => {
  it("trae un dibujo por celda, que es lo que no estaba", () => {
    const grid = buildIconGrid({ kind: "vector", query: QUERY, columns: 8 });
    const celdas = grid.cells.filter((cell) => !cell.placeholder);
    expect(celdas.length).toBe(DRAWINGS.length);
    const glifos = celdas.map((cell) => cell.id);
    expect(new Set(glifos).size).toBe(glifos.length);
  });

  it("menos celdas que antes, porque once palabras ya son un dibujo", () => {
    const grid = buildIconGrid({ kind: "vector", query: QUERY, columns: 8 });
    const celdas = grid.cells.filter((cell) => !cell.placeholder).length;
    expect(celdas).toBe(DRAWING_COUNT);
    expect(celdas).toBeLessThan(VECTOR_ICON_CATALOG.length);
  });

  it("cada celda guarda la clave del dibujo que se tocó", () => {
    const grid = buildIconGrid({ kind: "vector", query: "azucar", columns: 8 });
    const celdas = grid.cells.filter((cell) => !cell.placeholder);
    expect(celdas.length).toBeGreaterThan(0);
    for (const celda of celdas) {
      // Buscar "azucar" elige el cubo, y guarda la clave del cubo, no "azucar":
      // si guardara la palabra escrita, "sal" y "azucar" serían dos filas
      // distintas con el mismo dibujo.
      expect(DRAWINGS.find((d) => d.glyph === celda.id)?.aliases).toContain(celda.value!);
    }
  });

  it("dice cómo se llama cada celda, para el lector de pantalla", () => {
    const grid = buildIconGrid({ kind: "vector", query: "pan", columns: 8 });
    for (const celda of grid.cells.filter((cell) => !cell.placeholder)) {
      expect(celda.label.length).toBeGreaterThan(0);
    }
  });

  it("agrupa en el orden curado de las categorías, no alfabético", () => {
    // El orden declara cosas: el primero es trabajo a propósito y no "comida"
    // porque sea la primera letra. alfabético lo tiraría.
    const grid = buildIconGrid({ kind: "vector", query: QUERY, columns: 8 });
    const enElCatalogo = DRAWINGS.map((drawing) => drawing.category).filter(
      (categoria, i, todas) => todas.indexOf(categoria) === i,
    );
    expect(grid.sections.map((section) => section.category)).toEqual(enElCatalogo);
    expect(grid.sections[0]?.category).toBe("trabajo");
  });
});

describe("a qué píxel está una celda", () => {
  it("la fila es el índice partido por las columnas", () => {
    expect(rowForIndex(0, 8)).toBe(0);
    expect(rowForIndex(7, 8)).toBe(0);
    expect(rowForIndex(8, 8)).toBe(1);
    expect(rowForIndex(17, 8)).toBe(2);
  });

  it("el desplazamiento es la fila por la altura de la celda", () => {
    // Con celdas de 44 y 8 por fila, la celda 20 está en la tercera fila.
    expect(cellForIndex(20, 8, 44)).toBe(2 * 44);
    expect(cellForIndex(0, 8, 44)).toBe(0);
  });

  it("las columnas de más o de menos cambian el salto, no lo rompen", () => {
    expect(cellForIndex(20, 4, 44)).toBe(5 * 44);
    expect(cellForIndex(20, 10, 30)).toBe(2 * 30);
  });

  it("una celda fuera del listado va al final, no a un número negativo", () => {
    // Un `scrollToOffset` con offset negativo deja la lista en un estado que no
    // se puede recuperar, y con más índice del que hay no se sabe a dónde ir.
    expect(cellForIndex(-1, 8, 44)).toBe(0);
    expect(rowForIndex(-5, 8)).toBe(0);
  });
});
