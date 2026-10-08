import type { DashboardWidget, Folder, IconRef, List } from "@orbit-hub/contracts";

import {
  isPinned,
  withPinnedList,
  withoutPinnedList,
} from "@/lib/dashboard/pin";
import type { Translate } from "@/lib/i18n";
import { LIST_KIND_LABEL } from "@/lib/lists/kind";
import type { MenuContext } from "@/lib/menus/registry";

import type { MenuHandlers } from "@/components/menus/entity-menu-sheet";

/**
 * Lo que una lista necesita para entrar al menu del registro, y **todo en un solo
 * archivo** porque lo necesitan cuatro pantallas.
 *
 * ------------------------------------------------------------------
 * POR QUE UNA LISTA Y NO UNA COLECCION
 * ------------------------------------------------------------------
 *
 * Porque la lista es la hoja mas completa de la app y es la primera que migra, asi
 * que es la que deja ver cuanto del archivo hacia falta. La coleccion necesita
 * dos funciones —un `ctx` y unos handlers— porque solo tiene `rename` y `delete`.
 * Una lista necesita ademas el icono, el conteo, si esta pineada y el subtitulo, y
 * eso son **cuatro** datos mas que si vivieran en cada pantalla serian cuatro
 * copias que empiezan a diferir el dia que cambie algo:
 *
 * - el `kind` y el `title`, que el registro normaliza,
 * - el icono, que `MenuEntity` no puede llevar y va por props,
 * - el conteo, que tampoco, y que `DeletePage` cuenta para decir cuantos elementos
 *   se van,
 * - el pineo, que es **estado de pantalla** y no de entidad, y
 * - el subtitulo, que es el tipo de lista **y la carpeta donde vive**.
 *
 * La ultima es la que mas cuesta ver: `entity.title` de una lista es `list.title`,
 * asi que al正常使用 el `ctx` parece que el `folder` dejo de hacer falta, y lo
 * que deja de hacer falta es la segunda mitad del subtitulo —"Peliculas · Films"—,
 * que es la que dice donde vive la lista.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTA AFUERA Y NO EN `components/menus/`
 * ------------------------------------------------------------------
 *
 * Lo mismo que dice `lib/menus/bookmark.ts`, y por el mismo motivo: la hoja unica
 * esta en `components/menus/` pero este archivo no monta nada, y lo que decide
 * donde vive un archivo es a que pertenece. Esto pertenece al registro al que
 * sirve, y el registro esta en `lib/menus/`.
 */

/** Lo que la pantalla sabe hacer con las listas, y se lo pasa al adaptador. */
export interface AccionesDeLista {
  /** El panel de inicio, para leer si esta pineada y para guardarlo. */
  layout: DashboardWidget[];
  save: (layout: DashboardWidget[]) => void | Promise<void>;
  updateList: (
    list: List,
    changes: { title?: string; icon?: IconRef | null },
  ) => void | Promise<void>;
  deleteList: (list: List) => void | Promise<void>;
  /**
   * `duplicateList` **devuelve el id de la copia** y el tipo lo declara asi, asi que
   * la firma de aqui admite ese `string` y lo descarta: el menu no usa el id —la
   * copia aparece sola en el store y el `load` del hook ya la trae—, y escribir
   * `Promise<void>` obligaria a las cuatro pantallas a envolver la llamada en una
   * funcion que no hace nada.
   */
  duplicateList: (list: List) => unknown | Promise<unknown>;
  /**
   * El editor de estados del tablero, **y solo un tablero lo pasa**.
   *
   * Es la capacidad `editStates` del registro y a la vez el handler
   * `editarEstados`: las dos mitades de la misma fila, y por eso viven juntas en
   * un solo parametro en vez de en dos. Sin el, la fila no se ofrece —que es lo
   * que el registro decide— y con el se ofrece y hay a quien ejecutarla.
   */
  editarEstados?: () => void;
  /**
   * Que se hace **despues** de borrar, y tipicamente volver atras.
   *
   * Viene en vez de un `onDeleted` de la hoja porque el registro no unifica el
   * mecanismo de borrar: cada superficie sigue usando el suyo, y el de una lista
   * es `deleteList` de `useLists`. Quien navega es el call site —es el mismo
   * reparto que hace `collection/[collectionId].tsx` con `router.back()`— y por eso
   * va en el handler y no en una prop aparte de la hoja.
   */
  onDeleted?: () => void;
}

