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
 * sea silencio — y una sesion caducada no se diria de ninguna manera.
 *
 * **Devuelve `null` para lo que no tiene frase propia, y quien llama pinta
 * exactamente eso: nada.** No hay clave de reserva, y no hay una frase generica
 * escondida detras de este `null` a la que recurrir: una frase que no describe el
 * problema es peor que no decir ninguna. El silencio es la respuesta, no un hueco
 * esperando a que lo rellene quien llama.
 *
 * Y **el silencio se gana, no se supone**: un `null` solo vale si el fallo que
 * llega por ahi no es un fallo, o no puede llegar. `internal_error` estuvo aqui
 * un rato siendo un `null` y era el peor de los dos —un 500 es el fallo mas
 * probable del servidor y llegaba a un panel sin palabras—; ahora tiene su
 * frase. Los `null` que quedan estan justificados uno a uno en el `switch`, y
 * ahi esta escrito que hacer si alguno se vuelve alcanzable.
 */
export function exportErrorKey(error: unknown): TranslationKey | null {
  // Envuelto con `toApiError` y no con un `instanceof` porque el hook deja en
  // `error` lo que le haya capturado la promesa, y eso puede ser cualquier cosa:
  // un `TypeError` de dentro del modulo nativo, o directamente `undefined`.
  //
  // Y **sin `default`, a proposito**: anadir un codigo al contrato tiene que
  // romper la compilacion aqui, que obliga a decidir si ese fallo tiene frase o
  // se queda en silencio. Un `default` que devolviera `null` haria justo eso que
  // acaba de pasar con `internal_error`, en silencio y sin que nadie lo viera.
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

    // Un 500, y dice algo. `error-handler.ts` convierte **toda** excepcion sin
    // manejar en `internal_error`, y el export hace siete selects seguidos y un
    // mapeo por fila: un timeout de la base de datos, una violacion de una
    // restriccion o un fallo en `toItem` llegan todos aqui. Este caso estaba en el
    // `null` de abajo, y con la hoja callada eso era un panel con "Reintentar" y
    // "Cerrar" y ni una palabra — el fallo mas probable del servidor era el
    // unico que no se decia. La frase es la que era `export.error.unknown`, que
    // era la correcta para un 500 y la clave equivocada para el.
    case 'internal_error':
      return 'export.error.internal';

    // Los de aqui son `null` a proposito, y **no porque no tengan frase sino
    // porque no se pueden dar**: los tres son inalcanzables desde las rutas de
    // exportacion, y una clave que nadie puede pedir es una clave que un
    // traductor mantiene para siempre — el defecto que `export.error.unknown` y
    // `export.body` ya eran y que este fichero no va a volver a crear.
    //
    //   - `validation_failed` (422) solo sale de un `ZodError`, y las dos query de
    //     exportacion las construye el cliente con un formato fijo y un id que ya
    //     tiene: no hay nada que validar mal. Si apareciera, el fallo estaria en la
    //     app, y ese `null` lo delata en vez de esconderlo. **Si algun dia estas
    //     rutas aceptan un parametro que venga de fuera, esta linea es la alarma:
    //     hay que decidirle frase aqui.**
    //   - `not_implemented` (501) solo lo lanza `HttpError.notImplemented`, y lo
    //     lanzan `catalogs.ts` y el login con Google. Estas rutas existen.
    //   - `bad_request` (400) no se emite nunca: lo que no parsea es un
    //     `ZodError`, y sale como 422.
    //
    // `conflict` (409) se queda en `null` por otra razon y no por ser
    // inalcanzable del todo: el export no escribe y no mira versiones, asi que
    // las rutas de aqui no lo pueden devolver.
    //
    // Y `unknown` se queda tambien, y a sabiendas: `toApiError` manda ahi
    // cualquier cosa que no sea un `ApiError`, y ahi caen a la vez el `Error` de
    // `save.ts` —cerrar el panel de compartir, que en un movil es la manera mas
    // normal de que esto termine y no es un fallo— y el JSON mal formado de
    // `client.ts`. Separar los dos necesitaria otra clave, y esa se decidira
    // cuando el caso raro se vea de verdad.
    case 'bad_request':
    case 'validation_failed':
    case 'conflict':
    case 'not_implemented':
    case 'unknown':
      return null;
  }
}
