import type { Note } from "@orbit-hub/contracts";

import { saveNoteAction } from "@/lib/notes/actions";
import type { MenuContext } from "@/lib/menus/registry";

import type { MenuHandlers } from "@/components/menus/entity-menu-sheet";

/**
 * Lo que una nota necesita para entrar al menu del registro, y **en un solo
 * archivo** porque lo necesitan dos pantallas.
 *
 * ------------------------------------------------------------------
 * POR QUE UN SOLO OBJETO Y NO DOS FUNCIONES
 * ------------------------------------------------------------------
 *
 * Porque la nota necesita **tres** cosas de la hoja —el `ctx`, el icono y los
 * handlers— y `lib/menus/lista.ts` ya resolvio este mismo problema del otro
 * lado: si fueran tres funciones sueltas, cada pantalla escribiria tres llamadas
 * en el JSX y la que se olvidara —la del icono, que es opcional y no se nota
 * hasta que el menu no deja cambiar el dibujo— no romperia nada. Con un objeto,
 * la pantalla nombra las tres y se lee de un vistazo que no le falta ninguna.
 *
 * `lib/menus/coleccion.ts` y `lib/menus/bookmark.ts` si devuelven dos funciones
 * porque son dos cosas, y las dos son obligatorias.
 *
 * ------------------------------------------------------------------
 * Y POR QUE ESTE ARCHIVO ESTA ACA Y NO EN `components/notes/`
 * ------------------------------------------------------------------
 *
 * Lo mismo que dice `lib/menus/bookmark.ts`, y por el mismo motivo: la hoja
 * unica esta en `components/menus/`, pero este archivo no monta nada —es
 * normalizacion y mecanica— y lo que decide donde vive un archivo es a que
 * pertenece. Esto pertenece al registro al que sirve, y el registro esta en
 * `lib/menus/`.
 */

/** Lo que la pantalla sabe hacer con una nota, y se lo pasa al adaptador. */
export interface AccionesDeNota {
  /**
   * Guardar la nota como plantilla, y **la razon por la que la fila existe**.
   *
   * Es lo mismo que `AccionesDeLista.editarEstados` para la fila de estados: la
   * capacidad y el handler son las dos mitades de la misma fila, y por eso salen
   * del mismo parametro en vez de en dos. Sin el, la fila no se ofrece —que lo
   * decide el registro—; con el, se ofrece y hay a quien ejecutarla.
   */
  onSaveAsTemplate?: (note: Note) => void;
}

/** Las props de `EntityMenuSheet` que salen de aca, y solo de aca. */
export interface MenuDeNota {
  ctx: MenuContext | null;
  icon: Note["icon"] | null;
  handlers: MenuHandlers;
}

/**
 * Todo lo que el menu de una nota necesita, de una sola vez.
 *
 * ------------------------------------------------------------------
 * POR QUE EL TITULO VA CRUDO Y NO CON EL "SIN TITULO" DE PANTALLA
 * ------------------------------------------------------------------
 *
 * Porque `entity.title` no es solo lo que dice la cabecera: es tambien contra lo
 * que `RenamePage` compara el borrador para armar "sucio", y es lo que el
 * `Guardar` escribe. Con `title: note.title || t("note.untitled")` una nota sin
 * nombre abriria el renombrar con la frase "Sin titulo" **ya escrita en el
 * campo**, y apretar Guardar sin tocar nada guardaria esa frase como nombre.
 *
 * O sea que el arreglo de la cabecera rompia la escritura. Un titulo vacio es
 * el unico caso en que la cabecera sale en blanco, y sale en blanco a cambio de
 * que escribir ahi signifique escribir.
 *
 * Las otras tres pantallas que pintan el nombre de una nota en una fila si lo
 * reservan con `note.title.length > 0`, y eso sigue siendo verdad: es la fila
 * la que necesita un texto que quepa en una linea, no el menu.
 */
export function menuDeNota(note: Note | null, acciones: AccionesDeNota): MenuDeNota {
  return {
    ctx: menuCtxDeNota(note, { saveAsTemplate: acciones.onSaveAsTemplate !== undefined }),
    /*
      El icono entra por props y no en el `ctx`, y es la misma razon por la que
      `MenuEntity` no lleva el conteo ni el pineo: el registro normaliza el
      nombre y nada mas, porque el campo de icono **no es el mismo en las cinco
      entidades** —una coleccion guarda un `emoji` de texto plano y un enlace no
      tiene campo— y un campo que cuatro de cinco no llenan es un campo que se
      olvida en cuatro.
    */
    icon: note?.icon ?? null,
    handlers: handlersDeNota(note, acciones),
  };
}

