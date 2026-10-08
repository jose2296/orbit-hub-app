import { describe, expect, it, vi } from "vitest";

import type { Collection } from "@orbit-hub/contracts";

import { dictionaries } from "@/lib/i18n/dictionaries";
import { ACCIONES, ORDEN_POR_KIND, accionesPara } from "@/lib/menus/registry";
import { puedeOfrecerse } from "@/lib/menus/paginas";

import { fuentesDeLosTests, sinComentarios, src, tsxDeLaApp } from "./menus-test-helpers";

/*
  ------------------------------------------------------------------
  POR QUE ESTE ARCHIVO MONTA NADA
  ------------------------------------------------------------------

  La pantalla pinta con React Native y cuelga de expo-router, y los dos son
  cosas que en Node ni se pueden importar. Lo que se afirma aca es lo que se
  puede leer —que la ruta existe, que sigue el esqueleto de las demas y que no
  escribe a mano lo que el registro y los adaptadores ya escriben— y lo puro,
  que es el `ctx` que arma `components/menus/coleccion`.

  Y esa segunda mitad es la que aporta: `entity-menu-sheet.test.ts` prueba que el
  adaptador **contiene** la cadena `title: collection.name`, que es leer el fuente
  de un archivo. Aca se importa y se afirma sobre el **valor**, con una coleccion
  fabricada: es la unica prueba del repo de que el nombre de una coleccion llega
  al menu normalizado, y hasta ahora nadie lo habia comprobado por ese lado.
*/

/*
  Las acciones tocan la cache, que es `expo-sqlite` y no existe en Node. Sin el
  mock, importar el adaptador —que es puro y no pinta nada— seria importar la
  base de datos. Mismo apunte que el de `bookmark-menu.test.ts` con
  `@/lib/bookmarks/actions`.
*/
vi.mock("@/lib/collections/actions", () => ({
  deleteCollectionAction: vi.fn(),
  updateCollectionAction: vi.fn(),
}));

import { menuCtxDeColeccion } from "@/components/menus/coleccion";

/** La ruta, tal como queda en el arbol de `src`, y no como la declara este test. */
const RUTA = "app/(app)/collection/[collectionId].tsx";

/** Quien manda una fila de coleccion a donde se abre. */
const CONTENT_LIST = "src/components/content/content-list.tsx";

/** La cabecera de la pila, que declara las pantallas con nombre de datos. */
const LAYOUT = "src/app/(app)/_layout.tsx";

const BASE: Collection = {
  id: "c1",
  version: 4,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-03-04T10:00:00.000Z",
  workspaceId: "w1",
  folderId: null,
  name: "Recetas",
  description: null,
  emoji: null,
  position: 0,
  bookmarkCount: 0,
  role: "owner",
  shared: false,
  deletedAt: null,
};

/** El codigo de la pantalla, sin la prosa: los `not.toContain` miran el codigo. */
const codigo = (): string => sinComentarios(src(`src/${RUTA}`));

/**
 * El codigo de la fila compartida, y **no** una copia de el leida de la pantalla.
 *
 * La ruta sale del arbol como sale la de la pantalla: derivarla de un nombre
 * escrito aca seria una lista, y una lista es justo lo que dejo de haber.
 */
const codigoDeLaFila = (): string =>
  sinComentarios(src(`src/${tsFilaDeEnlace()}`));

/** La fila de enlace, del directorio y no de una constante escrita aca. */
function tsFilaDeEnlace(): string {
  const candidatas = tsxDeLaApp().filter((nombre) => nombre.endsWith("bookmarks/link-row.tsx"));

  expect(
    candidatas.length,
    "se espera una fila de enlace compartida, y el directorio no la tiene",
  ).toBe(1);

  return candidatas[0] as string;
}

