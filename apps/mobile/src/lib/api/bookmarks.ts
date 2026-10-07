import { api, ApiError } from "./client";

/**
 * Cuanto se espera antes de cada reintento tras un 404.
 *
 * Un 404 justo despues de compartir no es "el enlace no existe": es que el
 * bookmark se escribio en local y su operacion `create` sigue en la cola, asi que
 * el servidor aun no lo conoce. Suele llegar en un par de segundos; la ultima
 * espera cubre una conexion lenta.
 */
const ESPERAS_MS = [1500, 4000, 10000] as const;

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Pide la extraccion y, si el servidor aun no tiene el bookmark (404), espera y
 * vuelve a pedirla. Cualquier otro error termina aqui sin lanzar: el fallo ya
 * queda en `extractionState` y el lector reintenta al abrir el enlace.
 *
 * Con `esperar` inyectable para probarlo sin esperar de verdad.
 */
export async function extractWithRetry(
  bookmarkId: string,
  esperar: (ms: number) => Promise<void> = dormir,
): Promise<void> {
  for (let intento = 0; ; intento += 1) {
    try {
      await api.post<void>(`/bookmarks/${bookmarkId}/extract`, undefined);
      return;
    } catch (error) {
      const aunNoLlego = error instanceof ApiError && error.status === 404;
      const espera = ESPERAS_MS[intento];
      if (!aunNoLlego || espera === undefined) return;
      await esperar(espera);
    }
  }
}

/**
 * Pide al servidor la metadata del enlace, sin esperar.
 *
 * Fire-and-forget a proposito: el endpoint responde 204 y el texto llega por
 * el pull (fase 2), asi que nadie espera esta promesa. Sin red, el bookmark
 * queda `pending` y el lector lo reintenta al abrirlo.
 */
export function triggerExtract(bookmarkId: string): void {
  void extractWithRetry(bookmarkId).catch(() => {});
}
