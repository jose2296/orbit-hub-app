import { VECTOR_ICON_CATALOG } from "@orbit-hub/contracts";

import { DRAWINGS } from "@/lib/icons/vector-drawings";
import { searchEmojis } from "@/lib/icons/search-emoji";
import {
  DRAWING_COUNT,
  EMOJI_COUNT,
  buildIconGrid,
  categoryAtOffset,
  layoutOfRow,
  totalHeight,
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
    // Toda fila de celdas lleva el numero de columnas, y por eso ninguna celda
    // crece: una fila que no se llena reparte su ancho entre menos celdas.
    for (const row of grid.rows) {
      if (row.type === "cells") expect(row.cells, row.category).toHaveLength(8);
    }
    const relleno = grid.rows
      .flatMap((row) => row.cells)
      .filter((cell) => cell.placeholder).length;
    expect(grid.padding).toBe(relleno);
    expect(grid.padding).toBeLessThan(8);
  });

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

  it("cada categoría apunta a la fila que la abre", () => {
    const grid = buildIconGrid({ kind: "emoji", query: QUERY, columns: 8 });
    for (const section of grid.sections) {
      const fila = grid.rows[section.firstRow]!;
      expect(fila.category, section.category).toBe(section.category);
      expect(fila.type, section.category).toBe("header");
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
      expect(DRAWINGS.find((d) => d.id === celda.id)?.aliases).toContain(celda.value!);
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
    // "general" primero a proposito: ahi caen las acciones de la interfaz
    // (agregar, cerrar, buscar, guardar), que es lo que se busca mas a menudo.
    expect(grid.sections[0]?.category).toBe("general");
  });
});

describe("la geometria del scroll", () => {
  const CELL = 53;
  const TITULO = 28;

  it("la altura total se sabe antes de montar nada", () => {
    // El fallo que se va a arreglar: con `numColumns` la web mide las filas al
    // montarlas, asi que el contenido solo describia lo montado y la barra de
    // scroll mentia. Aqui la suma es aritmetica.
    const grid = buildIconGrid({ kind: "emoji", query: "", columns: 8 });
    const alto = totalHeight(grid.rows, CELL, TITULO);
    expect(alto).toBeGreaterThan(10000);
    // Toda fila es celdas y ningun grupo se repite: 240 filas + 9 titulos.
    const filas = grid.rows.filter((row) => row.type === "cells").length;
    const titulos = grid.rows.filter((row) => row.type === "header").length;
    expect(titulos).toBe(grid.sections.length);
    expect(alto).toBe(filas * CELL + titulos * TITULO);
  });

  it("cada fila tiene un alto y una posicion, sin medir", () => {
    const grid = buildIconGrid({ kind: "vector", query: "", columns: 8 });
    const primera = layoutOfRow(grid.rows, 0, CELL, TITULO);
    expect(primera).toEqual({ offset: 0, length: TITULO });
    expect(layoutOfRow(grid.rows, 1, CELL, TITULO)).toEqual({ offset: TITULO, length: CELL });
    expect(layoutOfRow(grid.rows, 2, CELL, TITULO)).toEqual({ offset: TITULO + CELL, length: CELL });
  });

  it("una fila fuera del listado no da un desplazamiento negativo", () => {
    const grid = buildIconGrid({ kind: "vector", query: "", columns: 8 });
    const la = layoutOfRow(grid.rows, 0, CELL, TITULO);
    expect(la.offset).toBe(0);
    // Mas alla del final: el alto, que es donde puede saltar.
    expect(layoutOfRow(grid.rows, grid.rows.length + 50, CELL, TITULO).offset).toBe(
      totalHeight(grid.rows, CELL, TITULO),
    );
  });

  it("la categoria es la del ultimo titulo que ya se ha pasado", () => {
    const grid = buildIconGrid({ kind: "vector", query: "", columns: 8 });
    const secciones = grid.sections;
    expect(secciones.length).toBeGreaterThan(1);

    // Justo en un titulo: en el offset cero ya se esta en la primera categoria.
    expect(categoryAtOffset(grid.rows, 0, CELL, TITULO)).toBe(secciones[0]?.category);

    // El titulo de la siguiente categoria, y la celda justo debajo: mismo sitio,
    // misma categoria. Y una fila mas abajo tambien, porque una categoria son
    // muchas filas y no una.
    const segunda = secciones[1]!;
    const enSuTitulo = layoutOfRow(grid.rows, segunda.firstRow, CELL, TITULO).offset;
    expect(categoryAtOffset(grid.rows, enSuTitulo, CELL, TITULO)).toBe(segunda.category);
    expect(categoryAtOffset(grid.rows, enSuTitulo + CELL, CELL, TITULO)).toBe(segunda.category);
    expect(categoryAtOffset(grid.rows, enSuTitulo + CELL * 4, CELL, TITULO)).toBe(segunda.category);

    // Y justo antes de su titulo se sigue en la anterior.
    expect(categoryAtOffset(grid.rows, enSuTitulo - 1, CELL, TITULO)).toBe(secciones[0]?.category);
  });

  it("la categoria no se adelanta al grupo que todavia no ha entrado", () => {
    const grid = buildIconGrid({ kind: "vector", query: "", columns: 8 });
    const ultima = grid.sections[grid.sections.length - 1]!;
    const antes = layoutOfRow(grid.rows, ultima.firstRow, CELL, TITULO).offset;
    expect(categoryAtOffset(grid.rows, antes - 1, CELL, TITULO)).not.toBe(ultima.category);
    expect(categoryAtOffset(grid.rows, antes, CELL, TITULO)).toBe(ultima.category);
  });

  it("saltar a una categoria cae en su titulo, no en una celda cualquiera", () => {
    const grid = buildIconGrid({ kind: "vector", query: "", columns: 8 });
    for (const section of grid.sections) {
      const fila = grid.rows[section.firstRow];
      expect(fila?.type, section.category).toBe("header");
      expect(fila?.category, section.category).toBe(section.category);
    }
  });

  it("con una busqueda puesta no hay titulos, y no hay scroll que saltarse", () => {
    // Diecinueve resultados no necesitan una barra de categorias, y un titulo
    // repetido por cada grupo parcial seria ruido.
    const grid = buildIconGrid({ kind: "vector", query: "cafe", columns: 8 }, "off");
    expect(grid.rows.every((row) => row.type === "cells")).toBe(true);
    expect(grid.sections).toEqual([]);
  });

  it("sin busqueda, cada grupo abre con su titulo y las celdas van debajo", () => {
    const grid = buildIconGrid({ kind: "emoji", query: "", columns: 8 });
    const titulos = grid.rows.filter((row) => row.type === "header");
    expect(titulos.length).toBeGreaterThan(1);
    for (const titulo of titulos) {
      const indice = grid.rows.indexOf(titulo);
      // Lo que va despues del titulo es celdas de su misma categoria.
      expect(grid.rows[indice + 1]?.category, titulo.category).toBe(titulo.category);
    }
  });
});