describe("una coleccion es una pantalla, y la ruta existe", () => {
  it("esta en el arbol, y el arbol la encuentra solo", () => {
    /*
      Derivado de los `.tsx` de `src` y no de una lista. Una lista escrita aca
      pasa en verde el dia que la ruta se renombra o se borra, que es justo el
      fallo que el archivo de helpers existe para cazar: el guard que no mira
      nada y el guard que mira lo viejo se parecen en el informe.
    */
    const rutas = tsxDeLaApp().filter((nombre) => nombre.includes("[collectionId].tsx"));

    expect(rutas).toContain(RUTA);
  });

  it("y es una ruta de verdad: lo que declara es el default", () => {
    // Expo-router toma el `default` del archivo: una pantalla sin el se registra
    // y no pinta nada, y el unico sintoma es una ruta que empuja a un lugar
    // vacio.
    expect(src(`src/${RUTA}`)).toMatch(/export default function/);
  });

  it("y la fila de una coleccion llega aca, y no al filtro viejo", () => {
    /*
      ------------------------------------------------------------------
      POR QUE ESTE GUARD EXISTIA Y AHORA AFIRMA LO CONTRARIO
      ------------------------------------------------------------------

      Escribi la version anterior: `content-list.tsx` mandaba la fila a
      `/(app)/bookmarks` con `collectionId` en los parametros, eso era una deuda
      **fuera de la superficie de la T5**, y el guard la nombraba con su motivo y
      caia el dia que alguien la pagara.

      Se pago. Y un guard que solo sabe decir "esto sigue mal" deja de ser util en
      cuanto esta bien: ahora afirma que la fila llega **aca**, y si alguien
      devuelve el `pathname` a `/bookmarks` —que sigue funcionando, y por eso la
      vuelta es facil— este test falla.

      Y se derivan las dos mitades: que la fila mande a la pantalla nueva, y que ya
      no mande a la lista con un filtro.
    */
    /*
      El marcador es el `pathname` del filtro y no el `collectionId: row.id`: ese
      parametro esta en las dos versiones —la que iba a `/bookmarks` y la que va
      aca—, asi que como marcador de "la fila todavia usa el filtro" no distingue
      nada. Y el `pathname` es lo unico que si.
    */
    const alFiltro = tsxDeLaApp().filter((nombre) =>
      src(`src/${nombre}`).includes('pathname: "/(app)/bookmarks"'),
    );
    const lista = sinComentarios(src(CONTENT_LIST));

    expect(
      alFiltro,
      "nadie manda una coleccion al filtro de /bookmarks: esa lista solo es de enlaces sin coleccion",
    ).toEqual([]);
    expect(lista).toMatch(/pathname: "\/\(app\)\/collection\/\[collectionId\]"/);
    expect(lista).toMatch(/params: \{ collectionId: row\.id \}/);
    // Y **sin `workspaceId`**: el espacio de una coleccion es un dato de la
    // coleccion, que la pantalla resuelve sola desde la cache. Mandarlo seria una
    // segunda fuente de verdad para el mismo dato.
    expect(lista).not.toMatch(/pathname: "\/\(app\)\/bookmarks"/);
  });
});

