import { describe, expect, it } from "vitest";

import { dictionaries } from "@/lib/i18n/dictionaries";
import {
  ACCIONES,
  ORDEN_POR_KIND,
  accionesPara,
} from "@/lib/menus/registry";
import type { MenuAccion, MenuContext, MenuKind } from "@/lib/menus/registry";

const KINDS: MenuKind[] = ["list", "note", "folder", "collection", "bookmark"];

/** El mismo esqueleto para todos, con lo que cambia por tipo. */
function ctx(
  kind: MenuKind,
  sobre: Partial<MenuContext["entity"]> = {},
  caps: MenuContext["caps"] = {},
): MenuContext {
  return {
    kind,
    entity: { id: "x", title: "Algo", role: "owner", shared: false, ...sobre },
    caps,
  };
}

/** `labelKey` puede ser funcion, y resolverlo es parte de lo que hay que probar. */
function clave(a: MenuAccion, c: MenuContext): string {
  return typeof a.labelKey === "function" ? a.labelKey(c) : a.labelKey;
}

function conId(c: MenuContext, id: string): MenuAccion | undefined {
  return accionesPara(c).find((a) => a.id === id);
}

describe("el registro dice que acciones existen", () => {
  it("cada kind declara su propio conjunto, y ninguno es vacio", () => {
    for (const kind of KINDS) {
      const acciones = accionesPara(ctx(kind, {}, { editStates: true, saveAsTemplate: true, createInside: true, panel: true, export: true }));
      expect(acciones.length, `${kind} se quedo sin menu`).toBeGreaterThan(0);
    }
  });

  it("lo que cada kind declara es lo que el registro dice", () => {
    for (const kind of KINDS) {
      const declarados = ORDEN_POR_KIND[kind];
      expect(declarados.length, `${kind} declara una lista vacia`).toBeGreaterThan(0);
      expect(accionesPara(ctx(kind, {}, { editStates: true, saveAsTemplate: true, createInside: true, panel: true, export: true })).map((a) => a.id)).toEqual(declarados);
    }
  });

  it("toda accion que un kind declara existe en el registro", () => {
    for (const kind of KINDS) {
      for (const id of ORDEN_POR_KIND[kind]) {
        expect(ACCIONES[id], `falta la accion "${id}" que declara ${kind}`).toBeDefined();
      }
    }
  });

  it("el orden de salida es el orden declarado", () => {
    for (const kind of KINDS) {
      const acciones = accionesPara(ctx(kind, {}, { editStates: true, saveAsTemplate: true, createInside: true, panel: true, export: true }));
      expect(acciones.map((a) => a.id)).toEqual(ORDEN_POR_KIND[kind]);
      for (let i = 1; i < acciones.length; i += 1) {
        const antes = ORDEN_POR_KIND[kind].indexOf(acciones[i - 1]!.id);
        const ahora = ORDEN_POR_KIND[kind].indexOf(acciones[i]!.id);
        expect(antes).toBeLessThan(ahora);
      }
    }
  });
});

describe("lo que no es tuyo no se ofrece", () => {
  it("borrar se apaga cuando esta compartido, y dice por que", () => {
    const compartido = ctx("list", { shared: true, role: "editor" });
    const borrar = conId(compartido, "delete")!;
    expect(borrar).toBeDefined();
    expect(borrar.disponible?.(compartido)).toBe(false);
    expect(borrar.motivo?.(compartido)).toBeTruthy();

    const propio = ctx("list", { shared: false, role: "owner" });
    expect(borrar.disponible?.(propio)).toBe(true);
  });

  it("compartir solo con el dueno, y se apaga para un viewer", () => {
    const owner = ctx("note", { role: "owner" });
    expect(conId(owner, "share")!.disponible?.(owner)).toBe(true);

    // Ojo: `conId` no lo encuentra para un kind no compartible, porque la fila
    // desaparece de la lista en vez de quedar grisada. Para un viewer de una
    // nota si existe y queda grisada, con el motivo escrito.
    const viewer = ctx("note", { role: "viewer" });
    const compartir = accionesPara(viewer).find((a) => a.id === "share");
    expect(compartir, "compartir de un viewer tiene que verse, no desaparecer").toBeDefined();
    expect(compartir!.disponible?.(viewer)).toBe(false);
    expect(compartir!.motivo?.(viewer)).toBeTruthy();
  });

  it("las acciones con capacidad no aparecen sin la capacidad", () => {
    // Cada capacidad va probada en el kind que la declara: `saveAsTemplate` es
    // de nota y `createHere` de carpeta, y probarlas sobre una lista daria verde
    // por la razon equivocada, igual que un fixture que no llega al clamp.
    for (const [id, cap, kind] of [
      ["states", "editStates", "list"],
      ["saveAsTemplate", "saveAsTemplate", "note"],
      ["createHere", "createInside", "folder"],
      ["export", "export", "list"],
    ] as const) {
      const sinNada = ctx(kind);
      const conTodo = ctx(kind, {}, { [cap]: true });
      expect(accionesPara(sinNada).map((a) => a.id), `${kind} sin ${cap}`).not.toContain(id);
      expect(accionesPara(conTodo).map((a) => a.id), `${kind} con ${cap}`).toContain(id);
    }
  });
});

