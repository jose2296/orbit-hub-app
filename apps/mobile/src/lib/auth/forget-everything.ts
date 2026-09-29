import { STORAGE_KEYS } from '@/constants';
import { keyValueStore } from '@/lib/storage/key-value';

/**
 * Lo que una sesion dejo escrito, y que se va con ella.
 *
 * Todo lo que hay en `keyValueStore` no es de la persona: unas cosas son
 * preferencias de *este* aparato y otras son de *esta sesion*, y la diferencia es
 * la que decide lo que sobrevive a un cierre de sesion.
 *
 * Se van:
 *
 * - la cache, el outbox y los conflictos. La siguiente persona que entra en este
 *   navegador se encontraba con los espacios, carpetas y titulos de la anterior
 *   mientras el servidor contestaba `items: []` — dos mitades de la app
 *   discrepando, y la que se veia era de otra persona.
 *
 * - **el cursor del pull**, y este no es solo datos que sobran: es un fallo de
 *   correccion. El cursor es una marca de tiempo y el servidor devuelve solo lo
 *   posterior a ella, asi que el siguiente login empieza a descargar *despues* de
 *   donde acabo la sesion anterior. Todo lo que la cuenta nueva hubiera escrito
 *   antes de ese instante — o que otro dispositivo suyo escribiera — no llega
 *   nunca a ese navegador. No se ve como datos ajenos: se ve como una lista vacia
 *   y un "todo al dia" que no es cierto, que es peor que no sincronizar.
 *
 * Se quedan:
 *
 * - `appearance` y `locale`. Son de la persona, pero de la persona *que usa este
 *   aparato*, y volver a preguntar el tema en cada cierre de sesion es hacer que
 *   alguien elija dos veces lo mismo.
 *
 * - `clientId`. Es la identidad del aparato y no de la cuenta: es justo lo que
 *   tiene que sobrevivir para que el servidor reconozca el mismo telefono.
 *
 * Es su propio modulo y no una linea dentro de `auth-client` porque el store local
 * no es asunto del cliente de auth: ese modulo habla con el servidor y guarda
 * tokens, y llegar al outbox desde ahi haria que los dos fueran imposibles de
 * cambiar por separado — o de probar, porque importar el store en el cliente de
 * auth arrastra SQLite a cada test que toca un token.
 */
export async function forgetEverything(): Promise<void> {
  try {
    const { getLocalStoreReady } = await import('@/lib/offline/local-store');
    const store = await getLocalStoreReady();
    // `reset` para el outbox y los conflictos, `clearCache` para las filas y el
    // estado. Las dos, y no una: el outbox es lo que empujaria las escrituras sin
    // enviar de la persona anterior bajo el token *nuevo*.
    await store.reset();
    await store.clearCache();
  } catch {
    // Cerrar sesion tiene que funcionar. Los tokens ya se fueron cuando esto
    // corre, y esa es la parte que es un asunto de seguridad; las filas que queden
    // las limpia el siguiente que entre.
  }

  // El cursor y la marca de la ultima sincronizacion van aparte del store, que
  // no los conoce: viven en el almacen de clave-valor, como las preferencias. Van
  // fuera de su `try` porque no pueden fallar — `keyValueStore` ya se traga sus
  // propios errores — y porque dejarlos atras por un fallo ajeno seria el
  // silencio que este modulo existe para evitar.
  keyValueStore.remove(STORAGE_KEYS.syncCursor);
  keyValueStore.remove(STORAGE_KEYS.lastSyncedAt);
}