/** Las props de `EntityMenuSheet` que salen de aca, y solo de aca. */
export interface MenuDeLista {
  ctx: MenuContext | null;
  icon: IconRef | null;
  conteo: number | undefined;
  pinned: boolean;
  subtitulo: string | undefined;
  handlers: MenuHandlers;
}

/**
 * Todo lo que el menu de una lista necesita, de una sola vez.
 *
 * Devuelve un **objeto y no varias funciones** porque las cuatro pantallas lo
 * consumen entero: si esto fueran seis funciones sueltas, cada una escribiria seis
 * llamadas en el JSX y la que se olvidara —la del conteo, la del pineo— no
 * romperia nada. Con un objeto, la pantalla nombra las seis y se lee de un vistazo
 * que no le falta ninguna.
 */
export function menuDeLista(
  list: List | null,
  opciones: AccionesDeLista & { folder: Folder | null; t: Translate },
): MenuDeLista {
  const { folder, t, layout } = opciones;
  const pinned = list ? isPinned(layout, list.id) : false;

  return {
    ctx: menuCtxDeLista(list, { editStates: opciones.editarEstados !== undefined }),
    /*
      El icono entra por props y no en el `ctx`, y es la misma razon por la que
      `MenuEntity` no lleva el conteo: el registro normaliza el nombre y nada mas,
      porque el campo de icono **no es el mismo en las cinco entidades** —una
      coleccion guarda un `emoji` que es texto plano y un enlace no tiene campo— y
      un campo que cuatro de cinco no llenan es un campo que se olvida en cuatro.
    */
    icon: list?.icon ?? null,
    /*
      `lists.deleteBody` cuenta, y sin el numero la frase queda con un `{count}`
      crudo en pantalla. `DeletePage` ya sabe que sin numero no dice nada
      (`delete-page.tsx:95`), o sea que el numero tiene que llegar **desde aca** y
      no desde el registro: es un dato de la entidad, y el registro no le pide el
      numero a nadie.
    */
    conteo: list?.itemCount,
    pinned,
    subtitulo: subtituloDeLista(list, folder, t),
    handlers: handlersDeLista(list, { ...opciones, pinned }),
  };
}

/**
 * El subtitulo de la cabecera: **el tipo de lista y la carpeta donde vive**.
 *
 * La segunda mitad es la que se pierde al migrar. `entity.title` es `list.title`,
 * asi que usar el `ctx` para el subtitulo hace creer que el `folder` dejo de
 * importar, y lo que deja de importar es justo el "· Films" que responde donde
 * esta la lista —que es la pregunta que el titulo no contesta.
 *
 * Y el separador es el mismo que usaba la hoja vieja (`list-menu-sheet.tsx:421`),
 * porque el menu nuevo es un solo archivo para las cinco entidades y el
 * separador pasa a ser de todas.
 */
function subtituloDeLista(
  list: List | null,
  folder: Folder | null,
  t: Translate,
): string | undefined {
  if (!list) return undefined;

  const tipo = t(LIST_KIND_LABEL[list.kind]);

  return folder ? `${tipo} · ${folder.name}` : tipo;
}

