import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ACCIONES, accionesPara } from "@/lib/menus/registry";
import type { MenuContext } from "@/lib/menus/registry";

/**
 * `EntityMenuSheet`, por fuente.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTE TEST NO MONTA NADA
 * ------------------------------------------------------------------
 *
 * Porque en este repo no hay donde: no hay `@testing-library/react-native` ni
 * `jsdom`, y `Sheet` es un `Modal` de react-native, que ni se puede importar en
 * Node sin el stub. Asi que lo que se afirma aqui es lo mecanico y lo que se
 * puede leer: que hay **una** hoja y no seis paneles hermanos, que la pagina se
 * cambia con `step` y no con hojas nuevas, que la lista de filas sale del
 * registro y no de un array escrito a mano, y que un handler que falla no cierra
 * el menu.
 *
 * Lo que no se puede comprobar aqui, y no se va a prometer: que al apretar una
 * fila aparezcan cuatro filas. Eso se mira en la pantalla.
 *
 * El patron es el de `sheet-back.test.ts`.
 */

const RAIZ = join(import.meta.dirname, "..");
const src = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");
const hay = (ruta: string) => existsSync(join(RAIZ, ruta));

const HOJA = "src/components/menus/entity-menu-sheet.tsx";
const PAGINAS = "src/components/menus/pages";
const RENOMBRAR = `${PAGINAS}/rename-page.tsx`;
const BORRAR = `${PAGINAS}/delete-page.tsx`;

const hoja = src(HOJA);

/** Cuantas `<Sheet ...>` monta un archivo. `<SheetOptions` no cuenta. */
function hojasMontadas(fuente: string): number {
  return (fuente.match(/<Sheet[\s/>]/g) ?? []).length;
}

/**
 * Los ids de `PAGINAS_MONTADAS`, leidos del fuente.
 *
 * Es una lista en el `.tsx` y no un `Record` de componentes porque lo que
 * importa poder leer sin renderizar es **cuales son**, no que se pinten: es la
 * lista de las paginas que existen hoy, y la que T3, T8 y T9 van haciendo
 * crecer.
 */
function paginasMontadas(): string[] {
  const declarada = hoja.match(/PAGINAS_MONTADAS[^=]*=\s*\[([^\]]*)\]/);
  expect(declarada, "la hoja tiene que declarar que paginas monta").not.toBeNull();
  return [...(declarada![1] ?? "").matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]!);
}

const COLECCION: MenuContext = {
  kind: "collection",
  entity: { id: "c1", title: "Recetas", role: "owner", shared: false },
  caps: {},
};

