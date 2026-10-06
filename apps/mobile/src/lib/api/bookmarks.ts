import { api } from "./client";

/**
 * Pide al servidor la metadata del enlace, sin esperar.
 *
 * Fire-and-forget a proposito: el endpoint responde 204 y el texto llega por
 * el pull (fase 2), asi que nadie espera esta promesa. El `catch` vacio es
 * correcto aqui y no un descuido: el fallo ya queda representado en
 * `extractionState`, y un toast por un fetch de fondo seria ruido. Sin red,
 * el bookmark queda `pending` y la fase 4 lo reintenta al abrirlo.
 */
export function triggerExtract(bookmarkId: string): void {
  void api.post<void>(`/bookmarks/${bookmarkId}/extract`, undefined).catch(() => {});
}
