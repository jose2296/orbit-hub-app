import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { Bookmark } from "@orbit-hub/contracts";

import { ACCIONES, ORDEN_POR_KIND, accionesPara } from "@/lib/menus/registry";
import { SPACING } from "@/theme/tokens";

import { RAIZ, paginasMontadas, sinComentarios, src } from "./menus-test-helpers";

/*
  ------------------------------------------------------------------
  POR QUE EL MOCK ESTA ACA Y NO DENTRO DE UN `describe`
  ------------------------------------------------------------------

  Porque `vi.mock` se sube al principio del archivo y no se puede bajar: los
  guards de fuente no necesitan nada, pero `lib/menus/bookmark` importa
  `@/lib/bookmarks/actions`, que llega a `expo-sqlite` por `@/lib/offline`. Sin el
  mock, importar el modulo de normalizacion —que es puro y no pinta nada— seria
  importar la base de datos.
*/

vi.mock("@/lib/bookmarks/actions", () => ({
  deleteBookmarkAction: vi.fn(),
  updateBookmarkAction: vi.fn(),
}));

import * as acciones from "@/lib/bookmarks/actions";
import { handlersDeBookmark, menuCtxDeBookmark } from "@/lib/menus/bookmark";

const LISTA = "src/app/(app)/bookmarks.tsx";
const INBOX = "src/app/(app)/unclassified.tsx";
const HOJA_VIEJA = "src/components/bookmarks/delete-sheet.tsx";
const BOTON = "src/components/ui/menu-button.tsx";
const LIB = "src/lib/menus/bookmark.ts";

/** Las dos pantallas del enlace, con el nombre que usan los mensajes del fallo. */
const PANTALLAS = [
  ["la lista de enlaces", LISTA],
  ["el inbox", INBOX],
] as const;

/** Los `.test.ts` del paquete, para el guard que busca quien mira un `testID`. */
const TESTS = readdirSync(join(RAIZ, "test"))
  .filter((nombre) => nombre.endsWith(".test.ts"))
  .map((nombre) => src(`test/${nombre}`))
  .join("\n");

const BASE: Bookmark = {
  id: "b1",
  version: 7,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-03-04T10:00:00.000Z",
  workspaceId: "w1",
  folderId: null,
  collectionId: null,
  url: "https://ejemplo.test/salsa",
  title: "Salsa brava",
  siteName: null,
  description: null,
  imageUrl: null,
  document: "",
  plainText: "",
  extractionState: "ready",
  extractionError: null,
  tags: [],
  position: 0,
  role: "editor",
  shared: false,
  deletedAt: null,
};

/**
 * El menu de fila de un enlace, y las dos pantallas que lo abren.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO EXISTE Y NO SON DOS ACTUALIZACIONES SUELTAS
 * ------------------------------------------------------------------
 *
 * Porque `bookmarks-list.test.ts` y `bookmarks-inbox.test.ts` afirmando cada uno
 * por su cuenta que la pantalla "abre la hoja compartida" no dice nada de la
 * tercera pantalla que se agregue manana. Y porque las dos nombraban la papelera
 * —`BookmarkDeleteSheet`—, y ese nombre se va con la hoja: un guard que nombra
 * lo que desaparece tiene que acompanar a lo que aparece, porque las dos cosas
 * son el mismo hecho.
 *
 * ------------------------------------------------------------------
 * POR QUE LA MITAD ES DE FUENTE Y LA OTRA MITAD ES PURA
 * ------------------------------------------------------------------
 *
 * La parte de fuente es lo que no se puede ejecutar: que la fila monte un
 * `MenuButton`, que la hoja sea la del registro y que ninguna de las dos se
 * escriba la lista de acciones a mano. La parte pura es lo que **si** se puede:
 * `menuCtxDeBookmark` y `handlersDeBookmark` no dependen de React, asi que se
 * importan de verdad y se afirma sobre el resultado. Y lo que no se puede
 * comprobar en ninguno de los dos casos —que al apretar aparezcan dos filas— se
 * mira en la pantalla: no se promete aca lo que nadie prueba.
 *
 * ------------------------------------------------------------------
 * LO QUE ESTE ARCHIVO NO REAFIRMA
 * ------------------------------------------------------------------
 *
 * La caja relativa que `MenuButton` exige ya la deriva `icon-page.test.ts` de
 * todos los archivos que lo montan, y esa derivacion se entera sola de que estas
 * dos pantallas lo montan. Repetirlo aca seria una segunda copia de un guard que
 * ya se entera solo, y dos copias son las que se desincronizan.
 */

