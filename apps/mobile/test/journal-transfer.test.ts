import { validateNoteDocument } from "@orbit-hub/contracts";
import { describe, expect, it } from "vitest";

import { mergeJournalDocuments } from "@/lib/journal/transfer";

describe("mergeJournalDocuments", () => {
  it("si el dia de destino esta vacio, queda el contenido tal cual", () => {
    expect(mergeJournalDocuments(null, "<p>hola</p>")).toBe("<p>hola</p>");
    expect(mergeJournalDocuments("<p></p>", "<p>hola</p>")).toBe("<p>hola</p>");
    expect(mergeJournalDocuments("", "<p>hola</p>")).toBe("<p>hola</p>");
  });

  it("si el destino ya tiene texto, el nuevo contenido va detras, sin perder nada", () => {
    expect(mergeJournalDocuments("<p>antes</p>", "<p>despues</p>")).toBe(
      "<p>antes</p><p>despues</p>",
    );
  });

  it("la web entrega el documento envuelto en <html>: no se anidan envoltorios", () => {
    const merged = mergeJournalDocuments("<html><p>a</p></html>", "<html><p>b</p></html>");
    expect(merged).toBe("<p>a</p><p>b</p>");
    expect(merged).not.toContain("<html");
  });

  it("copiar un dia vacio no cambia el destino", () => {
    expect(mergeJournalDocuments("<p>a</p>", "<p></p>")).toBe("<p>a</p>");
    expect(mergeJournalDocuments("<p>a</p>", "")).toBe("<p>a</p>");
  });

  it("el resultado es un documento que el servidor acepta", () => {
    const merged = mergeJournalDocuments(
      "<p>uno</p>",
      '<h1>Titulo</h1><ul><li>dos</li></ul>',
    );
    expect(validateNoteDocument(merged)).toEqual([]);
  });
});
