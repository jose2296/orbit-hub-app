import type { Bookmark } from "@orbit-hub/contracts";

import { deleteBookmarkAction, updateBookmarkAction } from "@/lib/bookmarks/actions";
import type { MenuContext } from "@/lib/menus/registry";

import type { MenuHandlers } from "@/components/menus/entity-menu-sheet";

/**
 * Lo que un enlace necesita para entrar al menu del registro, y **en un solo
 * archivo** porque lo necesitan dos pantallas.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTA AFUERA Y NO EN `components/menus/`
 * ------------------------------------------------------------------
 *
 * Porque el archivo de la coleccion vive junto a la hoja (`coleccion.ts`) y este
 * no: el enlace no tiene hoja propia desde que `DeletePage` absorbio a
 * `BookmarkDeleteSheet`, asi que lo unico que queda de el son estas dos
 * funciones y no hay una hoja a la que estar al lado. Lo que decide donde vive
 * un archivo es a que pertenece, y estas dos pertenecen a `lib/menus`, que es
 * donde vive el registro al que sirven.
 *
 * ------------------------------------------------------------------
 * POR QUE EL NOMBRE SE NORMALIZA ACA Y NO EN CADA PANTALLA
 * ------------------------------------------------------------------
 *
 * Porque hay **tres** lugares que necesitan el nombre de un enlace y no lo
 * tienen todos: la fila de la lista, la fila del inbox y la cabecera de la hoja
 * que se abre desde cualquiera de las dos. `bookmark.title` puede ser `""` —el
 * servidor todavia no extrajo la pagina— y las tres pantallas ya tenian copiada
 * la regla de que caiga al host y luego a la URL, escrita igual en dos archivos.
 *
 * Con la hoja encima el nombre se lee por lo menos tres veces por fila, asi que
 * tres copias de la regla son tres reglas que pueden diferir sin que nada falle:
 * el menu de la lista diria una cosa y el del inbox otra, para el mismo enlace.
 * El registro no puede normalizarlo porque no conoce el contrato de ninguna
 * entidad —es lo que dice el comentario de `MenuEntity.title`—, asi que el
 * call site lo hace una vez y las dos pantallas lo toman de aca.
 */
export function menuCtxDeBookmark(bookmark: Bookmark | null): MenuContext | null {
  if (!bookmark) return null;

  return {
    kind: "bookmark",
    entity: {
      id: bookmark.id,
      // El titulo del contrato, o el host cuando el servidor todavia no extrajo
      // nada, o la URL cruda cuando tampoco hay host. La hoja muestra este
      // texto en la cabecera y en el campo de renombrar, y un `""` ahi deja el
      // menu sin nombre y apaga el boton de guardar sin explicar por que.
      title: tituloDeBookmark(bookmark),
      // Sin retocar: `role` y `shared` son los que decide que borrar salga
      // grisado con su motivo (la Review Focus #1), y traducirlos aca seria
      // una oportunidad mas de colar un `role: string`.
      role: bookmark.role,
      shared: bookmark.shared,
    },
    // Sin `export`: no hay endpoint de exportar un enlace, y por eso la fila no
    // se ofrece en vez de ofrecerse y fallar al tocarla. `access` lo declara el
    // registro para este kind pero la hoja todavia no monta esa pagina, asi que
    // `puedeOfrecerse` la filtra; cuando llegue, no hay nada que cambiar aca.
    caps: {},
  };
}

/**
 * Guardar y borrar, con las acciones que ya existen.
 *
 * Local-first como el resto: el tombstone se escribe en la cache y la operacion
 * se encola, asi que un fallo de red no es un fallo de borrar. Y borrar
 * **no** se unifica con el de las colecciones —cada superficie hace algo
 * distinto antes de escribir— ni con el de las notas, por el mismo motivo que
 * el comentario de `handlersDeColeccion` da.
 */
export function handlersDeBookmark(
  bookmark: Bookmark | null,
  clasificar?: () => void,
): MenuHandlers {
  if (!bookmark) return {};

  return {
    rename: (title) =>
      updateBookmarkAction({ id: bookmark.id, baseVersion: bookmark.version, title }),
    borrar: () => deleteBookmarkAction(bookmark.id),
    // Solo si la pantalla lo pasa: la fila de la lista no clasifica porque un
    // enlace de la lista ya esta clasificado, y una accion opcional que no llega
    // es una fila que no se ofrece, no un boton que falla.
    ...(clasificar ? { clasificar } : {}),
  };
}

/**
 * El nombre de un enlace, y la regla de cuando no hay.
 *
 * El host primero porque dice mas que una fila muda y menos que la URL entera;
 * la URL cruda al final porque es lo unico que queda y sigue siendo mejor que
 * un vacio. Es la misma regla que las dos filas ya usaban para pintarse, y por
 * eso ahora la comparten con el menu en vez de repetirla.
 */
export function tituloDeBookmark(bookmark: Bookmark): string {
  if (bookmark.title.length > 0) return bookmark.title;

  return hostDe(bookmark.url) || bookmark.url;
}

/** El host de una URL, o vacio si no hay nada que ensenar. */
export function hostDe(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