/**
 * El `ctx` de una nota, y **lo unico que dice que esto es una nota**.
 *
 * Sin `panel`: una nota **no se pinea al panel**. El registro no lo declara en
 * `ORDEN_POR_KIND.note` —esta hoja era la que tambien lo decia, en un comentario
 * sobre porque una nota es una pagina de escritura y una tarjeta del panel es
 * una cosa con un numero encima—, asi que la fila no existe para este kind y no
 * hay capacidad que poner.
 */
function menuCtxDeNota(
  note: Note | null,
  caps: { saveAsTemplate: boolean },
): MenuContext | null {
  if (!note) return null;

  return {
    kind: "note",
    entity: {
      id: note.id,
      // `Note` ya dice `title`, asi que la normalizacion de la nota es que no hay
      // ninguna: la hacen `Collection.name` y `Folder.name`.
      title: note.title,
      // Sin retocar: `role` y `shared` son los que deciden que borrar salga
      // grisado con su motivo y que compartir no se ofrezca a un editor.
      role: note.role,
      shared: note.shared,
    },
    caps: {
      saveAsTemplate: caps.saveAsTemplate,
    },
  };
}

/**
 * Los handlers, con las escrituras que ya existen.
 *
 * ------------------------------------------------------------------
 * `onDeleted` Y `onChanged` DE LA HOJA VIEJA: DONDE ESTAN
 * ------------------------------------------------------------------
 *
 * Los props de la hoja vieja eran `{ note, onClose, onSaveAsTemplate?,
 * onDeleted?, onChanged? }`, y **las dos pantallas que la montaban pasaban solo
 * `onSaveAsTemplate`**: `onDeleted` y `onChanged` no los paso nadie, nunca, en
 * ningun commit. O sea que no son una capacidad que este archivo pierda al
 * migrar: son dos props sin un solo lector.
 *
 * Lo que si hacia `onChanged` —avisar que la nota cambio despues de renombrar o
 * de cambiar el icono— no lo hace nadie porque no hace falta: `saveNoteAction`
 * escribe en la cache local y las pantallas leen de ahi, asi que el cambio se ve
 * sin que nadie lo anuncie.
 *
 * ------------------------------------------------------------------
 * Y `borrar` SIGUE IMPORTANDO EL MODULO DINAMICAMENTE
 * ------------------------------------------------------------------
 *
 * Porque asi estaba en la hoja vieja (`await import("@/lib/notes/actions")`) y
 * el registro no cambia eso. Se escribe el import dinamico a proposito y no por
 * costumbre: la razon de que la fila de borrar no lo trajera arriba es que borrar
 * es lo unico que no se puede deshacer, asi que el codigo de esa escritura no
 * tiene por que estar cargado en una pantalla que nadie va a borrar nada.
 */
function handlersDeNota(note: Note | null, acciones: AccionesDeNota): MenuHandlers {
  if (!note) return {};

  const { onSaveAsTemplate } = acciones;

  return {
    rename: (titulo) => saveNoteAction(note.id, { title: titulo }),
    icon: (icon) => saveNoteAction(note.id, { icon }),
    /*
      El `await` del import es lo que hace que `borrar` sea una promesa y no un
      `void`, y `MenuHandlers.borrar` ya declara `void | Promise<void>`: la hoja
      lo envuelve con su corredor, que espera, avisa el fallo sin cerrar y cierra
      solo si va bien. Por eso aca no hay try/catch —la regla de error es una y
      vive en un solo sitio, que es donde vive el reintentar—.
    */
    borrar: async () => {
      const { deleteNoteAction } = await import("@/lib/notes/actions");
      await deleteNoteAction(note.id);
    },
    /*
      Sin argumento: `MenuHandlers.guardarComoPlantilla` no recibe la nota, asi
      que el adaptador la cierra. Es la diferencia entre "el registro guarde
      comportamiento" —que es lo que este trabajo vino a evitar— y "el registro
      diga que acciones existen": la nota es del call site, y el call site es el
      que sabe que plantilla se abre y con que documento.
    */
    guardarComoPlantilla: onSaveAsTemplate
      ? () => {
          onSaveAsTemplate(note);
        }
      : undefined,
  };
}