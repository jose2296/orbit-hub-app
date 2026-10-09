import { describe, expect, it } from "vitest";

import { shareNodeTypeSchema } from "@orbit-hub/contracts";

import { dictionaries } from "@/lib/i18n/dictionaries";
import {
  ACCIONES,
  ORDEN_POR_KIND,
  accionesPara,
} from "@/lib/menus/registry";
import type { MenuAccion, MenuContext, MenuKind } from "@/lib/menus/registry";

/*
  Los cinco kinds, **del registro y no de una lista escrita aca**.

  `["list", "note", "folder", "collection", "bookmark"]` estaba aqui y en el tipo
  `MenuKind`, o sea dos copias mas de lo mismo. `ORDEN_POR_KIND` es un `Record` sobre
  todos los kinds, asi que sus claves **son** los kinds: leerlos de ahi no puede
  quedarse viejo, que es lo que le pasa a una constante.

  Y sale ordenado porque el `Record` del fuente lo esta y el orden hace legible el
  fallo: un guard que recorre `KINDS` en orden alfabetico dice "collection" antes que
  "folder" sin que nadie lo note.
*/
const KINDS: MenuKind[] = (Object.keys(ORDEN_POR_KIND) as MenuKind[]).sort();

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

  it("compartir: la fila depende del contrato, no de una lista escrita aca", () => {
    /*
      Este guard tiene dos mitades y **las dos** se derivan del enum, que es la parte
      que no existed antes.

      La de arriba —"donde hay `IconRef`"— se deriva de `CON_ICON_REF`, una lista
      escrita a mano, porque no hay forma de preguntarle a los contratos "que campos
      tiene cada schema" en tiempo de compilacion. Y la razon de que sea aceptable es
      que la lista esta **al lado** de la accion que la usa, en el archivo de la
      accion: hay un solo lugar donde se puede desincronizar del codigo que la usa, y
      el typecheck obliga a que el `Record` siga cuadrando.

      Compartir era lo contrario: la lista estaba en `registry.tsx`, el enum esta en
      el paquete, y nadie los comparaba. Asi que esta prueba **no puede decir "son estos
      tres"** —eso seria una copia mas—: dice "los que el contrato admita", y el
      contrato se lee de `shareNodeTypeSchema`.
    */
    for (const kind of KINDS) {
      const c = ctx(kind);
      const hay = accionesPara(c).some((a) => a.id === "share");
      const admitido = shareNodeTypeSchema.options.includes(kind);

      expect(
        hay,
        `${kind}: el contrato ${admitido ? "lo admite y la fila no esta" : "no lo admite y hay fila"}`,
      ).toBe(admitido);
    }
  });

  it("y los cinco la reciben, que es lo que la T10 abre", () => {
    // El otro lado, en el sentido positivo: sin esta, "todos los que el contrato
    // admite" podria ser un conjunto vacio y el guard de arriba pasaria.
    for (const kind of KINDS) {
      expect(accionesPara(ctx(kind)).map((a) => a.id), kind).toContain("share");
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
