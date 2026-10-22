import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hoja = readFileSync(
  resolve(__dirname, "../src/components/lists/item-edit-sheet.tsx"),
  "utf8",
);

describe("la descripcion de una tarea tiene su propia pagina", () => {
  it("la hoja de edicion tiene una pagina `description`", () => {
    expect(hoja).toMatch(/type Page = "edit" \| "icon" \| "tags" \| "description"/);
    expect(hoja).toContain('page === "description"');
  });

  it("la pagina de edicion solo lleva un resumen que la abre", () => {
    expect(hoja).toContain('testID="item-description-link"');
    expect(hoja).toContain('setPage("description")');
  });

  it("el editor grande es multilinea, con el limite del contrato y alto de editor", () => {
    const pagina = hoja.slice(hoja.indexOf('testID="item-description"'));
    const campo = pagina.slice(0, pagina.indexOf("/>"));
    expect(campo).toContain("multiline");
    expect(campo).toContain("FIELD_LIMITS[\"list_item.annotation\"]");
    expect(campo).toMatch(/minHeight: \d{3}/);
  });

  it("el titulo ya no se encadena con nadie: es el unico campo de su pagina", () => {
    expect(hoja).not.toContain("useFieldChain");
  });
});
