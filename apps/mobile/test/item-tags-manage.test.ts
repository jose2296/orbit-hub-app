import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { dictionaries } from "@/lib/i18n/dictionaries";

/**
 * Las etiquetas de la lista, en la hoja de una tarea.
 *
 * La tarea solo asigna y crea. Renombrar, colorear y borrar una etiqueta es de la
 * lista: va a su propia pagina, y borrar pregunta antes porque quita la etiqueta de
 * todas sus tareas. Se comprueba el contrato y no la pantalla.
 */

const hoja = readFileSync(
  resolve(__dirname, "../src/components/lists/item-edit-sheet.tsx"),
  "utf8",
);

const CLAVES = [
  "tags.noneInList",
  "tags.manage",
  "tags.manageSubtitle",
  "tags.manageHint",
  "tags.editLabel",
  "tags.usedBy.one",
  "tags.usedBy.other",
  "tags.renameLabel",
  "tags.saveRename",
  "tags.deleteLabel",
  "tags.nameTaken",
  "tags.deleteTitle",
  "tags.deleteBody.one",
  "tags.deleteBody.other",
] as const;

describe("etiquetas de la lista en la hoja de una tarea", () => {
  it("cada clave nueva existe en espanol y en ingles", () => {
    for (const clave of CLAVES) {
      expect(dictionaries.es[clave], clave).toBeTruthy();
      expect(dictionaries.en[clave], clave).toBeTruthy();
    }
  });

  it("la pagina de la tarea es un interruptor por etiqueta, sin selector de color en linea", () => {
    expect(hoja).toContain("tag-toggle-");
    expect(hoja).toContain('accessibilityRole="checkbox"');
    expect(hoja).not.toContain("TagColorButton");
  });

  it("gestionar tiene pagina propia, y renombrar y borrar tocan todas las tareas de la lista", () => {
    expect(hoja).toContain('page === "etiquetas"');
    expect(hoja).toMatch(/const renombrarTag = async[\s\S]*?updateItem\(row/);
    expect(hoja).toMatch(/const borrarEtiqueta = async[\s\S]*?updateItem\(row/);
  });

  it("borrar una etiqueta pide confirmacion con cuantas tareas afecta", () => {
    const pagina = hoja.slice(hoja.indexOf('page === "etiquetas"'));
    expect(pagina).toContain("<ConfirmDialog");
    expect(pagina).toContain("usosDe(aBorrarTag");
  });
});