/**
 * El `ctx` de una lista, y **lo unico que dice que esto es una lista**.
 *
 * Las capacidades van todas puestas y no dependen de la pantalla, y eso es una
 * decision:
 *
 * - `panel`: cualquier lista se puede pinear, y las cuatro pantallas lo ofrecian.
 * - `export`: `GET /lists/:id/export` existe y la hoja vieja lo ofrecia en las
 *   cuatro. Que la fila **no salga todavia** no es de aqui: es de que la pagina
 *   `export` es de la T9, y lo filtra `puedeOfrecerse`.
 * - `editStates`: la unica que depende de quien llama, y por eso es un parametro
 *   y no una constante. La hoja vieja lo resolvia con `onEditStates ? [...] : []`,
 *   que es el mismo predicado escrito a mano que el registro vino a sustituir.
 */
function menuCtxDeLista(
  list: List | null,
  caps: { editStates: boolean },
): MenuContext | null {
  if (!list) return null;

  return {
    kind: "list",
    entity: {
      id: list.id,
      // `List` ya dice `title`, asi que la normalizacion de la lista es que no
      // hay ninguna: la hacen `Collection.name` y `Folder.name`, y una lista no
      // necesita que nadie le cambie el nombre.
      title: list.title,
      // Sin retocar: `role` y `shared` son los que deciden que borrar salga
      // grisado con su motivo y que compartir no se ofrezca a un editor.
      role: list.role,
      shared: list.shared,
    },
    caps: {
      panel: true,
      export: true,
      editStates: caps.editStates,
    },
  };
}

/**
 * Los handlers, con las escrituras que ya existen.
 *
 * Y **borrar no se unifica**: cada superficie sigue usando la suya, porque cada
 * una hace algo distinto antes de escribir. Es la misma razon que dan
 * `handlersDeColeccion` y `handlersDeBookmark`, y es decision del plan: unifying
 * eso es otro corte.
 */
function handlersDeLista(
  list: List | null,
  acciones: AccionesDeLista & { pinned: boolean },
): MenuHandlers {
  if (!list) return {};

  const { layout, save, updateList, deleteList, duplicateList, pinned } = acciones;

  return {
    rename: (titulo) => updateList(list, { title: titulo }),
    icon: (icon) => updateList(list, { icon }),
    /*
      Y `onDeleted` corre **despues** de que la escritura termino bien, no antes.
      La hoja vieja lo llamaba en el mismo toque que `deleteList`, sin esperarla, y
      con eso `router.back()` se ejecutaba aunque borrar fallara: la pantalla
      volvia y el tombstone no estaba. Aca la hoja lo envuelve con su corredor —que
      espera, avisa el fallo sin cerrar y cierra solo si va bien—, asi que volver
      atras es consecuencia de haber borrado y no un efecto secundario del toque.
    */
    borrar: async () => {
      await deleteList(list);
      acciones.onDeleted?.();
    },
    /*
      El `async` es por el mismo motivo que el `await` de borrar: `duplicateList`
      devuelve el id de la copia, y `MenuHandlers.duplicar` es `void | Promise<void>`.
      Un `async` que no devuelve nada convierte el `string` en `Promise<void>` sin
      castear nada, y sin el el compilador pediria un envoltorio en cada una de las
      cuatro pantallas para descartar un valor que el menu no usa.
    */
    duplicar: async () => {
      await duplicateList(list);
    },
    /*
      Pinear y quitar, con el mismo `alternarPin`, y el estado sale de aca:
      `isPinned(layout, id)` es **estado de pantalla** y por eso no puede ir en el
      `ctx` —meterlo seria meter en el contexto un dato de la pantalla y no de la
      entidad—. Lo que si puede es no estar escrito en cuatro pantallas, que es lo
      que este archivo evita: la regla de "en el slot `pin`, esta es `unpin`" se
      resuelve una vez, acá y en la hoja que la pinta.
    */
    alternarPin: () =>
      save(
        pinned
          ? withoutPinnedList(layout, list.id)
          : withPinnedList(layout, list),
      ),
    editarEstados: acciones.editarEstados,
  };
}