describe("una sola hoja, y con una pila de paginas adentro", () => {
  it("monta un unico Sheet", () => {
    expect(hojasMontadas(hoja), "mas de un Sheet es panel sobre panel").toBe(1);
  });

  it("la hoja de carpeta, que es lo que se esta reemplazando, monta varios", () => {
    // El contraste tiene que estar en el test, o "un solo Sheet" no dice nada:
    // es una afirmacion sobre un numero que el archivo nuevo podria cumplir por
    // tener menos contenido.
    const carpeta = src("src/components/folders/folder-menu-sheet.tsx");

    expect(hojasMontadas(carpeta)).toBeGreaterThan(1);
  });

  it("la pagina se cambia con step, y no con otra hoja", () => {
    expect(hoja).toMatch(/\bstep=\{pagina\}/);
  });

  it("el volver existe en toda pagina que no sea la primera", () => {
    // `onBack={` a secas, y **no** `onBack={undefined}`: esa version del test
    // dejo pasar una hoja a la que le habian quitado la flecha, porque
    // `onBack={undefined}` sigue siendo un `onBack={` seguido de un caracter.
    expect(/\bonBack=\{/.test(hoja)).toBe(true);
    expect(/\bonBack=\{undefined\}/.test(hoja)).toBe(false);
    expect(hoja).toMatch(/pagina === "options" \? undefined : \(\) => setPagina\("options"\)/);
  });

  it("el cuerpo no se mete en un scroll, como en la hoja de lista", () => {
    expect(hoja).toMatch(/scrollable=\{false\}/);
  });
});

describe("la fila que lleva a otro lado lo dice antes de que la toquen", () => {
  it("el galon va en las filas cuya accion es una pagina, y solo en esas", () => {
    /*
      `SheetOption.chevron` existe en la base para "esta fila lleva a otro lado"
      (`sheet.tsx:1115-1123`), y sin el "Eliminar" —la fila donde tocar PREGUNTA— se
      ve igual que "Pinear en el panel", que hace la cosa en el momento. La senal
      de seguridad tiene que estar en la fila, no en un tutorial.
    */
    expect(hoja).toMatch(/chevron: accion\.destino\.tipo === "pagina"/);
  });
});

describe("la hoja aguanta los 330 ms en que todavia se puede tocar", () => {
  /*
    `Sheet` mantiene el `Modal` montado `SALIDA + 90` despues de `visible === false`
    (`sheet.tsx:631`). Esos 330 ms son por diseno y no se tocan: durante ellos la
    hoja esta en pantalla y toma toques. Las dos reglas de abajo son sobre esa
    ventana, y las dos se rompieron a la vez.
  */

  it("los handlers se congelan con el mismo reloj que el ctx", () => {
    // `ctx` es `useLastValue(pedido)`. Si los handlers no pasan por el mismo reloj,
    // el call site ya devolvio `{}` —`handlersDeColeccion(null)`— y un toque que
    // llega tarde cae en `sinHandler()`: un "Error inesperado" en una hoja que ya
    // se esta yendo.
    expect(hoja).toMatch(/useLastValue\(abierto \? handlers : null\)/);
  });

  it("y el que se acorda es el componente, no el call site", () => {
    // Si el congelado estuviera en cada pantalla, abrir un menu nuevo en T4 a T10
    // seria una oportunidad mas de olvidarse.
    for (const pantalla of [
      "src/app/(app)/workspace/[workspaceId].tsx",
      "src/app/(app)/workspace/[workspaceId]/folder/[folderId].tsx",
    ]) {
      expect(src(pantalla), pantalla).not.toContain("useLastValue");
    }
  });
});

describe("el borrador y la pregunta de salir sin guardar son la misma verdad", () => {
  it("la hoja arma 'sucio', derivandolo del borrador", () => {
    expect(hoja).toMatch(/\{\s*setSucio\s*\}\s*=\s*useSheetSucio\(\)/);
    expect(hoja).toMatch(/setSucio\(abierto && borrador !== null/);
  });

  it("y la pagina de renombrar no lo arma", () => {
    /*
      La pagina se desmonta al tocar ← y su cleanup desarmaba la pregunta **con el
      texto escrito todavia ahi**: cerrar despues se iba sin preguntar y la
      edicion se perdia en silencio. Si la pregunta vuelve a la pagina, el bug
      vuelve con ella.

      El guard mira **la llamada**, no la palabra: la pagina explica en un comentario
      por que no la usa, y un `not.toContain("useSheetSucio")` pasaria por encima
      de esa explicacion y dejaria de comprobar justo cuando el comentario esta.
    */
    expect(src(RENOMBRAR)).not.toMatch(/\{\s*setSucio\s*\}\s*=\s*useSheetSucio\(\)/);
  });

  it("el borrador se distingue de 'nada escrito', o el menu abre sucio", () => {
    // `borrador: string` arrancaba en `""` contra un titulo no vacio, o sea
    // "sucio" en un menu que nadie habia tocado.
    expect(hoja).toMatch(/useState<string \| null>\(null\)/);
  });
});

describe("la lista de filas sale del registro y no de un array escrito a mano", () => {
  it("pregunta al registro", () => {
    expect(hoja).toContain("accionesPara(ctx)");
    expect(hoja).toContain("resuelveLabel(");
  });

  it("no reimplementa el catalogo de acciones", () => {
    /*
      Los iconos salen de `ACCIONES`, y **no de una lista escrita aca**. La
      version anterior de este test listaba once iconos a mano y se le olvidaba
      `copy-outline`, el de `duplicate`: la misma duplicacion que la tarea vino a
      matar, pero puesta en el test, y con la misma falla —un guard que no
      comprueba lo que dice comprobar—.

      Y son los iconos y no las etiquetas lo que se puede forbidding: la hoja usa
      `common.rename` y `common.delete` legitimamente en `SUBTITULO_POR_PAGINA`,
      mientras que ningun icono tiene un uso legitimo fuera del registro.
    */
    const iconos = [...new Set(Object.values(ACCIONES).map((accion) => accion.icon))];

    expect(iconos.length, "sin iconos el guard no comprobaria nada").toBeGreaterThan(5);

    for (const icono of iconos) {
      expect(hoja, `la hoja no decide el icono de "${icono}"`).not.toContain(icono);
    }
  });

  it("no ordena por su cuenta", () => {
    expect(hoja).not.toContain("ORDEN_POR_KIND");
    expect(hoja).not.toContain("ACCIONES[");
  });
});

describe("el motivo de un disabled va en description, y el disabled va con el", () => {
  it("lee disponible y motivo del descriptor, sin decidir nada", () => {
    expect(hoja).toMatch(/accion\.disponible\?\./);
    expect(hoja).toMatch(/accion\.motivo\?\./);
  });

  it("el motivo aterriza en description y no en un campo nuevo", () => {
    // `SheetOption` no tiene campo de motivo (`sheet.tsx:1098`) y esta base no
    // se toca en este trabajo, asi que el unico sitio donde cabe es
    // `description`.
    expect(hoja).toMatch(/description: motivo/);
    expect(hoja).toMatch(/disabled: /);
  });
});

describe("un handler que falla deja la hoja abierta", () => {
  it("el Guardar del paso cierra despues de await, no antes", () => {
    // El orden es la regla entera: si `onClose()` corre antes del handler, un
    // fallo se va en silencio y no hay donde mostrar el error ni el reintento.
    expect(hoja).toMatch(/await [a-zA-Z]+\(\);\s*\n\s*onClose\(\);/);
    expect(hoja).not.toMatch(/onClose\(\);\s*\n\s*(void )?await/);
  });

  it("el error se muestra en la hoja y se puede reintentar", () => {
    expect(hoja).toContain("catch");
    expect(hoja).toContain("common.retry");
  });
});

describe("las dos paginas que todo menu tiene", () => {
  it("la lista de paginas montadas y los archivos que hay son lo mismo", () => {
    // Si se declara una pagina que no existe, la fila lleva a un hueco; si existe
    // un archivo que nadie declara, la pagina esta muerta. Las dos cosas son
    // fallos de escritura y las dos se ven aca.
    const archivos = readdirSync(join(RAIZ, PAGINAS))
      .filter((nombre) => nombre.endsWith(".tsx"))
      .map((nombre) => nombre.replace(/-page\.tsx$/, ""));

    expect([...paginasMontadas()].sort()).toEqual(archivos.sort());
  });

  it("ninguna pagina monta su propia hoja", () => {
    for (const pagina of [RENOMBRAR, BORRAR]) {
      expect(hojasMontadas(src(pagina)), `${pagina} monta un Sheet`).toBe(0);
    }
  });

  it("la pagina de borrar monta el panel de acceso con lo del ctx", () => {
    const pagina = src(BORRAR);

    expect(pagina).toContain("SharedBadge");
    expect(pagina).toMatch(/shared=\{ctx\.entity\.shared\}/);
    expect(pagina).toMatch(/role=\{ctx\.entity\.role\}/);
  });

  it("la pagina de borrar dice el cuerpo del tipo, no uno solo", () => {
    const pagina = src(BORRAR);

    expect(pagina).toContain("collections.delete.body");
    expect(pagina).toContain("note.deleteBody");
    expect(pagina).toContain("bookmarks.deleteBody");
  });
});

describe("la coleccion se maneja con el menu del registro", () => {
  it("lo que la hoja vieja ofrecia, el registro lo ofrece tambien", () => {
    // Paridad minima de la migracion: `collection-menu-sheet.tsx:60-78` tenia
    // `rename` y `delete`, y eso son las dos filas que tienen que seguir
    // saliendo. `access` y `export` no salen todavia porque sus paginas no
    // existen, y eso lo comprueba el test de abajo.
    const ids = accionesPara(COLECCION).map((accion) => accion.id);

    expect(ids).toContain("rename");
    expect(ids).toContain("delete");
  });

  it("la fila de acceso esta pendiente y con nombre, no perdida", () => {
    /*
      ------------------------------------------------------------------
      EL HUECO ENTRE T2 Y T8, POR QUE ESTA ESCRITO Y NO OCULTO
      ------------------------------------------------------------------

      `ORDEN_POR_KIND.collection` declara `access` ("quien mas lo tiene") desde
      la T1, y `EntityMenuSheet` **la filtra**: la hoja no la puede montar
      todavia porque `AccessPage` es de la T8, y una fila que al tocarse no abre
      nada es peor que una fila que no esta —lo dice el propio `registry.tsx` al
      explicar `disponible` sin `motivo`—.

      O sea que entre la T2 y la T8 el menu de una coleccion tiene **menos** de lo
      que el registro dice, y eso es una perdida. Se escribe aca para que sea una
      decision y no un olvido, y el nombre es el de la tarea que la cierra.

      `export` no aparece en la lista porque es una capacidad: sin `caps.export`
      la fila ni se ofrece, y el endpoint llega en la T9.
    */
    const montadas = paginasMontadas();
    const sinMontar = accionesPara(COLECCION)
      .flatMap((accion) => (accion.destino.tipo === "pagina" ? [accion.destino.page] : []))
      .filter((page) => !montadas.includes(page));

    // El conjunto de pendientes declarados, con la tarea que cierra cada hueco.
    const PENDIENTES: Record<string, string> = {
      access: "T8: AccessPage, con SharedBadge y useShareReach",
    };

    for (const page of sinMontar) {
      expect(
        PENDIENTES[page],
        `la pagina "${page}" no se monta y no hay nadie anotado para escribirla`,
      ).toBeTruthy();
    }

    // Y hoy el hueco es exactamente ese, no un subconjunto: cuando la T8 monte la
    // suya, esta linea hay que borrarla y el conjunto tiene que quedar vacio.
    expect(sinMontar).toEqual(["access"]);
  });

  it("la hoja vieja de coleccion no existe mas", () => {
    // Si queda, hay dos menus de coleccion y el que gana es el que se importa
    // ultimo.
    expect(hay("src/components/collections/collection-menu-sheet.tsx")).toBe(false);
  });

  it("los dos call sites usan el menu del registro", () => {
    const pantallas = [
      "src/app/(app)/workspace/[workspaceId].tsx",
      "src/app/(app)/workspace/[workspaceId]/folder/[folderId].tsx",
    ];

    for (const pantalla of pantallas) {
      const fuente = src(pantalla);

      expect(fuente, pantalla).toContain("EntityMenuSheet");
      expect(fuente, pantalla).not.toContain("CollectionMenuSheet");
    }
  });

  it("los call sites pasan el contexto y los handlers, no la entidad entera", () => {
    // `CollectionMenuSheet` recibia `collection` y era el componente que llamaba
    // a las acciones. Ahora el menu no sabe que existe `lib/collections/actions`:
    // lo que recibe es el `ctx` y los handlers, y quien los arma es
    // `components/menus/coleccion.ts`, que las dos pantallas comparten.
    for (const pantalla of [
      "src/app/(app)/workspace/[workspaceId].tsx",
      "src/app/(app)/workspace/[workspaceId]/folder/[folderId].tsx",
    ]) {
      const fuente = src(pantalla);

      expect(fuente, pantalla).toContain("menuCtxDeColeccion(collectionFor)");
      expect(fuente, pantalla).toContain("handlersDeColeccion(collectionFor)");
    }
  });

  it("la normalizacion de la coleccion vive en un archivo y no en dos pantallas", () => {
    const adaptador = src("src/components/menus/coleccion.ts");

    expect(adaptador).toContain('kind: "collection"');
    expect(adaptador).toContain("title: collection.name");
    expect(adaptador).toContain("deleteCollectionAction");
    expect(adaptador).toContain("updateCollectionAction");

    // Y ninguna de las dos pantallas escribe `kind:` por su cuenta: si aparece
    // alla, la normalizacion se duplico.
    for (const pantalla of [
      "src/app/(app)/workspace/[workspaceId].tsx",
      "src/app/(app)/workspace/[workspaceId]/folder/[folderId].tsx",
    ]) {
      expect(src(pantalla), pantalla).not.toMatch(/kind: "collection"/);
    }
  });
});
