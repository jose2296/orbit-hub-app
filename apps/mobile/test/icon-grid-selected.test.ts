import { DRAWINGS } from "@/lib/icons/vector-drawings";
import { buildIconGrid, firstRowWhere, initialTab } from "@/lib/icons/icon-grid";
import { vectorGlyph } from "@orbit-hub/contracts";
import { describe, expect, it } from "vitest";

/**
 * Finding the icon that is already chosen.
 *
 * The picker does two things with it: mark it in the grid and scroll to it when it
 * opens. Both fail the same way if the match is on the wrong field.
 *
 * The cell of a drawing carries the **canonical** key and an `id` that is always
 * the **outline** glyph. A row can be carrying any of the words that draw it —
 * `azucar`, `sal` and `pimienta` all store the cell `contenedor` — so matching on
 * the key finds nothing and leaves the chosen icon unmarked, and matching on the
 * stored style's glyph finds nothing either, because the grid never holds a fill
 * glyph. Both of those were real, and both are what these tests pin down.
 */

describe("encontrar el icono que ya esta elegido", () => {
  it("encuentra un emoji por su glifo", () => {
    const grid = buildIconGrid({ kind: "emoji", query: "", columns: 8 });
    const fila = firstRowWhere(grid.rows, (celda) => celda.id === "🏠");
    expect(fila).not.toBeNull();
    expect(grid.rows[fila!]?.cells.some((celda) => celda.id === "🏠")).toBe(true);
  });

  it("encuentra un dibujo por su glifo y no por la palabra guardada", () => {
    const grid = buildIconGrid({ kind: "vector", query: "", columns: 8 });
    // `azucar` es una palabra del dibujo del cubo, pero la celda guarda
    // `contenedor`. Buscando por palabra no hay celda que responder.
    expect(firstRowWhere(grid.rows, (celda) => celda.value === "azucar")).toBeNull();
    expect(firstRowWhere(grid.rows, (celda) => celda.id === "ionicons:cube-outline")).not.toBeNull();
  });

  it("encuentra el dibujo aunque lo que se guardara fuera una palabra suelta", () => {
    // Todas las palabras de un dibujo encuentran la misma celda, que es justo lo
    // que hizo la deduplicacion.
    const celda = DRAWINGS.find((drawing) => drawing.id === "ionicons:cube-outline")!;
    const grid = buildIconGrid({ kind: "vector", query: "", columns: 8 });
    for (const palabra of celda.aliases) {
      const glifo = `ionicons:${vectorGlyph(palabra, "outline", "ionicons")}`;
      expect(firstRowWhere(grid.rows, (c) => c.id === glifo), palabra).not.toBeNull();
    }
  });

  it("la celda se busca por su glifo de contorno aunque este en relleno", () => {
    // El grid solo guarda glifos de contorno: una celda no cambia de nombre al
    // cambiar el estilo de dibujo. Un icono guardado en "relleno" sigue estando en
    // la misma celda, y matching por el glifo de relleno no lo encontraria.
    const grid = buildIconGrid({ kind: "vector", query: "", columns: 8 });
    expect(
      DRAWINGS.every((drawing) =>
        drawing.library === "ionicons"
          ? drawing.glyph.endsWith("-outline")
          : true,
      ),
    ).toBe(true);
    // La celda se nombra por su glifo de contorno en su libreria: el relleno no
    // tiene celda propia.
    expect(
      firstRowWhere(grid.rows, (celda) => celda.id === `ionicons:${vectorGlyph("carpeta", "fill", "ionicons")}`),
    ).toBeNull();
    expect(
      firstRowWhere(grid.rows, (celda) => celda.id === `ionicons:${vectorGlyph("carpeta", "outline", "ionicons")}`),
    ).not.toBeNull();
  });

  it("encuentra todos los dibujos menos los que no se pueden dibujar", () => {
    const grid = buildIconGrid({ kind: "vector", query: "", columns: 8 });
    const encontrados = DRAWINGS.filter(
      (drawing) => firstRowWhere(grid.rows, (celda) => celda.id === drawing.id) !== null,
    );
    expect(encontrados.length).toBe(DRAWINGS.length);
  });

  it("devuelve null cuando no hay nada elegido ahi", () => {
    const grid = buildIconGrid({ kind: "vector", query: "cafe", columns: 8 });
    expect(firstRowWhere(grid.rows, () => false)).toBeNull();
  });

  it("las celdas de relleno no se parecen a un icono sin valor", () => {
    // Una celda de relleno no tiene `value`, igual que una celda real no deberia
    // tenerlo nunca. Si el matcher mirase `value === undefined` encontraria la
    // primera de relleno — que esta al final de la lista — y saltaria al final.
    const grid = buildIconGrid({ kind: "emoji", query: "", columns: 8 });
    const fila = firstRowWhere(grid.rows, (celda) => celda.value === undefined);
    expect(fila).toBe(grid.rows.length - 1);
  });

  it("con una busqueda puesta encuentra el que sigue estando en la lista", () => {
    const grid = buildIconGrid({ kind: "vector", query: "carpeta", columns: 8 });
    expect(
      firstRowWhere(grid.rows, (celda) => celda.id === `ionicons:${vectorGlyph("carpeta", "outline", "ionicons")}`),
    ).not.toBeNull();
  });
});

describe("en que pestana se abre el selector", () => {
  it("abre en la del icono elegido, si es un dibujo", () => {
    // Volver a cambiar el color de un icono que ya es un vectorial no deberia
    // obligar a pasar por cuatro mil emojis de sistema.
    expect(initialTab({ type: "vector", value: "carpeta", library: "ionicons", style: "outline", color: "teal" })).toBe("vector");
    expect(initialTab({ type: "vector", value: "carpeta", library: "ionicons", style: "fill", color: "auto" })).toBe("vector");
  });

  it("abre en emojis si el icono elegido es un emoji", () => {
    expect(initialTab({ type: "emoji", value: "📖", color: "auto" })).toBe("emoji");
  });

  it("abre en emojis cuando no hay icono, que es lo que se busca por defecto", () => {
    expect(initialTab(null)).toBe("emoji");
    expect(initialTab(undefined)).toBe("emoji");
  });
});
