import { noteDocumentToPlainText, unwrapDocumentHtml } from "@orbit-hub/contracts";
import type { JournalDay } from "@orbit-hub/contracts";

/**
 * Pasar o copiar lo escrito un dia a otro.
 *
 * La parte pura (`mergeJournalDocuments`) esta aparte de la que toca la base local
 * porque es donde se pierde el texto: el destino puede tener ya algo escrito, y un
 * "copiar" que lo pisara seria perder el diario de ese dia.
 */

const hasText = (document: string | null): document is string =>
  document !== null && noteDocumentToPlainText(document).trim().length > 0;

/**
 * El documento de un dia con otro anadido detras.
 *
 * Detras y no delante: lo que ya estaba escrito es lo que la persona espera seguir
 * viendo arriba. La web entrega el documento envuelto en `<html>` y el movil no
 * (ver `unwrapDocumentHtml`), asi que los dos se desenvuelven antes de juntarlos o
 * el resultado llevaria un `<html>` dentro de otro.
 */
export function mergeJournalDocuments(target: string | null, source: string): string {
  if (!hasText(source)) return target ?? "";
  if (!hasText(target)) return source;
  return `${unwrapDocumentHtml(target)}${unwrapDocumentHtml(source)}`;
}

export type JournalTransferMode = "copy" | "move";

/**
 * Lleva el contenido de `from` a `to`. Copiar deja el origen como estaba; mover lo
 * deja vacio. El destino se conserva y recibe el contenido al final.
 */
export async function transferJournalDay(
  userId: string,
  from: JournalDay,
  to: JournalDay,
  mode: JournalTransferMode,
): Promise<void> {
  if (from === to) return;
  // Import perezoso, como en `share-intent`: este modulo tiene una parte pura que se
  // prueba en Node, y `entries` arrastra SQLite y expo-crypto.
  const { readJournalEntry, writeJournalEntry } = await import("./entries");

  const source = await readJournalEntry(userId, from);
  if (!source || !hasText(source.document)) return;

  const target = await readJournalEntry(userId, to);
  await writeJournalEntry(userId, to, mergeJournalDocuments(target?.document ?? null, source.document));

  if (mode === "move") await writeJournalEntry(userId, from, "<p></p>");
}
