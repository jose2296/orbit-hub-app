import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { Bookmark } from "@orbit-hub/contracts";

import { puedeOfrecerse } from "@/lib/menus/paginas";
import { ACCIONES, ORDEN_POR_KIND, accionesPara } from "@/lib/menus/registry";
import { SPACING } from "@/theme/tokens";

import {
  HOJA,
  RAIZ,
  paginasMontadas,
  sinComentarios,
  src,
  tsxDeLaApp,
} from "./menus-test-helpers";

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
/**
 * La fila de enlace, y **la unica**: el boton, la caja relativa, la reserva del
 * ancho, el `flex: 1`, el nombre que cae al host y los dos mapas de estado.
 *
 * Antes vivia en las dos pantallas de `PANTALLAS` y se copio a una tercera, asi
 * que los guards de esta fila las nombraban a ellas —y la tercera paso sin que
 * ninguno la mirara—. Con un solo archivo los guards miran **este**, y las tres
 * pantallas quedan cubiertas por el hecho de no tener fila propia.
 */
const LINK_ROW = "src/components/bookmarks/link-row.tsx";

/** Las dos pantallas del enlace, con el nombre que usan los mensajes del fallo. */
const PANTALLAS = [
  ["la lista de enlaces", LISTA],
  ["el inbox", INBOX],
] as const;

/**
 * Los `.test.ts` del paquete, para el guard que busca quien mira un `testID`.
 *
 * `recursive` y no el listado de una carpeta: sin el, el dia que caiga un
 * `.test.ts` en un subdirectorio este guard deja de mirarlo **sin avisar**, que es
 * justo el modo de fallo que el archivo de helpers existe para cazar. Y por eso el
 * `join("/")`: `readdirSync` con `recursive` devuelve el caminho relativo con
 * separador de plataforma, y en Windows no seria un `test/...` que se pueda abrir.
 */
