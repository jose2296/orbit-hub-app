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

  it("la pagina es el editor de notas, con alto de editor, y no un campo de texto", () => {
    const pagina = hoja.slice(hoja.indexOf('testID="item-description"'));
    const bloque = pagina.slice(0, pagina.indexOf("</View>"));
    expect(bloque).toContain("<DescriptionEditor");
    // El valor inicial se congela: el editor se reinicia si `defaultValue` cambia, y el
    // estado de la hoja cambia con cada tecla.
    expect(hoja).toContain("const [start] = useState(initial);");
    expect(hoja).toContain("<NoteEditor");
    expect(bloque).toMatch(/height: \d{3}/);
    expect(hoja, "ya no es un TextField multilinea").not.toContain('FIELD_LIMITS["list_item.annotation"]');
  });

  it("Guardar lee el documento vivo del editor y manda documento y anotacion juntos", () => {
    // Leer el HTML es asincrono y Guardar se puede pulsar justo despues de teclear.
    expect(hoja).toContain("const liveDescription = async");
    expect(hoja).toContain("descEditorRef.current.getHTML()");
    expect(hoja).toMatch(/return \{ document: doc, annotation:/);
  });

  it("el titulo ya no se encadena con nadie: es el unico campo de su pagina", () => {
    expect(hoja).not.toContain("useFieldChain");
  });
});
