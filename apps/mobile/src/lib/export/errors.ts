import { toApiError } from '@/lib/api/client';
import type { TranslationKey } from '@/lib/i18n/dictionaries';

/**
 * Que se le dice a la persona cuando la exportacion no sale.
 *
 * Puro a proposito: solo importan `toApiError` y el tipo de la clave, y nada de
 * `react-native`. Un modulo que llega a `Platform` es un modulo que arrastra el
 * stub del telefono a un test de Node, y esta traduccion es la que decide si el
 * fallo se dice en serio o se dice `undefined`; que se pueda probar sin un
 * dispositivo delante no es un lujo, es la mitad del trabajo.
 *
 * Lo que llega aqui en un movil lo decide `lib/export/save.ts`: alli el intercambio
 * HTTP ocurre dentro de `expo-file-system`, asi que no se construye ningun
 * `ApiError` y un fallo de descarga sale ya con `kind: 'network'`. Si no, un 401
 * en un telefono acabaria en `unknown`, que es `null` aqui, y la hoja pintaria
 * "algo fallo" de un 403 igual que de un 404.
 *
 * Devuelve `null` para lo que no tiene frase propia. Quien llama decide el hueco:
 * inventar una clave para un 422 que no tiene equivalente posible en Castellano
 * seria una frase que no describe el problema, y `export.error.unknown` esta ahi
 * para ese caso.
 */
export function exportErrorKey(error: unknown): TranslationKey | null {
  // Envuelto con `toApiError` y no con un `instanceof` porque el hook deja en
  // `error` lo que le haya capturado la promesa, y eso puede ser cualquier cosa:
  // un `TypeError` de dentro del modulo nativo, o directamente `undefined`.
  switch (toApiError(error).kind) {
    // Cortarse la red, tardar de mas y no tener conexion son el mismo problema
    // para quien lo ve: no ha salido, y la solucion es volver a pulsar. Tres
    // claves distintas dirian tres veces lo mismo.
    case 'network':
    case 'timeout':
    case 'offline':
      return 'export.error.network';

    case 'forbidden':
      return 'export.error.forbidden';

    case 'not_found':
      return 'export.error.notFound';

    case 'rate_limited':
      return 'export.error.rateLimited';

    case 'unauthorized':
      return 'export.error.unauthorized';

    // El resto se nombra de uno en uno, y no con un `default`, para que anadir un
    // codigo nuevo al contrato no compile en silencio: obliga a decidir que frase
    // lleva. Los de ahi son fallos del peticion que no son de la exportacion
    // (`validation_failed`, `conflict`) o del servidor, y `unknown` es lo que
    // queda cuando no se sabe que fallo.
    case 'bad_request':
    case 'validation_failed':
    case 'conflict':
    case 'not_implemented':
    case 'internal_error':
    case 'unknown':
      return null;
  }
}