describe("el esqueleto es el de una pantalla con cabecera, no uno nuevo", () => {
  it("Screen, el titulo en la cabecera y la accion de la cabecera", () => {
    const fuente = codigo();

    expect(fuente).toMatch(/<Screen\b/);
    expect(fuente).toContain("useScreenTitle(");
    // Y el boton va por `useHeaderAction`, que es la unica via: escribir el
    // slot con `setOptions` desde la pantalla no funciona y el motivo esta
    // escrito en `header-action.tsx`.
    expect(fuente).toContain("useHeaderAction(");
  });

  it("los tres puntitos son el `Button` que las demas pantallas publican", () => {
    /*
      El modelo es `folder/[folderId].tsx` y `list/[listId].tsx`: un `Button`
      `ghost`, `sm`, `iconOnly` con elipsis, con su `testID` y con las
      dependencias del slot.

      Y **no** es `MenuButton`: ese es el boton de la fila de una lista, y esta
      cabecera no es una fila. Montarlo aqui ademasaria el unico lugar de la app
      donde los tres puntitos de la cabecera los dibuja otro componente, y cuatro
      cabeceras con un boton y una quinta con otro es el principio de que el
      header se ve igual en todas.
    */
    const fuente = codigo();

    expect(fuente).toMatch(/import \{ Button \} from "@\/components\/ui\/button"/);
    expect(fuente).toMatch(/<Button\b/);
    expect(fuente).toContain('icon="ellipsis-horizontal"');
    expect(fuente).toContain("iconOnly");
    expect(fuente).toMatch(/testID="collection-menu-button"/);
  });

  it("el boton abre el menu de la coleccion, y solo cuando hay coleccion", () => {
    // El `null` cuando no hay nada que abrir es lo que hacen las dos pantallas
    // que son el modelo: un boton de tres puntitos que abre el menu de nada es un
    // boton sin destino. Y las dependencias del slot se declaran, porque sin ellas
    // el header no se redibuja cuando el nombre de la coleccion cambia.
    const fuente = codigo();

    expect(fuente).toMatch(
      /useHeaderAction\([\s\S]*?\?\s*\([\s\S]*?\)\s*:\s*null,[\s\S]*?\[coleccion, t\],/,
    );
    expect(fuente).toContain("setColeccionConMenu(coleccion)");
  });

  it("el nombre de la cabecera es el de la coleccion, y no una regla escrita aca", () => {
    /*
      Se afirma sobre **la expresion que se le pasa**, no sobre el archivo entero:
      `useScreenTitle` puede llevar dos argumentos —el titulo y el icono— y lo que
      importa es de donde sale el primero.

      Y el icono no se pasa: el contrato de una coleccion tiene `emoji`, que es
      texto plano, y no un `IconRef` (`registry.tsx` lo dice en `CON_ICON_REF`).
      Pasarle `null` a proposito seria ruido; no pasar el segundo argumento es lo
      que dice la misma regla.
    */
    const titulo = codigo().match(/useScreenTitle\(([^;]*)\)/)?.[1] ?? "";

    expect(titulo, "el titulo de la cabecera no sale de la coleccion").toContain(".name");
    // Y sale del contrato, con el nombre que la cache ya trajo.
    expect(codigo()).toContain("useCollections(");
  });

  it("el espacio tambien, porque una coleccion vive en un espacio", () => {
    // El lavado de la cabecera lo pone `useScreenSpace`, y el de la pantalla el
    // `wash` de `Screen`: es lo que hacen `list/[listId].tsx` y
    // `folder/[folderId].tsx`, y sin esto esta pantalla seria la unica de dentro
    // de un espacio con la cabecera en el gris del tema.
    expect(codigo()).toContain("useScreenSpace(");
    expect(codigo()).toMatch(/wash=\{/);
  });

  it("el boton se llama con la frase de una coleccion, no con la de otra", () => {
    // `collections.menu` es la frase de **este** control para **esta** entidad, y
    // por eso se agrego al diccionario en la ronda de fix. Antes la etiqueta era
    // `collections.kind` porque la clave no existia, y el guard lo aceptaba: un
    // boton de tres puntitos que se anuncia como "Coleccion" en vez de como su
    // menu es una etiqueta que no nombra lo que hace.
    const fuente = codigo();

    expect(fuente).toContain('label={t("collections.menu")}');
    // Y la clave existe en las dos lenguas, con su palabra: una clave que se
    // declara y no se traduce sale en la pantalla como la propia clave.
    expect(dictionaries.es["collections.menu"]).toBeTruthy();
    expect(dictionaries.en["collections.menu"]).toBeTruthy();
  });

  it("y el layout declara la pantalla, como las demas de la pila", () => {
    /*
      El nombre lo pone la pantalla con `useScreenTitle`, asi que el titulo vacio
      es lo unico que hay que declarar. Sin la linea, la cabecera muestra
      `"collection/[collectionId]"` hasta que el efecto de la pantalla corre: un
      frame con texto de desarrollo, en la pantalla nueva, que es la que se
      acaba de escribir para que no se vea.
    */
    expect(sinComentarios(src(LAYOUT))).toMatch(
      /<Stack\.Screen name="collection\/\[collectionId\]" options=\{\{ title: "" \}\} \/>/,
    );
  });
});

describe("el menu de la cabecera es el del registro y no una hoja propia", () => {
  it("monta la hoja unica y pasa el ctx y los handlers de la coleccion", () => {
    const fuente = codigo();

    expect(fuente).toMatch(
      /import \{ EntityMenuSheet \} from "@\/components\/menus\/entity-menu-sheet"/,
    );
    expect(fuente).toMatch(/<EntityMenuSheet\b/);
    expect(fuente).toMatch(
      /import \{[^}]*menuCtxDeColeccion[^}]*\} from "@\/components\/menus\/coleccion"/,
    );
  });

  it("el ctx es el estado, y no la coleccion que esta en pantalla", () => {
    /*
      ------------------------------------------------------------------
      POR QUE NO PUEDE SER `coleccion`
      ------------------------------------------------------------------

      `EntityMenuSheet` congela el `ctx` con `useLastValue` para poder seguir
      pintando durante los 330 ms en que el `Modal` todavia esta montado, y lo que
      espera del llamador al cerrarse es **`null`**. Si la pantalla le pasara la
      coleccion que tiene delante, el ctx no se volveria `null` nunca: el menu se
      abriria, se cerraria y **no se iria** —`visible={pedido !== null}` con un
      pedido que nunca es `null`—, y el sintoma es un boton de tres puntitos que
      abre un menu que no se puede quitar de encima.

      Es el mismo reloj que usan `bookmarks.tsx` y las dos pantallas que ya abren
      el menu de una coleccion, y por eso lo que se afirma es la forma de la
      llamada —un identificador, y no la coleccion— y no el nombre de la variable.
    */
    const fuente = codigo();
    const arg = fuente.match(/menuCtxDeColeccion\(([^)]*)\)/)?.[1] ?? "";

    expect(arg, "el ctx tiene que salir del estado").toMatch(/^[a-zA-Z]+$/);
    expect(arg, "la hoja congela el ctx y espera null al cerrar: el estado, no la coleccion").not.toBe(
      "coleccion",
    );
    // Los handlers van con la misma variable, por el mismo congelado.
    expect(fuente).toMatch(/handlersDeColeccion\(([a-zA-Z]+)\)/);
    expect(fuente).toMatch(new RegExp(`handlersDeColeccion\\(${arg}\\)`));
  });

  it("no normaliza la entidad por su cuenta, en ninguna pantalla del arbol", () => {
    /*
      Derivado del arbol entero, y mas fuerte que la lista de dos archivos de
      `entity-menu-sheet.test.ts`: ese guard nombra las dos pantallas que ya
      existen, asi que una tercera que normalizara por su cuenta pasaria en
      verde.

      Y el marcador es **`caps:`**, no `kind: "collection"`: el `kind` aparece en
      `content-order.ts` y en `content-filters-body.tsx` para el discriminante de
      una **fila de contenido**, que es otra union y no tiene nada que ver con el
      menu —un guard que busca la palabra nombra una cosa y describe otra—. Lo
      unico que un `MenuContext` tiene y una fila de contenido no es `caps`.
    */
    const armanElCtx = tsxDeLaApp().filter((nombre) => src(`src/${nombre}`).includes("caps:"));

    /*
      El unico autorizado es el registro, y es el unico por una razon de tipo, no
      de gusto: `MenuContext` esta **declarado** ahi —el archivo es `.tsx` porque
      importa `type { Ionicons }`—, y declarar el tipo no es armarlo. Los dos
      adaptadores que lo arman son `.ts`, que es por donde el recorrido no los
      mira y por eso ninguno cuenta como copia de si mismo.
    */
    const ESPERADOS = ["lib/menus/registry.tsx"];

    expect(
      armanElCtx,
      "el MenuContext se arma en components/menus/coleccion.ts y en lib/menus/bookmark.ts, no en una pantalla",
    ).toEqual(ESPERADOS);

    // Y en las dos direcciones, para que la lista no se quede vieja en silencio.
    for (const archivo of ESPERADOS) {
      expect(src(`src/${archivo}`), `${archivo} ya no declara caps — sacalo de la lista`).toContain(
        "caps:",
      );
    }
  });

  it("no declara sus propias acciones, ni las de escribir", () => {
    /*
      Sin comentarios: el archivo explica en su prosa por que la fila se dibuja
      como se dibuja, y un `not.toContain` que se encuentra con su propia prosa
      falla por la razon equivocada. Lo que se afirma es que el codigo no los usa.
    */
    const fuente = codigo();

    expect(fuente).not.toContain("trash-outline");
    expect(fuente).not.toContain("deleteCollectionAction");
    expect(fuente).not.toContain("updateCollectionAction");
    // Y la lista de filas no se escribe ni se ordena aca: esa es del registro.
    expect(fuente).not.toContain("ORDEN_POR_KIND");
    expect(fuente).not.toContain("ACCIONES[");
    expect(fuente).not.toContain("accionesPara(");
  });

  it("el ctx de una coleccion sale del contrato, normalizado una sola vez", () => {
    // Sin coleccion no hay menu: la hoja congela lo que recibe, y lo que espera
    // del llamador al cerrarse es `null`.
    expect(menuCtxDeColeccion(null)).toBeNull();

    const ctx = menuCtxDeColeccion(BASE);
    // Y el rol y el compartido sin retocar: son los que deciden que borrar salga
    // grisado con su motivo, y traducirlos aca seria una oportunidad mas de colar
    // un `role: string` que el contrato no admitiria.
    const ajeno = menuCtxDeColeccion({ ...BASE, role: "viewer", shared: true });

    expect(ctx?.kind).toBe("collection");
    // `Collection` dice `name` y `MenuEntity` dice `title`. Aca se comprueba el
    // **valor**, que es lo que el resto de la cadena —la cabecera de la hoja y el
    // campo de renombrar— va a pintar.
    expect(ctx?.entity.title).toBe("Recetas");
    expect(ctx?.entity.id).toBe("c1");
    expect(ajeno?.entity.role).toBe("viewer");
    expect(ajeno?.entity.shared).toBe(true);
  });

  it("el menu de una coleccion ofrece lo que la hoja sabe montar, y nada mas", () => {
    /*
      La lista sale del registro por el mismo camino que la corre la hoja —se
      **importa** `puedeOfrecerse`— y se afirma sobre el `ctx` que arma el archivo
      que la pantalla usa, que es lo unico que detecta que el call site deje de
      pasar `shared` o el `role`.
    */
    const ofrecibles = (): string[] =>
      accionesPara(menuCtxDeColeccion(BASE)!)
        .filter(puedeOfrecerse)
        .map((accion) => accion.id);

    expect(ofrecibles()).toEqual(["rename", "delete"]);
    // `access` esta en el orden del registro desde la T1 y la hoja la filtra
    // porque `AccessPage` es de la T8; `export` no sale porque es una capacidad y
    // no hay endpoint. Las dos ausencias estan anotadas con su tarea en
    // `entity-menu-sheet.test.ts`, asi que aca no se repiten.
    expect(ORDEN_POR_KIND.collection).toEqual(["rename", "access", "export", "delete"]);
    expect(ofrecibles()).not.toContain("access");
    expect(ofrecibles()).not.toContain("export");

    // Lo compartido sale sin borrar y con el motivo a la vista: la misma regla
    // para las cinco entidades, probada en el ctx de esta pantalla.
    const ajeno = menuCtxDeColeccion({ ...BASE, shared: true })!;

    expect(ACCIONES.delete?.disponible?.(ajeno)).toBe(false);
    expect(ACCIONES.delete?.motivo?.(ajeno)).toBeTruthy();
  });
});

