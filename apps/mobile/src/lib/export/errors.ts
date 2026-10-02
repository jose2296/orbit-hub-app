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
 * `ApiError` y un fallo de descarga sale ya con `kind: 'network'`, que si tiene
 * frase. Sin eso, un 401 en un telefono acabaria en `unknown` — o sea `null`, o
 * sea silencio — y una sesion caducada no se diria de ninguna manera. Ese
 * trabajo de `save.ts` era lo que hacia que un `null` aqui fuera un hueco
 * pequeno; ahora es la unica linea que evita que el fallo no se diga.
 *
 * **Devuelve `null` para lo que no tiene frase propia, y quien llama pinta
 * exactamente eso: nada.** No hay ninguna clave de reserva, y no hay una frase
 * generica escondida detras de este `null` a la que recurrir: inventar una para
 * un 422 que no tiene equivalente posible en Castellano seria una frase que no
 * describe el problema, y una frase que no describe el problema es peor que no
 * decir ninguna. El silencio es la respuesta, no un hueco esperando a que lo
 * rellene quien llama.
 *
 * Que ese silencio sea el correcto es decision de quien llama y no de aqui, y
 * por eso el `null` viene con su razon escrita: `export-result-sheet.tsx` lo
 * pinta como una linea que no se dibuja, con el reintento y el cerrar debajo.
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
