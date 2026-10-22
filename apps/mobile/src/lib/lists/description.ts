import { noteDocumentToPlainText } from "@orbit-hub/contracts";

/**
 * La descripcion de una tarea es un documento (como una nota) y `annotation` es su texto
 * plano. Una tarea escrita antes de que existiera el documento solo tiene `annotation`, y
 * la hoja de edicion tiene que poder abrirla en el editor sin perder nada.
 */

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** El documento con el que se abre el editor: el guardado, o el texto antiguo en parrafos. */
export function descriptionDocumentOf(item: {
  document?: string | null;
  annotation?: string | null;
}): string {
  if (item.document && item.document.length > 0) return item.document;
  const plain = (item.annotation ?? "").trim();
  if (plain.length === 0) return "";
  return plain
    .split(/\r?\n/)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

/** Un documento sin texto (`<p></p>`, solo espacios) es una descripcion vacia. */
export function descriptionIsEmpty(document: string): boolean {
  return noteDocumentToPlainText(document).trim().length === 0;
}