describe("la lista de enlaces es la de T4, con su menu de fila", () => {
  it("filtra por la coleccion de la ruta y no reordena", () => {
    expect(codigo()).toContain("useBookmarks(");
    expect(codigo()).toContain("collectionId:");
    // `updatedAt desc` lo pone el hook. Un `.sort` aca seria un segundo criterio
    // compitiendo con el primero.
    expect(codigo()).not.toContain(".sort(");
  });

  it("la fila es la compartida, y la monta sin dibujarla", () => {
    /*
      ------------------------------------------------------------------
      POR QUE ESTA PANTALLA NO DIBUJA LA FILA
      ------------------------------------------------------------------

      Porque la fila de un enlace es **una sola** —`components/bookmarks/link-row`—
      y la pintan la lista, el inbox y esta. Cuando esta pantalla la copio, la
      tercera copia vino con su caja relativa, su `ANCHO_RESERVADO`, su `flex: 1`,
      su punto de estado y sus dos mapas: tres lugares donde arreglar lo mismo y
      tres donde un arreglo se aplica a dos.

      Asi que el guard mira **las dos mitades**: que la pantalla monte `LinkRow`, y
      que no tenga fila propia. La segunda es la que lo hace derivable —si alguien
      copia la fila otra vez, esto falla— y `bookmark-menu.test.ts` la repite sobre
      las otras dos pantallas.
    */
    const fuente = codigo();

    expect(fuente).toMatch(/import \{ LinkRow \} from "@\/components\/bookmarks\/link-row"/);
    expect(fuente).toMatch(/<LinkRow\b/);
    expect(fuente).toContain("onMenu=");
    // Y lo que la fila se lleva con ella, para que nadie lo reescriba aca.
    expect(fuente).not.toContain("<ListRow");
    expect(fuente).not.toContain("<MenuButton");
    expect(fuente).not.toContain("CLAVE_ESTADO");
    expect(fuente).not.toContain("COLOR_ESTADO");
    expect(fuente).not.toContain("ANCHO_RESERVADO");
  });

  it("y el nombre de un enlace sale del archivo que tiene la regla", () => {
    // `tituloDeBookmark` y `hostDe` viven en `lib/menus/bookmark` porque quien
    // nombra un enlace los toma de ahi, y ahora quien lo nombra es la fila. Esta
    // pantalla los necesita igual —el `ctx` del menu sale del mismo archivo— asi
    // que el import se queda, pero **la regla no se reescribe en ninguno de los
    // dos**.
    const fuente = codigo();
    const fila = codigoDeLaFila();

    expect(fila).toMatch(/import \{[^}]*tituloDeBookmark[^}]*\} from "@\/lib\/menus\/bookmark"/);
    expect(fila).toMatch(/import \{[^}]*hostDe[^}]*\} from "@\/lib\/menus\/bookmark"/);
    expect(fuente).toMatch(/import \{[^}]*menuCtxDeBookmark[^}]*\} from "@\/lib\/menus\/bookmark"/);
    expect(fuente).toMatch(/import \{[^}]*handlersDeBookmark[^}]*\} from "@\/lib\/menus\/bookmark"/);
    // Y la regla entera, no una parte: el ternario que cae a la URL.
    for (const [nombre, texto] of [
      ["la pantalla", fuente],
      ["la fila", fila],
    ] as const) {
      expect(texto, nombre).not.toMatch(/\.title\.length > 0 \? [\w.]+\.title : [^;\n]*\.url/);
    }
  });

  it("la fila lleva un id propio, y algo del paquete lo mira", () => {
    /*
      El `testID` es poder verificar: sin el, un conteo de filas no puede ser por
      fila. Y "algo lo mira" se afirma leyendo los `.test.ts` **del disco** —con
      `recursive`, para que un test nuevo en un subdirectorio no se quede sin
      mirar sin avisar— y no con una lista: asi el guard se entera cuando alguien
      deje de mirarlo, que es el fallo que importa.
      *
      * Y el prefijo lo pone **la pantalla**, no la fila: es lo que dice de donde
      * se esta la fila —`list-`, `inbox-`, `collection-`—, y si viviera en el
      * componente las tres pantallas compartirian un id y el conteo volveria a
      * ser el total.
    */
    const prefijo = codigo().match(/testID=\{`([a-z-]+)-\$\{[a-z]+\.id\}`\}/)?.[1];

    expect(prefijo, "la fila no lleva un id propio").toBeTruthy();
    // Con la comilla delante, que es como lo escribe un guard: lo que se busca es
    // la cadena del prefijo, no la palabra.
    expect(fuentesDeLosTests(), `nada del paquete mira el testID ${prefijo}-*`).toContain(
      `"${prefijo}-`,
    );
  });
});