describe("el icono no es la misma accion en todas partes", () => {
  it("solo donde el contrato tiene un IconRef: lista, nota y carpeta", () => {
    for (const kind of KINDS) {
      const c = ctx(kind);
      const hay = accionesPara(c).some((a) => a.id === "icon");
      const tieneIconRef = kind === "list" || kind === "note" || kind === "folder";
      expect(hay, `${kind}: el icono depende del tipo de campo que tiene`).toBe(tieneIconRef);
    }
  });

  it("compartir tampoco: hoy el contrato solo admite espacio, carpeta, lista, item y nota", () => {
    for (const kind of KINDS) {
      const c = ctx(kind);
      const hay = accionesPara(c).some((a) => a.id === "share");
      const compartible = kind === "list" || kind === "note" || kind === "folder";
      expect(hay, `${kind}: compartir depende de lo que el contrato admita`).toBe(compartible);
    }
  });
});

describe("el copy de cada accion existe, en los dos idiomas", () => {
  it("para todo kind y toda accion, la clave resuelta existe en es y en en", () => {
    for (const kind of KINDS) {
      const c = ctx(kind, {}, { editStates: true, saveAsTemplate: true, createInside: true, panel: true, export: true });
      for (const accion of accionesPara(c)) {
        const k = clave(accion, c);
        expect(dictionaries.es[k as keyof typeof dictionaries.es], `${kind}/${accion.id} falta en es`).toBeTruthy();
        expect(dictionaries.en[k as keyof typeof dictionaries.en], `${kind}/${accion.id} falta en en`).toBeTruthy();
      }
    }
  });

  it("exportar dice lo que se exporta, y no la palabra de la lista", () => {
    /*
      El guard de arriba comprueba que la clave resuelta **exista** en los dos
      diccionarios, y con `export` eso ya cubre la clave nueva: si
      `export.collection.title` no estuviera en `es` o en `en`, el recorrido de
      arriba —los cinco kinds con todas las capacidades— lo diria nombrando el kind.

      Lo que **no** cubre es que la clave sea la correcta. Y esa es la mitad de este
      bug: con `labelKey` fijo en `"export.list.title"`, la fila de una coleccion
      resolvia a una clave que existe, con frase en los dos idiomas y el test en
      verde —y decia "Exportar esta lista" en el menu de una coleccion. Una clave
      que existe no es por definition la clave de este kind, asi que hace falta el
      segundo corte.

      Y es por kind y no por accion porque `export` es la unica fila cuyo copy
      cambia con la entidad **sin** que el estado cambie: una lista siempre es una
      lista y una coleccion siempre es una coleccion. Para las demas
      —`delete`, `share`— el copy depende de `role` y `shared`, y eso ya esta
      probado mas arriba con sus propios motivos.

      Y el recorrido es sobre **los kinds que declaran la fila**, no sobre los
      cinco: preguntar el `labelKey` de `note` o de `bookmark` es preguntar por una
      fila que no existe, y `ACCIONES.export` tiene una unica funcion que no puede
      saber que kinds la ofrecen. Los que la ofrecen salen de `ORDEN_POR_KIND`, que
      es el unico lugar donde se declara —y si manana un kind nuevo declara `export`
      sin frase propia, este bucle le cae encima sin tocar nada aca—.
    */
    const conExport = KINDS.filter((kind) => ORDEN_POR_KIND[kind].includes("export"));

    expect(conExport.length, "sin kinds que exporten el guard no comprobaria nada").toBeGreaterThan(
      0,
    );

    for (const kind of conExport) {
      const resuelta = clave(ACCIONES.export!, ctx(kind, {}, { export: true }));

      expect(
        resuelta,
        `"${kind}" recibe la fila de exportar con el copy de otra entidad`,
      ).not.toBe(kind === "list" ? "export.collection.title" : "export.list.title");
    }

    // Y las dos mitades por separado, porque el ternario podria estar al reves:
    // una lista con la frase de coleccion seria un error igual de visible, y
    // `not.toBe` sobre las dos no lo distingue.
    expect(clave(ACCIONES.export!, ctx("list", {}, { export: true }))).toBe("export.list.title");
    expect(clave(ACCIONES.export!, ctx("collection", {}, { export: true }))).toBe(
      "export.collection.title",
    );
  });

  it("el cuerpo de borrar es distinto por tipo, y cada uno es el suyo", () => {
    const cuerpos = KINDS.map((kind) => {
      const c = ctx(kind);
      const borrar = conId(c, "delete")!;
      return clave(borrar, c);
    });
    expect(new Set(cuerpos).size).toBeGreaterThan(1);
    for (const cuerpo of cuerpos) {
      expect(dictionaries.es[cuerpo as keyof typeof dictionaries.es]).toBeTruthy();
    }
  });
});