describe("las dos pantallas abren el menu del registro y no una hoja propia", () => {
  for (const [nombre, ruta] of PANTALLAS) {
    const pantalla = src(ruta);

    it(`${nombre} monta la hoja unica con el boton compartido`, () => {
      expect(pantalla, nombre).toMatch(
        /import \{ EntityMenuSheet \} from "@\/components\/menus\/entity-menu-sheet"/,
      );
      // El boton sale del archivo que lo declaro y no de una copia local: dos
      // copias del boton son dos areas tactiles distintas, y la que se copia es
      // la que pierde el `hitSlop` sin que nadie lo note.
      expect(pantalla, nombre).toMatch(
        /import \{ MenuButton \} from "@\/components\/ui\/menu-button"/,
      );
      expect(pantalla, nombre).toMatch(/<MenuButton\b/);
      expect(pantalla, nombre).toMatch(/<EntityMenuSheet\b/);
    });

    it(`${nombre} no declara sus propias acciones`, () => {
      // Sin comentarios: las dos pantallas explican en su prosa por que se fue
      // la papelera, y un `not.toContain` que se encuentra con su propia prosa
      // estalla. Lo que se afirma es que el codigo no los usa.
      const codigo = sinComentarios(pantalla);

      // El registro decide que filas se ofrecen. Una pantalla que escriba la
      // lista —o que monte su propia confirmacion— es una segunda copia de la
      // decision, y es justo la que este trabajo vino a borrar.
      expect(codigo, nombre).not.toContain("trash-outline");
      expect(codigo, nombre).not.toContain("BookmarkDeleteSheet");
      // Y la escritura no se pide desde la pantalla: pasa por los handlers, que
      // son los que saben que borrar es local-first.
      expect(codigo, nombre).not.toContain("deleteBookmarkAction");
      expect(codigo, nombre).not.toContain("updateBookmarkAction");
      expect(codigo, nombre).toMatch(/menuCtxDeBookmark/);
      expect(codigo, nombre).toMatch(/handlersDeBookmark/);
    });
  }
});

describe("la confirmacion de borrado se disolvio en la pagina del menu", () => {
  it("el archivo viejo no esta", () => {
    // `DeletePage` ya confirmaba y ya corre `handlers.borrar`, que es lo mismo
    // que hacia `BookmarkDeleteSheet`. Que el archivo se vaya es lo que impide
    // que las dos copias de "confirmar antes de borrar un enlace" vuelvan a
    // derivar la una de la otra.
    expect(existsSync(join(RAIZ, HOJA_VIEJA)), `${HOJA_VIEJA} deberia haberse ido`).toBe(
      false,
    );
  });

  it("la hoja del registro monta la pagina que la reemplaza", () => {
    // Y no cualquier pagina: la de borrar, que es la que declara
    // `bookmarks.deleteBody` para este kind.
    expect(paginasMontadas()).toContain("delete");
  });
});

describe("el ctx de un enlace sale del contrato, normalizado una sola vez", () => {
  it("sin enlace no hay menu, y sin menu no hay handlers", () => {
    // La hoja congela los handlers con `useLastValue` y lo que espera del
    // llamador cuando el menu se cierra es `{}`: con `undefined` o con un objeto
    // a medio construir, un toque que llega durante la salida cae en
    // `sinHandler`.
    expect(menuCtxDeBookmark(null)).toBeNull();
    expect(handlersDeBookmark(null)).toEqual({});
  });

  it("el nombre del menu es el titulo del enlace", () => {
    expect(menuCtxDeBookmark(BASE)?.entity.title).toBe("Salsa brava");
  });

  it("y cuando el titulo esta vacio, dice host o url en vez de nada", () => {
    // `bookmark.title` puede ser `""` —el servidor todavia no extrajo la
    // pagina—, y de ahi salen la cabecera de la hoja y el campo de la pagina de
    // renombrar. Un `""` deja el menu sin nombre y apaga el boton de guardar
    // sin que nadie entienda por que.
    // El host primero porque dice mas que una fila muda, y la URL cruda al
    // final porque es lo unico que queda cuando la URL ni siquiera tiene host.
    expect(menuCtxDeBookmark({ ...BASE, title: "" })?.entity.title).toBe("ejemplo.test");
    expect(
      menuCtxDeBookmark({ ...BASE, title: "", url: "no-es-una-url" })?.entity.title,
    ).toBe("no-es-una-url");
  });

  it("el id, el rol y el compartido vienen del contrato, sin traducir", () => {
    // `role` y `shared` son lo que decide si borrar sale grisado con su motivo:
    // la Review Focus #1. Que este call site los pase sin retocar es lo que hace
    // que esa regla no dependa de que la pantalla se acuerde.
    const ctx = menuCtxDeBookmark({ ...BASE, role: "viewer", shared: true });

    expect(ctx?.kind).toBe("bookmark");
    expect(ctx?.entity.id).toBe("b1");
    expect(ctx?.entity.role).toBe("viewer");
    expect(ctx?.entity.shared).toBe(true);
  });
});