const TESTS = readdirSync(join(RAIZ, "test"), { recursive: true, encoding: "utf8" })
  .filter((nombre) => nombre.endsWith(".test.ts"))
  .map((nombre) => src(join("test", nombre)))
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

    it(`${nombre} monta la hoja unica y la fila compartida`, () => {
      expect(pantalla, nombre).toMatch(
        /import \{ EntityMenuSheet \} from "@\/components\/menus\/entity-menu-sheet"/,
      );
      expect(pantalla, nombre).toMatch(/<EntityMenuSheet\b/);
      /*
        Y la fila sale de `link-row.tsx`, que es **la misma** para las tres
        pantallas. Antes cada una montaba su propio `MenuButton` y por eso los
        guards de abajo las nombraban a ellas; ahora el boton, la caja relativa, la
        reserva del ancho y los mapas de estado viven en un archivo, y lo que estas
        pantallas tienen que decir es que lo montan.
      */
      expect(pantalla, nombre).toMatch(
        /import \{ LinkRow \} from "@\/components\/bookmarks\/link-row"/,
      );
      expect(pantalla, nombre).toMatch(/<LinkRow\b/);
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
    ------------------------------------------------------------------
    POR QUE EL FILTRO SE IMPORTA Y NO SE ESCRIBE ACA
    ------------------------------------------------------------------

    Porque esta funcion ya estaba escrita aqui character por character, y era la
    unica razon por la que este bloque podia mentir: si `puedeOfrecerse` ganaba una
    regla —y ya gano una, el caso especial de borrar que salio en la T2—, el test
    seguia afirmando la version vieja y pasaba en verde mientras la pantalla
    ofrecia otra cosa.

    Vive en `lib/menus/paginas.ts` y se importa, asi que **no hay segunda fuente**:
    lo que se prueba aca es el filtro que corre en la hoja, no una idea de el. Es el
    mismo arreglo que el registro le hizo a las ocho hojas de menu, aplicado al
    filtro que las nueve tareas siguientes van a reutilizar.
  */
  const ofrecibles = (): string[] =>
    accionesPara(menuCtxDeBookmark(BASE)!).filter(puedeOfrecerse).map((accion) => accion.id);

  it("hoy son renombrar, compartir, acceso y eliminar", () => {
    // `share` entra con la T10. No cambio el filtro ni el call site: cambio que
    // `shareNodeTypeSchema` admita `bookmark`, y el registro decide con `nodeTypeDe`.
    // Esta asercion es una fotografia y por eso dice "hoy": la version anterior
    // listaba tres y el error de la T10 habria sido precisamente no tocarla.
    expect(ofrecibles()).toEqual(["rename", "share", "access", "delete"]);
  });

  it("acceso se ofrece desde que su pagina existe, y sin tocar el registro", () => {
    // T8 la monto. Esta asercion existia al reves —"no se ofrece porque la pagina
    // no esta"— y la dio vuelta la tarea sin que nadie la buscara: el registro no
    // cambio, lo que cambio es `PAGINAS_MONTADAS`. Esa es la gracia de que el
    // filtro se importe y no se copie.
    expect(ORDEN_POR_KIND.bookmark).toContain("access");
    expect(ACCIONES.access?.destino).toEqual({ tipo: "pagina", page: "access" });
    expect(paginasMontadas()).toContain("access");
    expect(ofrecibles()).toContain("access");
  });

  it("el filtro es el de la hoja, y el de la hoja esta en un archivo sin React", () => {
    // La mitad del arreglo: que el filtro se pueda importar es lo que permite no
    // reescribirlo. Y que este en `lib/menus/paginas.ts` es lo que lo permite —
    // dentro de `entity-menu-sheet.tsx` el `import` revienta en Node por
    // `@expo/vector-icons`.
    expect(ofrecibles().length).toBeGreaterThan(0);

    const fuente = sinComentarios(src(HOJA));
    expect(fuente, "la hoja tiene que usar el filtro, no el suyo").toMatch(
      /import \{ puedeOfrecerse \} from "@\/lib\/menus\/paginas"/,
    );
    // Y que la hoja **no** tenga su propia copia, que es lo que dejaria de ser un
    // filtro y volveria a ser dos.
    expect(fuente).not.toMatch(/function puedeOfrecerse/);
    expect(fuente).not.toMatch(/PAGINAS_MONTADAS\s*[:=]/);
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

describe("el ancho que la fila le reserva al boton", () => {
  /*
    ------------------------------------------------------------------
    LOS TRES NUMEROS DEL BOTON, LEIDOS DE SU FUENTE
    ------------------------------------------------------------------

    `MenuButton` es `position: absolute` y tiene tres numeros que se suman: la caja
    que ocupa, el margen que se pone a la derecha y el `hitSlop`, que **agranda el
    area de toque mas alla de la caja**. Los tres se leen del archivo del boton y
    no se escriben aca, porque son suyos: el que cambia uno no se entera de que
    rompio las filas que ya lo montan, y un numero repetido en el guard es un
    numero que va a quedar viejo.
  */
  const boton = src(BOTON);

  const MIN = Number(boton.match(/const MIN_ANCHO = (\d+);/)?.[1]);
  const MARGEN = boton.match(/const MARGEN_DERECHA = "(\w+)";/)?.[1];
  const SLOP = Number(boton.match(/hitSlop=\{(\d+)\}/)?.[1]);

  it("el boton declara los tres, y el estilo los usa", () => {
    expect(MIN, "el boton tiene que declarar su ancho minimo").toBeGreaterThan(0);
    /*
      El `toMatch` y no un `toBeTruthy`: `String(undefined)` es la cadena
      `"undefined"`, que es truthy, asi que un `toBeTruthy` pasa con el margen
      ausente y la cuenta se queda sin un termino sin que nadie lo note.
    */
    expect(MARGEN, "el margen tiene que ser el nombre de un token de espaciado").toMatch(
      /^[a-z]+$/,
    );
    expect(SLOP, "el boton tiene que declarar su hitSlop").toBeGreaterThan(0);
    // Y no son numeros muertos: el estilo se sirve de ellos.
    expect(boton).toContain("minWidth: MIN_ANCHO");
    expect(boton).toContain("right: theme.spacing[MARGEN_DERECHA]");
  });

  it("el hitSlop del JSX y el de la cuenta son el mismo numero", () => {
    /*
      El numero vive en los dos lugares por una razon que esta escrita en el
      componente —`icon-page.test.ts` lee la linea `hitSlop={8}` del JSX—, y por
      eso hace falta alguien que afirme que los dos digan lo mismo. Sin este
      guard, cambiar el literal del JSX deja la cuenta vieja y el boton se come
      la fila otra vez, en silencio.
    */
    expect(boton.match(/const HIT_SLOP = (\d+);/)?.[1], "HIT_SLOP y el JSX").toBe(String(SLOP));
  });

  it("la reserva cubre los tres, y no solo la caja", () => {
    /*
      La cuenta se resuelve leyendo los nombres que aparecen en la expresion del
      `export`, uno por uno: si `HIT_SLOP` saliera de la suma, el valor caeria por
      debajo de lo que el boton ocupa y el guard tendria que verlo.
    */
    const expresion = boton.match(/export const ANCHO_RESERVADO = ([^;]+);/)?.[1] ?? "";
    const terminos = expresion.split("+").map((t) => t.trim());

    expect(terminos.length, `la reserva se compone de ${terminos.join(" + ")}`).toBe(3);

    /** Un token de `SPACING` a pixeles, y `undefined` si no lo es. */
    const pixeles = (token: string | undefined): number | undefined =>
      token ? SPACING[token as keyof typeof SPACING] : undefined;

    const valorDe = (termino: string): number => {
      if (termino === "MIN_ANCHO") return MIN;
      if (termino === "HIT_SLOP") return SLOP;

      // El token puede venir por la constante del boton o escrito alii. Con un
      // termino que no sea ninguno de los dos, `pixeles` devuelve `undefined`, la
      // suma queda `NaN` y el `toBeGreaterThanOrEqual` de abajo falla: un nombre
      // nuevo en la cuenta no se cuela como un cero.
      return pixeles(termino.match(/SPACING\[(?:MARGEN_DERECHA|"(\w+)")\]/)?.[1]) ?? pixeles(MARGEN) ?? 0;
    };

    const reserva = terminos.reduce((suma, termino) => suma + valorDe(termino), 0);
    const margenPx = pixeles(MARGEN);
    const ocupa = MIN + (margenPx ?? 0) + SLOP;

    expect(
      reserva,
      `la reserva es ${reserva} y el boton ocupa ${ocupa} (caja ${MIN} + margen ${margenPx} + hitSlop ${SLOP})`,
    ).toBeGreaterThanOrEqual(ocupa);
  });

  it("la fila compartida reserva la constante del boton, no un numero suyo", () => {
    /*
      Una sola fila, una sola reserva. Antes esto iteraba `PANTALLAS` —dos
      pantallas— y cada una tenia su copia; la tercera se sumo y el guard solo
      miraba las dos de la lista, asi que la copia de la coleccion podia tener un
      `44` a mano sin que nadie se enterara. Ahora que hay **un** archivo, el
      `paddingRight` se comprueba **una vez**, y las tres pantallas quedan
      cubiertas por el hecho de no tener fila propia.
    */
    const fila = sinComentarios(src(LINK_ROW));

    expect(fila, "la reserva sale del boton, no de un numero").toMatch(
      /paddingRight: ANCHO_RESERVADO/,
    );
    expect(fila, "y se importa de donde el boton la declara").toMatch(
      /import \{[^}]*ANCHO_RESERVADO[^}]*\} from "@\/components\/ui\/menu-button"/,
    );
  });

  it("y ninguna pantalla dibuja la fila por su cuenta", () => {
    // La segunda mitad del guard de arriba, y la que lo hacia derivable: que
    // aparezca una cuarta copia de la fila tiene que **fallar**, no pasar porque el
    // guard ya no mira ninguna pantalla.
    for (const [nombre, ruta] of PANTALLAS) {
      const codigo = sinComentarios(src(ruta));

      expect(codigo, `${nombre} vuelve a dibujar la fila`).not.toContain("<ListRow");
      expect(codigo, `${nombre} vuelve a montar el boton`).not.toContain("<MenuButton");
      expect(codigo, `${nombre} vuelve a tener los mapas de estado`).not.toContain(
        "CLAVE_ESTADO",
      );
    }
  });

  it("todo el que lo monta toma el ancho de ahi, y no un numero suyo", () => {
    /*
      Derivado de quien monta `MenuButton`, y no de las dos pantallas de arriba: asi
      entra solo `content-list.tsx` —que reserva un `44` escrito a mano, cuatro
      pixeles corto de la caja del boton y sin contarle el `hitSlop`— y entra la
      fila que se agregue manana sin que este test se toque.

      Y no mira el `paddingRight` sino el **import**, porque el sintoma de este
      bug no es un numero equivocado en la fila: es un numero que la fila se
      inventa. Un `paddingRight: ANCHO_RESERVADO` en el codigo pero sin importarlo
      no compila, asi que el import es la costura real.
    */
    const queLoMantan = tsxDeLaApp().filter((nombre) => src(`src/${nombre}`).includes("<MenuButton"));

    expect(
      queLoMantan.length,
      "sin archivos que lo monten el guard no comprobaria nada",
    ).toBeGreaterThan(0);

    for (const archivo of queLoMantan) {
      expect(sinComentarios(src(`src/${archivo}`)), `${archivo} reserva el ancho por su cuenta`).toMatch(
        /ANCHO_RESERVADO/,
      );
    }

    // Y el numero en crudo, que es como se colaba el `44`: un `paddingRight` con
    // un entero a secas, en cualquier archivo que monte el boton.
    for (const archivo of queLoMantan) {
      expect(
        sinComentarios(src(`src/${archivo}`)),
        `${archivo} tiene un paddingRight escrito a mano junto al boton`,
      ).not.toMatch(/paddingRight:[^,}]*\b\d+\b/);
    }
  });

  it("y la fila se encoge, porque sin `flex: 1` la reserva no hace nada", () => {
    /*
      La otra mitad del contrato, y la que mas facilmente se rompe sola: en RN el
      `flexShrink` por defecto es `0`, asi que una fila sin `flex: 1` **ignora** el
      `paddingRight` de la caja y un titulo largo se sale con el boton encima. No
      hay typecheck que lo note —el numero esta bien escrito— y con un ancho fijo
      tampoco se ve.

      Se afirma por **orden** y no con una ventana de caracteres: el `leading` que
      va en medio de la fila mide mas que cualquier `{0,600}` que se le ponga, asi
      que un rango fijo daria verde con la fila sin `flex`. Y ahora mira
      `link-row.tsx` y no las pantallas, porque la fila es **una sola**.
    */
    const codigo = sinComentarios(src(LINK_ROW));
    const abre = codigo.indexOf("<ListRow");
    const encoge = codigo.indexOf("style={{ flex: 1 }}", abre);
    const menu = codigo.indexOf("<MenuButton", abre);

    expect(abre, "la fila compartida no dibuja una ListRow").toBeGreaterThan(-1);
    expect(encoge, "la fila sin flex se sale de la caja").toBeGreaterThan(abre);
    expect(encoge, "el flex tiene que ser el de la fila, no el del menu").toBeLessThan(menu);
  });
});

describe("la regla del nombre de un enlace tiene una casa", () => {
  /*
    ------------------------------------------------------------------
    POR QUE LA LISTA SE DERIVA Y NO SE ESCRIBE
    ------------------------------------------------------------------

    Porque `tituloDeBookmark` no es la unica forma de nombrar un enlace y la
    lista de quien mas lo hace se Agranda: hoy son la fila del detalle y el
    subtitulo del triage, y la proxima pantalla nueva vuelve a escribir el
    `title.length > 0 ? ... : host || url`. Una lista escrita aca pasaria en
    verde el dia que la quinta copia se colara, y esa es exactamente la clase de
    deuda que T5 y T10 van a pagar si este guard no la ve.

    El marcador es la **regla entera**, no una parte: el ternario que cae al
    `url`. La forma corta —`.title.length > 0`— no sirve, porque las notas, las
    carpetas y el encabezado de la app la escriben tambien y con otra caida
    (`t("note.untitled")`): un guard que contara esas como copias de la regla del
    enlace estaria describiendo otra cosa, y el dia que se arreglara una de ellas
    fallaria por la razon equivocada.
  */
  const calculanElNombre = (): string[] =>
    tsxDeLaApp().filter((nombre) =>
      /\.title\.length > 0 \? [\w.]+\.title : [^;\n]*\.url/.test(src(`src/${nombre}`)),
    );

  /**
   * Las copias que quedan, con el motivo y con el trabajo que las cierra.
   *
   * No es una lista de archivos que "estan bien asi": es una lista de deudas, y
   * por eso cada entrada dice por que sigue ahi. El guard de abajo falla si una
   * de estas **deja** de ser una copia —porque alguien la.unifico y nadie borro la
   * entrada—, asi que la lista no puede quedarse vieja en silencio.
   */
  const COPIAS_PENDIENTES: Record<string, string> = {
    "app/(app)/bookmark/[bookmarkId].tsx":
      "el detalle escribe la misma regla y su propio `hostDe`; unificarla es unificar su fila con la de la lista.",
    "components/bookmarks/assign-sheet.tsx":
      "el triage ya diverge hoy: no cae al host. Recibe `BookmarkAClasificar`, un subconjunto de `Bookmark`, asi que la firma no encaja sin ensancharla.",
  };

  it("el marcador encuentra los archivos, y son los que se declaran", () => {
    // Sin esto el bloque pasa en verde con la lista vacia, que es como pasaban
    // los guards de T2 que se olvidaron un elemento.
    expect(calculanElNombre().length, "el marcador tiene que encontrar copias").toBeGreaterThan(0);
  });

  it("ninguna copia se escribe a mano fuera de las declaradas", () => {
    for (const archivo of calculanElNombre()) {
      if (archivo in COPIAS_PENDIENTES) continue;

      expect(
        src(`src/${archivo}`),
        `${archivo} escribe la regla del nombre del enlace en vez de tomarla de lib/menus/bookmark`,
      ).toMatch(/from "@\/lib\/menus\/bookmark"/);
    }
  });

  it("las declaradas siguen siendo copias, para que la lista no mienta", () => {
    for (const [archivo, motivo] of Object.entries(COPIAS_PENDIENTES)) {
      expect(
        calculanElNombre(),
        `${archivo} ya no calcula el nombre por su cuenta — ${motivo} Sacalo de la lista.`,
      ).toContain(archivo);
    }
  });

  it("la fila de la lista y la del inbox toman la regla del archivo", () => {
    // Derivado del arbol, y no de las dos pantallas de arriba: asi una tercera
    // que migre queda atada al mismo hecho sin que este test se toque.
    const tomanLaRegla = tsxDeLaApp().filter((nombre) =>
      src(`src/${nombre}`).includes('from "@/lib/menus/bookmark"'),
    );

    for (const [, ruta] of PANTALLAS) {
      expect(tomanLaRegla, ruta).toContain(ruta.replace(/^src\//, ""));
    }
  });

  it("el archivo que tiene la regla no se cuenta como copia", () => {
    // `tituloDeBookmark` escribe la regla con esas palabras y no es una copia de
    // si mismo: esta ahi justamente porque es `lib/menus/bookmark.ts` y no un
    // `.tsx`, asi que el recorrido de arriba ni lo mira.
    expect(calculanElNombre()).not.toContain("lib/menus/bookmark.ts");
    expect(src(LIB)).toContain(".title.length > 0");
  });
});
