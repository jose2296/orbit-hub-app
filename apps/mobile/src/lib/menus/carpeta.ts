import type { DashboardWidget, Folder, IconRef } from "@orbit-hub/contracts";

import {
  isFolderPinned,
  withPinnedFolder,
  withoutPinnedFolder,
} from "@/lib/dashboard/pin";
import type { Translate } from "@/lib/i18n";
import type { MenuContext } from "@/lib/menus/registry";

import type { MenuHandlers } from "@/components/menus/entity-menu-sheet";

/**
 * Lo que una carpeta necesita para entrar al menu del registro, y **en un solo
 * archivo** porque sus filas las caminaba una hoja entera.
 *
 * ------------------------------------------------------------------
 * POR QUE UNA CARPETA TIENE MAS DE `rename` Y `delete`
 * ------------------------------------------------------------------
 *
 * Porque una carpeta es un lugar y no un registro de nada, asi que tiene menos
 * acciones que una lista: se renombra, se le pone un dibujo, se le pone una lista
 * dentro, se pinea al panel, se comparte y se va. No se duplica, porque una copia
 * de un lugar es otro lugar vacio y nadie la ha pedido jamas.
 *
 * Lo de "poner una lista dentro" esta aca porque **la hoja vieja lo ofrecia de
 * verdad**: abria una hoja hermana con los tipos de `LIST_KIND_ORDER` y llamaba a
 * `onCreateInside(kind)`. O sea que la fila existe en el modelo y **todavia no se
 * pinte**: `ACCIONES.createHere` la declara, `ORDEN_POR_KIND.folder` la lista, y lo
 * que la saca es `puedeOfrecerse`, porque la pagina `create` no esta escrita. Eso
 * esta escrito con nombre en `test/note-folder-menu-parity.test.ts`, porque
 * "una fila que todavia no se escribio" y "una fila que se perdio" se ven igual
 * desde el menu.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO NORMALIZA Y NO LO HACE LA PANTALLA
 * ------------------------------------------------------------------
 *
 * Porque el prop de la hoja vieja era un **tipo estructural escrito a mano** —
 * `{ id, name, parentId, version, icon?, role, shared }`— que no es el `Folder`
 * del contrato sino una copia recortada suyo. Y una copia de un contrato es una
 * regla mas que alguien tiene que mantener: el dia que `folderSchema` gane un
 * campo, la copia no lo gana y el menu sigue compilando.
 *
 * Asi que lo que entra aca es el `Folder` del contrato, y la unica normalizacion
 * —`Folder.name` a `MenuEntity.title`, que es lo que el registro ordena y
 * compara— se hace una vez. Es la misma regla que `menuCtxDeColeccion`; lo unico
 * que cambia es que el campo se llama distinto, que es justo lo que hace falta un
 * archivo.
 *
 * ------------------------------------------------------------------
 * Y POR QUE LAS SEIS PROPS SALEN DE UN OBJETO
 * ------------------------------------------------------------------
 *
 * Lo mismo que `lib/menus/lista.ts`: son seis cosas que una pantalla nombra, y si
 * fueran seis funciones sueltas cada una escribiria seis llamadas en el JSX y la
 * que se olvidara —el pineo, que es opcional y no se nota hasta que el menu ofrece
 * quitar algo que no esta ahi— no romperia nada.
 */

/** Lo que la pantalla sabe hacer con una carpeta, y se lo pasa al adaptador. */
export interface AccionesDeCarpeta {
  /** El panel de inicio, para leer si esta pineada y para guardarlo. */
  layout: DashboardWidget[];
  save: (layout: DashboardWidget[]) => void | Promise<void>;
  updateFolder: (
    folder: { id: string },
    changes: { name?: string; icon?: IconRef | null },
  ) => void | Promise<void>;
  deleteFolder: (folder: {
    id: string;
    parentId: string | null;
    version: number;
  }) => void | Promise<void>;
  /**
   * Cuantas listas tiene adentro, y **solo para el subtitulo**.
   *
   * Va aca y no en la pantalla porque `MenuEntity` no puede llevarlo —el registro
   * no le pide el numero a nadie, es un dato de la entidad y no una decision de
   * menu— y porque la regla de cuando se dice es la del diccionario. Es el mismo
   * caso que el `conteo` de una lista, que tambien viaja por props.
   */
  listCount: number;
  t: Translate;
}

/** Las props de `EntityMenuSheet` que salen de aca, y solo de aca. */
export interface MenuDeCarpeta {
  ctx: MenuContext | null;
  icon: IconRef | null;
  pinned: boolean;
  subtitulo: string | undefined;
  handlers: MenuHandlers;
}

/**
 * Todo lo que el menu de una carpeta necesita, de una sola vez.
 */