describe("la fila de un enlace es una sola en todo el repo", () => {
  /*
    ------------------------------------------------------------------
    POR QUE ESTE BLOQUE EXISTE Y NO ES EL DE `bookmark-menu.test.ts`
    ------------------------------------------------------------------

    Porque aquel mira **las dos pantallas** que ya existian, y la tercera —esta— se
    coló sin que las mencionara. Y el sintoma es el peor de un guard derivado: el
    bloque sigue mirando, sigue encontrando, y su lista de archivos se quedo
    corta sin avisar.

    Asi que este deriva de **quien dibuja una fila de enlace**, y no de quien dice
    que tiene un `ListRow`. Un `ListRow` de otra cosa —un item de lista, un ajuste,
    un espacio— no es una fila de enlace y no debe aparecer aqui, asi que el
    marcador tiene que ser el **conjunto** de piezas de la fila: el boton de tres
    puntitos, el icono de enlace, el punto del estado y la reserva del ancho. Un
    archivo que tenga las cuatro esta dibujando una fila de enlace, y solo puede
    haber uno.
  */

  /**
   * Las piezas que **solo juntas** son una fila de enlace.
   *
   * El icono solo no sirve, y se ve en el repo: `icon="bookmark-outline"` aparece
   * tambien en los `EmptyState` de la lista y de la coleccion, y en el `Pick` del
   * selector de destino —que es una fila de **coleccion**, no de enlace—. Con ese
   * icono como marcador, el guard tendria que confiar en que ningun otro
   * `EmptyState` dibuja un `MenuButton` al lado, y esa es exactamente la clase de
   * confianza que un guard derivado no necesita.
   *
   * Las cuatro juntas no admiten confusion: la caja de la fila, el nombre que sale
   * de la regla, el ancho reservado y el boton.
   */
  const PIEZAS = [
    "<ListRow",
    "tituloDeBookmark(bookmark)",
    "paddingRight: ANCHO_RESERVADO",
    "<MenuButton",
  ] as const;

  const dibujanUnaFilaDeEnlace = (): string[] =>
    tsxDeLaApp().filter((nombre) => {
      const codigo = sinComentarios(src(`src/${nombre}`));

      return PIEZAS.every((pieza) => codigo.includes(pieza));
    });

  it("el marcador encuentra la fila, y son las piezas que la forman", () => {
    // Sin esto el bloque pasa en verde con la lista vacia, que es como pasaron los
    // guards de T2 que se olvidaron un elemento.
    expect(dibujanUnaFilaDeEnlace().length, "sin fila, el guard no comprobaria nada").toBe(1);
  });

  it("y las tres pantallas la montan en vez de dibujarla", () => {
    // La afirmacion en positivo de la regla: las tres la usan, y por eso hay un
    // archivo y no tres.
    const fila = tsFilaDeEnlace();

    for (const ruta of [
      "app/(app)/bookmarks.tsx",
      "app/(app)/unclassified.tsx",
      RUTA,
    ]) {
      expect(sinComentarios(src(`src/${ruta}`)), ruta).toMatch(/<LinkRow\b/);
    }

    expect(fila).toBeTruthy();
  });
});
