import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { dictionaries } from "@/lib/i18n/dictionaries";

/**
 * La columna Done: se marca donde se edita una columna, se reconoce en el tablero y
 * esconde las completadas de hace mas de siete dias detras de un boton.
 */

const leer = (ruta: string) => readFileSync(resolve(__dirname, "..", ruta), "utf8");

describe("columna Done del tablero", () => {
  it("las claves nuevas existen en espanol y en ingles", () => {
    for (const clave of ["board.showOlderDone", "board.hideOlderDone"] as const) {
      expect(dictionaries.es[clave], clave).toBeTruthy();
      expect(dictionaries.en[clave], clave).toBeTruthy();
    }
  });

  it("la casilla Done esta en las dos hojas que editan una columna", () => {
    expect(leer("src/components/lists/state-editor-sheet.tsx")).toContain("board.stateDone");
    const hoja = leer("src/components/lists/state-edit-sheet.tsx");
    expect(hoja).toContain("board.stateDone");
    expect(hoja).toContain("onSave(titulo, color, hecha)");
  });

  it("la columna y la pestana Done llevan una marca y no el punto", () => {
    expect(leer("src/components/lists/board-column.tsx")).toContain("board-done-mark-");
    expect(leer("src/components/lists/board-tabs.tsx")).toContain('name="checkmark-circle"');
  });

  it("las completadas de mas de siete dias se esconden tras un boton", () => {
    const columna = leer("src/components/lists/board-column.tsx");
    expect(columna).toContain("DONE_VISIBLE_DAYS = 7");
    expect(columna).toContain("board-done-older-");
  });
});
