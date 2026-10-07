import type { MembershipRole } from "@orbit-hub/contracts";
import { describe, expect, it } from "vitest";

import { dictionaries } from "@/lib/i18n/dictionaries";
import {
  ACCIONES,
  ORDEN_POR_KIND,
  accionesPara,
  esDuplicada,
  resuelveLabel,
} from "@/lib/menus/registry";
import type { MenuAccion, MenuCap, MenuContext, MenuKind } from "@/lib/menus/registry";

/**
 * El registro, y la lista que cada hoja dibuja.
 *
 * Esto no es un test de UI: es el unico sitio donde se puede preguntar que
 * opciones existen sin un renderer, y por eso el registro es puro. Si el test
 * puede pasar, es porque la decision vive en un dato y no en un componente.
 */

/** Todos los permisos que un call site puede dar. El contexto mas permisivo. */
const CAPS: Partial<Record<MenuCap, boolean>> = {
  editStates: true,
  saveAsTemplate: true,
  createInside: true,
  panel: true,
  export: true,
};

function ctx(
  kind: MenuKind,
  opciones: { role?: MembershipRole; shared?: boolean; caps?: Partial<Record<MenuCap, boolean>> } = {},
): MenuContext {
  return {
    kind,
    entity: {
      id: "entidad-1",
      title: "Mercadona",
      role: opciones.role ?? "owner",
      shared: opciones.shared ?? false,
    },
    caps: opciones.caps ?? {},
  };
}

function ids(ctx: MenuContext): string[] {
  return accionesPara(ctx).map((accion) => accion.id);
}

/** La accion del id, o una falla que nombra el id que falta. */
function accion(id: string): MenuAccion {
  const encontrada = ACCIONES[id];
  expect(encontrada, `ACCIONES no declara '${id}'`).toBeDefined();
  return encontrada as MenuAccion;
}

describe("el registro dice que opciones existen", () => {
  it("lista: estados, renombrar, icono, panel, duplicar, compartir, acceso, exportar y borrar", () => {
    expect(ids(ctx("list", { caps: CAPS }))).toEqual([
      "states",
      "rename",
      "icon",
      "pin",
      "duplicate",
      "share",
      "access",
      "export",
      "delete",
    ]);
  });

  it("nota: renombrar, icono, panel, compartir, plantilla, acceso y borrar", () => {
    expect(ids(ctx("note", { caps: CAPS }))).toEqual([
      "rename",
      "icon",
      "pin",
      "share",
      "saveAsTemplate",
      "access",
      "delete",
    ]);
  });

  it("carpeta: crear aqui, panel, renombrar, icono, compartir, acceso y borrar", () => {
    expect(ids(ctx("folder", { caps: CAPS }))).toEqual([
      "createHere",
      "pin",
      "rename",
      "icon",
      "share",
      "access",
      "delete",
    ]);
  });

  it("coleccion: renombrar, icono, compartir, acceso, exportar y borrar", () => {
    expect(ids(ctx("collection", { caps: CAPS }))).toEqual([
      "rename",
      "icon",
      "share",
      "access",
      "export",
      "delete",
    ]);
  });

  it("bookmark: renombrar, icono, acceso y borrar", () => {
    expect(ids(ctx("bookmark", { caps: CAPS }))).toEqual([
      "rename",
      "icon",
      "access",
      "delete",
    ]);
  });

  /*
    La capacidad es lo que hace que una opcion exista, y sin esta prueba un
    registro que las mostrara todas estaria mintiendo: una fila que el call site
    no puede atender es una fila que no hace nada al tocarla, y eso es peor que
    una fila que no esta.
  */
  it("sin capacidades, las opciones que dependen de una no se ofrecen", () => {
    expect(ids(ctx("note"))).toEqual(["rename", "icon", "share", "access", "delete"]);
    expect(ids(ctx("folder"))).toEqual(["rename", "icon", "share", "access", "delete"]);
    expect(ids(ctx("collection"))).toEqual(["rename", "icon", "share", "access", "delete"]);
    expect(ids(ctx("bookmark"))).toEqual(["rename", "icon", "access", "delete"]);
  });

  /*
    `duplicate` se queda sin capacidad apagada, y no es un olvido: `MenuCap` no
    tiene un miembro `duplicate` y no lo puede tener sin cambiar la firma que
    las nueve tareas siguientes ya importan. No hay forma de apagarlo por
    capacidad, asi que lo apaga el **orden**: solo `list` lo declara. Si manana
    hace falta apagarlo en otro kind, se agrega el miembro y aqui.
  */
  it("duplicate no tiene capacidad que lo apague: solo lo declara la lista", () => {
    expect(ACCIONES["duplicate"]?.disponible).toBeUndefined();
    expect(ids(ctx("list"))).toContain("duplicate");
    for (const kind of ["note", "folder", "collection", "bookmark"] as MenuKind[]) {
      expect(ids(ctx(kind))).not.toContain("duplicate");
    }
  });

  it("cada capacidad apaga solo la fila que depende de ella", () => {
    const sinEstados = ids(ctx("list", { caps: { ...CAPS, editStates: false } }));
    expect(sinEstados).not.toContain("states");
    expect(sinEstados).toContain("duplicate");

    const sinPanel = ids(ctx("list", { caps: { ...CAPS, panel: false } }));
    expect(sinPanel).not.toContain("pin");
    expect(sinPanel).toContain("rename");

    const sinExportar = ids(ctx("collection", { caps: { ...CAPS, export: false } }));
    expect(sinExportar).not.toContain("export");
    expect(sinExportar).toContain("access");
  });
});