export function menuDeCarpeta(
  folder: Folder | null,
  acciones: AccionesDeCarpeta,
): MenuDeCarpeta {
  const pinned = folder ? isFolderPinned(acciones.layout, folder.id) : false;

  return {
    ctx: menuCtxDeCarpeta(folder),
    // Por props y no en el `ctx`, la misma razon que en la lista y que en la nota:
    // el registro normaliza el nombre y nada mas.
    icon: folder?.icon ?? null,
    /*
      El pineo sale de aca y no de la pantalla, con la misma razon que en
      `lista.ts`: `isFolderPinned(layout, id)` es **estado de pantalla** y no puede
      ir en el `ctx` —meterlo seria meter en el contexto un dato que no es de la
      entidad—. Lo que si puede es no estar escrito en dos sitios, que es lo que
      evita este archivo.
    */
    pinned,
    subtitulo: subtituloDeCarpeta(folder, acciones),
    handlers: handlersDeCarpeta(folder, { ...acciones, pinned }),
  };
}

/**
 * El subtitulo de la cabecera: **cuantas listas tiene adentro**.
 *
 * `entity.title` es `folder.name`, asi que el nombre ya esta; lo que la cabecera
 * no dice sola es que una carpeta es un lugar con cosas dentro, y ese numero es la
 * mitad de la frase. La hoja vieja lo decia (`folders.whatItHolds`) y sin el el
 * menu nuevo perdia la linea.
 */
function subtituloDeCarpeta(
  folder: Folder | null,
  acciones: { listCount: number; t: Translate },
): string | undefined {
  if (!folder) return undefined;

  return acciones.t("folders.whatItHolds", { count: acciones.listCount });
}

/**
 * El `ctx` de una carpeta, y **lo unico que dice que esto es una carpeta**.
 *
 * Las dos capacidades van siempre puestas y no dependen de la pantalla, y esa es
 * una decision:
 *
 * - `panel`: una carpeta se puede pinear, y la hoja vieja lo ofrecia siempre que
 *   el call site le hubiera pasado `onTogglePin`. Lo que cambia aca es que la fila
 *   existe para el kind —`ORDEN_POR_KIND.folder` la declara— y es la capacidad la
 *   que decide si se ofrece. Hoy solo llama una pantalla y siempre lo ofrece.
 * - `createInside`: la hoja vieja **no** lo condicionaba, porque `onCreateInside`
 *   era un prop obligatorio. Ponerlo en `false` seria mentir: esa pantalla si sabe
 *   crear una lista adentro, y el filtro que saca la fila no es de capacidad sino
 *   de pagina montada.
 */
function menuCtxDeCarpeta(folder: Folder | null): MenuContext | null {
  if (!folder) return null;

  return {
    kind: "folder",
    entity: {
      id: folder.id,
      // La **unica** normalizacion que hace el registro, y se hace aca: `Folder`
      // dice `name` y `MenuEntity` dice `title`. Es la misma cosa con dos nombres,
      // y el registro ordena y compara sobre `title`.
      title: folder.name,
      // Sin retocar: `role` y `shared` son los que deciden que borrar salga
      // grisado con su motivo y que compartir no se ofrezca a un editor.
      role: folder.role,
      shared: folder.shared,
    },
    caps: {
      panel: true,
      createInside: true,
    },
  };
}

/**
 * Los handlers, con las escrituras que ya existen.
 *
 * Y **borrar no se unifica**: cada superficie sigue usando la suya, porque cada
 * una hace algo distinto antes de escribir —`deleteFolder` mueve las listas de
 * adentro hacia el espacio antes de mandar el tombstone— y unificar eso es otro
 * corte. Es la misma razon que dan `handlersDeColeccion` y `handlersDeBookmark`.
 */
function handlersDeCarpeta(
  folder: Folder | null,
  acciones: AccionesDeCarpeta & { pinned: boolean },
): MenuHandlers {
  if (!folder) return {};

  const { layout, save, updateFolder, deleteFolder, pinned } = acciones;

  return {
    rename: (nombre) => updateFolder(folder, { name: nombre }),
    icon: (icon) => updateFolder(folder, { icon }),
    /*
      Lo que hay adentro **no** se borra con ella, y no es una cortesia: las listas
      de una carpeta son el trabajo, y perder una carpeta porque estaba en el sitio
      equivocado tiraria todo lo que tenia dentro. Suben al espacio, que es donde
      habrian quedado si la carpeta nunca hubiera existido. La regla esta entera en
      `useFolders.deleteFolder`.
    */
    borrar: () => deleteFolder(folder),
    /*
      Pinear y quitar con el mismo `alternarPin`, y el estado sale de aca:
      `isFolderPinned` ya se leyo arriba para el `pinned` que viaja por props, asi
      que la fila que dice "Quitar del panel" y la que lo hace son la misma
      decision leida una vez.
    */
    alternarPin: () =>
      save(pinned ? withoutPinnedFolder(layout, folder.id) : withPinnedFolder(layout, folder)),
  };
}