describe("el menu de un enlace ofrece lo que la hoja sabe montar, y nada mas", () => {
  /*
    La lista sale **derivada**, de `paginasMontadas()`: la del registro menos las
    paginas que esta version de la hoja no monta. Escribirla aca seria una lista
    mas que se desincroniza en silencio —que es el fallo que
    `menus-test-helpers` existe para evitar—, asi que cuando T8 entregue la
    pagina de acceso este guard tiene que decir "tres" sin que nadie lo edite.
  */
  const ofrecibles = (): string[] => {
    const montadas = paginasMontadas();
    return accionesPara(menuCtxDeBookmark(BASE)!)
      .filter(
        (accion) => accion.destino.tipo === "hoja" || montadas.includes(accion.destino.page),
      )
      .map((accion) => accion.id);
  };

  it("hoy son renombrar y eliminar", () => {
    expect(ofrecibles()).toEqual(["rename", "delete"]);
  });

  it("acceso no se ofrece porque su pagina todavia no se monta", () => {
    // No por una fila apagada —eso seria ofrecer algo que no se puede hacer—
    // sino por el filtro de `puedeOfrecerse`, que saca la fila entera. Y sale
    // sola en cuanto `PAGINAS_MONTADAS` la incluya, sin tocar el registro.
    expect(ORDEN_POR_KIND.bookmark).toContain("access");
    expect(ACCIONES.access?.destino).toEqual({ tipo: "pagina", page: "access" });
    expect(paginasMontadas()).not.toContain("access");
    expect(ofrecibles()).not.toContain("access");
  });

  it("el registro manda en el orden: la hoja filtra filas, no las mueve", () => {
    expect(accionesPara(menuCtxDeBookmark(BASE)!).map((accion) => accion.id)).toEqual(
      ORDEN_POR_KIND.bookmark,
    );
  });

  it("lo compartido sale sin borrar, y con el motivo a la vista", () => {
    // La misma regla para las cinco entidades, pero probada **en el ctx que arma
    // esta pantalla**: es la unica forma de que se note si el call site deja de
    // pasar `shared`.
    const mio = menuCtxDeBookmark(BASE)!;
    const ajeno = menuCtxDeBookmark({ ...BASE, shared: true })!;

    expect(accionesPara(mio).map((accion) => accion.id)).toContain("delete");
    expect(ACCIONES.delete?.disponible?.(mio)).toBe(true);
    expect(ACCIONES.delete?.disponible?.(ajeno)).toBe(false);
    expect(ACCIONES.delete?.motivo?.(ajeno)).toBeTruthy();
  });
});

describe("los handlers escriben con las acciones que ya existen", () => {
  it("borrar es el tombstone de `lib/bookmarks/actions`, y nada mas", async () => {
    // Local-first como el resto: que el borrado sea local primero lo decide la
    // accion, y el menu solo la corre.
    await handlersDeBookmark(BASE)?.borrar?.();

    expect(acciones.deleteBookmarkAction).toHaveBeenCalledWith("b1");
  });

  it("renombrar manda id, version y el nombre nuevo", async () => {
    // La `baseVersion` la manda quien tiene el enlace delante: sin ella el
    // cambio entra contra una version que la cache ya no tiene.
    await handlersDeBookmark(BASE)?.rename?.("Salsa de la.ver");

    expect(acciones.updateBookmarkAction).toHaveBeenCalledWith({
      id: "b1",
      baseVersion: 7,
      title: "Salsa de la.ver",
    });
  });

  it("sin enlace no hay handlers, en vez de unos que no hacen nada", () => {
    expect(Object.keys(handlersDeBookmark(null)).length).toBe(0);
  });
});

