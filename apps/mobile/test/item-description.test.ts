import { validateNoteDocument } from "@orbit-hub/contracts";
import { describe, expect, it } from "vitest";

import { descriptionDocumentOf, descriptionIsEmpty } from "@/lib/lists/description";

describe("descriptionDocumentOf", () => {
  it("si la tarea ya tiene documento, es ese", () => {
    expect(descriptionDocumentOf({ document: "<p>hola</p>", annotation: "viejo" })).toBe("<p>hola</p>");
  });

  it("una tarea antigua con solo anotacion se abre como parrafos, una linea cada uno", () => {
    expect(descriptionDocumentOf({ document: "", annotation: "uno\ndos" })).toBe("<p>uno</p><p>dos</p>");
  });

  it("el texto antiguo no puede inyectar marcado: se escapa", () => {
    const doc = descriptionDocumentOf({ document: "", annotation: "<script>alert(1)</script> & co" });
    expect(doc).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</p>");
    expect(validateNoteDocument(doc)).toEqual([]);
  });

  it("sin nada, es vacio", () => {
    expect(descriptionDocumentOf({ document: "", annotation: null })).toBe("");
    expect(descriptionDocumentOf({ document: "", annotation: "   " })).toBe("");
  });
});

describe("descriptionIsEmpty", () => {
  it("un documento sin texto cuenta como vacio", () => {
    expect(descriptionIsEmpty("")).toBe(true);
    expect(descriptionIsEmpty("<p></p>")).toBe(true);
    expect(descriptionIsEmpty("<html><p> </p></html>")).toBe(true);
    expect(descriptionIsEmpty("<p>algo</p>")).toBe(false);
  });
});