/*
  Review Focus #1: una accion destructiva ofrecida a quien no es dueno.

  El fallo es silencioso y por eso importa: `role` esta escrito a mano como union
  literal en varios archivos del repo, y un `role: string` colado cuela la
  comparacion `=== "owner"` sin que nada se queje. Aqui el predicado sale del
  contrato (`MembershipRole`), asi que el compilador avisa.
*/
describe("borrar y compartir miran de quien es la cosa", () => {
  const compartida = ctx("list", { shared: true, role: "editor" });

  it("algo compartido no se puede borrar, y dice por que", () => {
    const borrar = accion("delete");
    expect(borrar.disponible?.(compartida)).toBe(false);
    const motivo = borrar.motivo?.(compartida);
    expect(typeof motivo).toBe("string");
    expect(motivo).not.toBe("");
  });

  it("lo tuyo se borra, lo compartido tambien sale en el menu y grisado", () => {
    const mia = ctx("list", { shared: false, role: "editor" });
    const borrar = accion("delete");
    expect(borrar.disponible?.(mia)).toBe(true);
    expect(borrar.motivo?.(mia)).toBeNull();
    // Sigue en la lista de filas: grisada y con el motivo, no escondida. Es la
    // unica forma que tiene una persona de descubrir que la regla existe.
    expect(ids(compartida)).toContain("delete");
    expect(accion("delete").motivo?.(compartida)).toBeTruthy();
  });

  it("solo el dueno decide quien mas lo ve", () => {
    const compartir = accion("share");
    expect(compartir.disponible?.(ctx("list", { role: "owner" }))).toBe(true);
    expect(compartir.disponible?.(ctx("list", { role: "viewer" }))).toBe(false);
    expect(compartir.disponible?.(ctx("list", { role: "editor" }))).toBe(false);
  });

  it("con dueno las dos estan encendidas", () => {
    const mio = ctx("folder", { role: "owner", shared: false });
    expect(accion("share").disponible?.(mio)).toBe(true);
    expect(accion("delete").disponible?.(mio)).toBe(true);
  });
});

describe("el orden de la salida es el del registro", () => {
  it("para cada kind, en el contexto mas permisivo, sale ORDEN_POR_KIND tal cual", () => {
    for (const kind of Object.keys(ORDEN_POR_KIND) as MenuKind[]) {
      expect(ids(ctx(kind, { caps: CAPS })), `el orden de '${kind}'`).toEqual(
        ORDEN_POR_KIND[kind],
      );
    }
  });
});

describe("el registro no se contradice a si mismo", () => {
  it("todo id que un orden nombra existe en ACCIONES", () => {
    for (const [kind, orden] of Object.entries(ORDEN_POR_KIND)) {
      for (const id of orden) {
        expect(ACCIONES[id], `ORDEN_POR_KIND['${kind}'] nombra '${id}'`).toBeDefined();
      }
    }
  });

  it("ningun kind declara una lista vacia", () => {
    for (const [kind, orden] of Object.entries(ORDEN_POR_KIND)) {
      expect(orden.length, `'${kind}' se queda sin opciones`).toBeGreaterThan(0);
    }
  });
});

/*
  Review Focus #5: el copy de una accion que no existe en el idioma.

  `labelKey` es funcion y el tipo es `TranslationKey`, asi que el compilador ya
  avisa si la clave no existe. Lo que el compilador NO puede ver es el otro
  idioma: `es` y `en` se declaran por separado y olvidar una en el segundo
  compila igual. Este es el unico sitio donde se puede preguntar por los dos.
*/
describe("cada accion tiene copy en los dos idiomas", () => {
  it("para todo kind y toda accion, la clave resuelta existe en es y en en", () => {
    const declaradas = Object.keys(ACCIONES);
    expect(declaradas.length).toBeGreaterThan(0);

    for (const kind of Object.keys(ORDEN_POR_KIND) as MenuKind[]) {
      for (const id of declaradas) {
        const clave = resuelveLabel(accion(id), ctx(kind, { caps: CAPS }));
        expect(dictionaries.es[clave], `'${clave}' (${id}/${kind}) falta en es`).toBeTruthy();
        expect(dictionaries.en[clave], `'${clave}' (${id}/${kind}) falta en en`).toBeTruthy();
      }
    }
  });

  it("las dos filas del panel son copy distinto", () => {
    const contexto = ctx("list", { caps: CAPS });
    expect(resuelveLabel(accion("pin"), contexto)).not.toBe(
      resuelveLabel(accion("unpin"), contexto),
    );
  });
});

/*
  El comparador que usan los tests de paridad de T6 y T7: "el menu nuevo tiene
  las mismas filas que el viejo". Compara por lo que se ve, no por el id, porque
  el id es interno del registro y lo que hay que preservar es la fila.
*/
describe("esDuplicada", () => {
  const contexto = ctx("list", { caps: CAPS });

  it("son la misma fila cuando coincide el copy resuelto y el icono", () => {
    expect(esDuplicada(accion("delete"), accion("delete"), contexto)).toBe(true);
  });

  it("no son la misma fila si cambia el icono", () => {
    const otra = { ...accion("delete"), icon: "bookmark-outline" } as MenuAccion;
    expect(esDuplicada(accion("delete"), otra, contexto)).toBe(false);
  });

  it("no son la misma fila si cambia el copy resuelto", () => {
    const otra = { ...accion("rename"), labelKey: "icons.title" } as MenuAccion;
    expect(esDuplicada(accion("rename"), otra, contexto)).toBe(false);
  });
});