describe("el testID de la fila no se pierde en silencio", () => {
  /*
    ------------------------------------------------------------------
    POR QUE ESTE GUARD EXISTE
    ------------------------------------------------------------------

    Porque la papelera de la fila tenia `testID` y hay cosas que lo miran: el
    conteo de filas de `unclassified-screen.test.ts` —que se apoya en el para
    afirmar que ninguna fila rompe el render— y los guard de fuente de las dos
    pantallas. Cuando la papelera se convierte en menu, el id puede quedarse
    puesto sobre un boton que ya no es ese —una mentira— o desaparecer sin que
    nadie se entere, que es perder el poder de verificar. Los dos fallos se ven
    igual desde donde se verifica, asi que el guard mira lo unico que importa:
    **que exista, que lleve el id de la fila y que algo del paquete lo mire de
    verdad**.
  */

  const CODIGO = PANTALLAS.map(
    ([nombre, ruta]) => [nombre, sinComentarios(src(ruta))] as const,
  );

  it("cada fila lleva un id propio, derivado del de su enlace", () => {
    for (const [nombre, codigo] of CODIGO) {
      // La forma tiene que llevar el id del enlace adentro: un prefijo fijo
      // identifica la pantalla y no la fila, y con el se pierde poder distinguir
      // una fila de otra al verificar.
      expect(codigo, nombre).toMatch(/testID=\{`[a-z-]+-\$\{[a-z]+\.id\}`\}/);
    }
  });

  it("algo del paquete lo mira todavia", () => {
    // Derivado de los archivos de test del disco y no de una lista: asi el
    // guard se entera solo de la tercera pantalla que se agregue, y —lo que es
    // lo importante— se entera cuando alguien **deje** de mirar el id.
    for (const [nombre, codigo] of CODIGO) {
      const prefijo = codigo.match(/testID=\{`([a-z-]+)-\$\{/)?.[1];
      expect(prefijo, `${nombre} no declara un prefijo de testID`).toBeTruthy();
      expect(TESTS, `nada del paquete mira el testID ${prefijo}*`).toContain(
        `"${prefijo}-`,
      );
    }
  });

  it("el id viejo de la papelera no quedo puesto sobre el boton que ya no es", () => {
    // `list-delete-` e `inbox-delete-` nombraban un boton que abria una hoja
    // propia. Quedarse con el nombre seria peor que perderlo: un guard que
    // busca "el boton de borrar" y se topa con el menu pasa en verde mientras
    // verifica otra cosa.
    for (const [nombre, codigo] of CODIGO) {
      expect(codigo, nombre).not.toContain("-delete-");
    }
  });
});

describe("el ancho que se le reserva al boton sale de donde el boton lo dice", () => {
  /*
    `MenuButton` es `position: absolute` con un `minWidth` propio y su propio
    margen a la derecha: si la fila no reserva ese ancho, el boton se monta
    encima del chevron y de la etiqueta de la derecha, y las dos cosas se pisan
    sin que nada falle. La reserva sale de leer al boton y no de una lista escrita
    aca, porque es el unico valor que cambia cuando el boton cambia de tamano y
    nadie se acuerda de volver a las dos pantallas.
  */

  it("la reserva de cada pantalla cubre el ancho que el boton ocupa", () => {
    const boton = src(BOTON);
    const ancho = Number(boton.match(/minWidth:\s*(\d+)/)?.[1]);
    const margen = String(boton.match(/right:\s*theme\.spacing\.(\w+)/)?.[1]);

    expect(ancho, "el boton tiene que declarar su minWidth").toBeGreaterThan(0);
    expect(margen, "el boton tiene que declarar su margen a la derecha").toBeTruthy();

    const ocupa = ancho + (SPACING[margen as keyof typeof SPACING] ?? 0);

    for (const [nombre, ruta] of PANTALLAS) {
      const token = String(src(ruta).match(/paddingRight:\s*theme\.spacing\.(\w+)/)?.[1]);
      expect(token, `${nombre} no reserva ancho`).toBeTruthy();

      const reservado = SPACING[token as keyof typeof SPACING] ?? 0;
      expect(
        reservado,
        `${nombre} reserva ${reservado} y el boton ocupa ${ocupa}`,
      ).toBeGreaterThanOrEqual(ocupa);
    }
  });
});

describe("la normalizacion del enlace vive en un archivo, no en dos pantallas", () => {
  it("las dos pantallas importan de ahi y ninguna define su propio host", () => {
    // `hostDe` estaba escrito identico en las dos pantallas, y el nombre del
    // enlace —el titulo o, si esta vacio, el host— tambien. Con la hoja encima
    // el nombre se lee por lo menos tres veces por fila, asi que tres copias de
    // la regla son tres reglas que pueden diferir sin que nada falle: el menu
    // de la lista diria una cosa y el del inbox otra, del mismo enlace.
    for (const [nombre, ruta] of PANTALLAS) {
      const pantalla = sinComentarios(src(ruta));
      expect(pantalla, nombre).toMatch(/from "@\/lib\/menus\/bookmark"/);
      expect(pantalla, nombre).not.toMatch(/function hostDe/);
    }
  });

  it("el archivo existe, que es lo que el guard de arriba supone", () => {
    expect(existsSync(join(RAIZ, LIB))).toBe(true);
  });
});