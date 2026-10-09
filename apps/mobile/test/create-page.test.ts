import { describe, expect, it } from "vitest";

import type { Folder, ListKind } from "@orbit-hub/contracts";

import { dictionaries } from "@/lib/i18n/dictionaries";
import { menuDeCarpeta } from "@/lib/menus/carpeta";
import type { AccionesDeCarpeta } from "@/lib/menus/carpeta";
import { PAGINAS_MONTADAS, puedeOfrecerse } from "@/lib/menus/paginas";
import { ORDEN_POR_KIND, accionesPara } from "@/lib/menus/registry";
import type { MenuContext, MenuKind } from "@/lib/menus/registry";
import { LIST_KIND_LABEL, LIST_KIND_ORDER } from "@/lib/lists/kind";

import { TIPOS_DE_LA_HOJA_VIEJA } from "./fixtures/folder-menu-sheet-options";
import {
  PAGINAS,
  hojasMontadas,
  hoja,
  paginasMontadas,
  sinComentarios,
  src,
} from "./menus-test-helpers";

/**
 * `CreatePage`, por fuente y por registro.
 *
 * ------------------------------------------------------------------
 * POR QUE NO MONTA NADA
 * ------------------------------------------------------------------
 *
 * Por lo que ya dicen `entity-menu-sheet.test.ts` y `share-page.test.ts`: no hay
 * `@testing-library` ni `jsdom`, y esta pagina llega a `SheetOptions` y de ahi al
 * dibujo del icono —`@expo/vector-icons`, que en Node ni se parsea—. Lo que se afirma
 * aca es **la costura**: que la pagina existe donde la hoja la busca, que sus filas
 * salen de la lista unica de tipos, que al tocarse **devuelve el tipo y no decide
 * nada**, y que la fila de "crear una lista aqui" vuelve a ofrecerse.
 *
 * Lo que no se puede comprobar y no se va a prometer: que al apretar "Peliculas" se
 * abra la hoja de creacion con ese tipo. Eso se mira en la pantalla, y depende de un
 * call site que hoy no pasa el callback —esta escrito mas abajo, con nombre, porque
 * en silencio seria una perdida que nadie nombra.
 *
 * ------------------------------------------------------------------
 * Y POR QUE LA PARITAD CON LA HOJA VIEJA ESTA CONGELADA Y NO ESCRITA
 * ------------------------------------------------------------------
 *
 * Porque `folder-menu-sheet.tsx` se borro en la T7, y un guard que lee un archivo que
 * se guardo se queda comprobando nada sin avisar. Las filas del selector de tipos
 * estan congeladas en `fixtures/folder-menu-sheet-options.ts` como
 * `TIPOS_DE_LA_HOJA_VIEJA` —**aparte**, porque `createOptions` estaba antes de
 * `options` en el archivo y la extraccion documentada del otro bloque no lo tomaba— y
 * aca se le preguntan tres cosas, todas contestables leyendo el bloque: de donde
 * salen las filas, cual es la etiqueta y que hace `onPress`.
 */

const PAGINA = `${PAGINAS}/create-page.tsx`;
const REGISTRO = "src/lib/menus/registry.tsx";

/** La carpeta del dueno. */
const CARPETA = {
  id: "f1",
  name: "Peliculas",
  parentId: null,
  position: 0,
} as Folder;

/** Lo que el adaptador necesita; el callback va en el test que lo exercise. */
const accionesDePrueba: AccionesDeCarpeta = {
  layout: [],
  save: () => {},
  updateFolder: () => {},
  deleteFolder: () => {},
  listCount: 3,
  t: (clave) => clave,
};

/** Las filas que el menu ofrece de verdad, con el filtro puesto. */
function pintadas(ctx: MenuContext | null): string[] {
  if (!ctx) return [];

  return accionesPara(ctx)
    .filter(puedeOfrecerse)
    .map((accion) => accion.id);
}

/**
 * El bloque de una funcion de la hoja, con los comentarios fuera.
 *
 * Se recorta por el nombre y no se lee el archivo entero porque la hoja tiene muchos
 * `onClose`, `correr` y `sinHandler` mas: un `not.toMatch` sobre el fuente entero
 * afirmaria sobre todos y no sobre el bloque que este guard describe. Es la misma
 * razon por la que `sinComentarios` existe.
 */
function bloqueDe(nombre: string): string {
  const codigo = sinComentarios(hoja);
  const desde = codigo.indexOf(`const ${nombre} = `);

  if (desde < 0) throw new Error(`la hoja no declara "${nombre}", o no con esa forma`);

  return codigo.slice(desde, codigo.indexOf("};", desde));
}

describe("la fila de crear una lista aqui vuelve a estar en el menu", () => {
  it("`create` esta entre las paginas montadas", () => {
    /*
      ------------------------------------------------------------------
      LA REGRESION ENTERA EN UNA LINEA
      ------------------------------------------------------------------

      `ACCIONES.createHere` declara `destino: { tipo: "pagina", page: "create" }` y
      `ORDEN_POR_KIND.folder` la lista para la carpeta. Sin esta entrada en
      `PAGINAS_MONTADAS` el filtro `puedeOfrecerse` saca la fila entera y **crear una
      lista dentro de una carpeta deja de existir**: es la segunda vez que pasa en este
      plan —la primera fue `share` en la T11— y no deja ningun sintoma, porque una
      opcion que no esta y una opcion que todavia no se escribio se ven igual desde el
      menu.

      Y sale del modulo y no del fuente: un `import` no se puede desincronizar del
      archivo que se esta probando, que es justo lo que hacia un regex.
    */
    expect(paginasMontadas()).toContain("create");
    expect(PAGINAS_MONTADAS).toContain("create");
  });

  it("y el filtro deja de sacarla, que es el otro lado de lo mismo", () => {
    /*
      El `ctx` sale del **adaptador** y no de un literal escrito aca: lo que hay que
      comprobar es que la fila se ofrece para una carpeta de verdad, con las
      capacidades que `menuDeCarpeta` le pone. Un `MenuContext` a mano aprobaria un
      `createInside: true` que el archivo podria haber dejado de poner sin que nada se
      enterara.
    */
    expect(pintadas(menuDeCarpeta(CARPETA, accionesDePrueba).ctx)).toContain("createHere");
  });

  it("las seis filas de la carpeta, y la primera es esta", () => {
    /*
      El conjunto entero y no solo la presencia: el orden lo decide el registro y el
      filtro saca lo que la hoja todavia no puede pintar, asi que "esta" se lee de la
      lista pintada. Si alguien saca `createHere` de `ORDEN_POR_KIND.folder` esta linea
      falla y dice que la fila se perdio, que es distinto de que la pagina se haya roto.
    */
    expect(pintadas(menuDeCarpeta(CARPETA, accionesDePrueba).ctx)).toEqual([
      "createHere",
      "pin",
      "rename",
      "icon",
      "share",
      "access",
      "delete",
    ]);
  });
});

describe("ninguna pagina declarada y no escrita se pierde en silencio", () => {
  /*
    ------------------------------------------------------------------
    EL TERCER CASO, Y POR QUE ESTE BLOQUE MIRA LOS CINCO KINDS
    ------------------------------------------------------------------

    El patron ya paso dos veces —`share` en la T11 y `create` en esta— y las dos
    veces lo tapo un mapa de pendientes escrito a mano por test. Cada una lo escribio
    el test de la entidad que sufria el hueco, asi que **ninguno** de los dos era
    visible para los otros cuatro kinds, y el patron seguia siendo invisible para el
    siguiente.

    Asi que este bloque no es de la carpeta: recorre los kinds que da el registro con
    **todas** las capacidades puestas, saca cada fila que sea una pagina y exige que
    cada pagina este montada o tenga a alguien anotado. Declarar una fila nueva —un
    `page` en `ACCIONES` mas su entrada en el orden de un kind— rompe esto antes de
    que se pierda en el menu.
  */

  /** Las capacidades que alguna accion mira, **leidas del registro**. */
  function capacidades(): Partial<Record<string, boolean>> {
    const caps: Record<string, boolean> = {};

    for (const [, cap] of src(REGISTRO).matchAll(/ctx\.caps\.([a-zA-Z]+)/g)) {
      if (cap !== undefined) caps[cap] = true;
    }

    return caps;
  }

  /**
   * Las paginas que una fila declara y la hoja **no** monta, por kind.
   *
   * Todas las capacidades puestas a proposito: la pregunta es "esta pagina existe?" y
   * no "este call site puede?". Una capacidad apagada esconde la fila, y con ella el
   * hueco —que es como un bug de esta clase se camufla de decision—.
   */
  function huecosPorKind(): Record<string, string[]> {
    const huecos: Record<string, string[]> = {};
    const caps = capacidades();

    for (const kind of Object.keys(ORDEN_POR_KIND) as MenuKind[]) {
      const ctx: MenuContext = {
        kind,
        entity: { id: `${kind}-1`, title: "Peliculas", role: "owner", shared: false },
        caps,
      };
      const montadas = paginasMontadas();

      /*
        Sin `puedeOfrecerse`, y esa omision es el guard entero: ese filtro **saca**
        justamente las paginas que la hoja no monta, asi que aplicarlo seria preguntarle
        al filtro por lo que el filtro esconde. `accionesPara` ya aplica `disponible`,
        que es otra cosa —si el call site puede—, y es la que hay que dejar correr.
        Por eso las capacidades van todas puestas: la pregunta es "esta pagina existe?"
        y no "este call site puede?".
      */
      huecos[kind] = accionesPara(ctx).flatMap((accion) =>
        accion.destino.tipo === "pagina" && !montadas.includes(accion.destino.page)
          ? [accion.destino.page]
          : [],
      );
    }

    return huecos;
  }

  it("toda pagina que una fila declare y la hoja no monte tiene a alguien anotado", () => {
    const sinMontar = [...new Set(Object.values(huecosPorKind()).flat())];

    /*
      Los tres huecos que hubo, y los tres **cerrados**: `create` en la T12, `access`
      en la T8 y `export` en la T9. Los tres son el mismo patron —el registro declara
      una fila que lleva a una pagina desde la T1 y ninguna tarea del plan escribe
      el componente que la monta— y los dos primeros los encontraron sus
      implementadores, no el plan.

      El mapa quedo vacio en su momento, y **no se borro en silencio**: cada entrada
      decia quien cerraba su hueco, que es lo que hacia falta para poder(actualizar
      las cuatro filas de la paridad sin perder nada. El `for` de abajo sigue siendo
      el guard: un hueco nuevo entra sin anotacion y falla nombrandolo.
    */
    const PENDIENTES: Record<string, string> = {};

    for (const page of sinMontar) {
      expect(PENDIENTES[page], `la pagina "${page}" no se monta y nadie la escribe`).toBeTruthy();
    }

    expect(sinMontar.sort()).toEqual([]);
  });

  it("el guard mira de verdad, y no aprueba porque no recorra nada", () => {
    /*
      Un `for` sobre una lista vacia pasa igual que un guard que compara. Se afirma que
      el recorrido entro por los cinco kinds del registro —los nombres salen de
      `ORDEN_POR_KIND`, no de una lista escrita aca— y que las capacidades se leyeron
      del registro y no hardcodeadas: sin `createInside` puesta, la fila de `createHere`
      ni se ofrecia y el hueco de `create` no lo veria nadie.
    */
    expect(Object.keys(capacidades()).sort()).toEqual([
      "createInside",
      "editStates",
      "export",
      "panel",
      "saveAsTemplate",
    ]);
    expect(Object.keys(ORDEN_POR_KIND).sort()).toEqual([
      "bookmark",
      "collection",
      "folder",
      "list",
      "note",
    ]);
    expect(huecosPorKind()).toEqual({
      list: [],
      note: [],
      folder: [],
      collection: [],
      bookmark: [],
    });
  });
});

describe("las filas son los tipos de una lista, y salen de la lista unica", () => {
  it("la pagina lee `LIST_KIND_ORDER` y no escribe los tipos", () => {
    /*
      La razon de que este guard exista esta en `lib/lists/kind.ts` y la repite
      `test/list-kinds.test.ts`: `LIST_KIND_ORDER` es un `ListKind[]` y es **el unico**
      lugar donde se decide el orden —lo leen el formulario de la pantalla de listas, el
      paso de tipo de `CreateSheet` y esta pagina—. Una cuarta copia escrita aca compila,
      no falla, y deja de ofrecer el tablero sin que nadie se entere.
    */
    const codigo = src(PAGINA);

    expect(codigo).toContain('from "@/lib/lists/kind"');
    expect(codigo).toContain("LIST_KIND_ORDER.map(");
    // Y que la etiqueta de la fila salga de la etiqueta de ese tipo.
    expect(codigo).toContain("t(LIST_KIND_LABEL[kind])");
    // Y que no haya una lista de tipos escrita adentro.
    expect(codigo).not.toMatch(/\[\s*['"]tasks['"]\s*,/);
  });

  it("las filas de la hoja vieja eran esas mismas, y el guard mira el bloque congelado", () => {
    /*
      La paridad con `folder-menu-sheet.tsx` se afirma **leyendo** el bloque congelado y
      no escribiendo lo que hacia. Si el fixture dijera otra cosa, estas cuatro lineas
      fallan, que es el unico modo en que un fixture sirve para algo.

      Y las tres cosas que se le preguntan:
      - las filas salen de `LIST_KIND_ORDER`, la lista que hoy leen tres archivos;
      - la etiqueta es `t(LIST_KIND_LABEL[kind])`;
      - y `onPress` **delega el tipo y no cierra nada**: `onCreateInside(kind)`, sin una
        palabra de cerrar. La ultima es la que se pagaria inventando una navegacion.
    */
    expect(TIPOS_DE_LA_HOJA_VIEJA).toContain("LIST_KIND_ORDER.map(");
    expect(TIPOS_DE_LA_HOJA_VIEJA).toContain("label: t(LIST_KIND_LABEL[kind])");
    expect(TIPOS_DE_LA_HOJA_VIEJA).toContain("onCreateInside(kind)");
    expect(TIPOS_DE_LA_HOJA_VIEJA).not.toMatch(/onClose|router|navigation/);
  });

  it("y la pagina nueva hace lo mismo, con otro nombre para el handler", () => {
    // El bloque de la hoja vieja decia `onCreateInside` y el contrato nuevo se llama
    // `crearDentro`; lo que no cambia es la forma: `onPress` devuelve el tipo y no
    // decide nada. Y `CreateSheet` no aparece: es la superficie de tres pasos del
    // boton "+", con `CreateKind` = lista, carpeta, nota y coleccion. Montarla aca
    // seria un formulario dentro de una fila del menu, y ademas duplicaria el paso de
    // elegir el tipo en dos sitios. Este guard existe porque el brief de esta tarea
    // decia lo contrario, y porque es un error que un "envoltorio delgado" deja pasar
    // sin romper nada.
    const codigo = sinComentarios(src(PAGINA));

    expect(codigo).toMatch(/onPress: \(\) => onSelect\(kind\)/);
    expect(codigo).not.toMatch(/onClose|router|navigation|CreateSheet/);
  });

  it("no monta un Sheet: es pagina de la hoja, no panel encima del panel", () => {
    // La hoja vieja montaba el selector como una `Sheet` hermana conmutada por el flag
    // `inside`, que es exactamente el panel-sobre-panel que el repo evita: `Sheet` es
    // un `Modal`. Como `step` de la hoja unica, esta pagina no monta ninguna.
    expect(hojasMontadas(src(PAGINA))).toBe(0);
  });

  it("y los tipos que ofrece son los del contrato, con etiqueta en las dos lenguas", () => {
    // La lista de tipos viene del paquete y las etiquetas son claves de i18n. Esta
    // comprobacion ya la hace `list-kinds.test.ts` para los otros dos selectores; se
    // repite en el archivo de la pagina nueva para que un fallo aqui diga que la
    // pagina esta mal y no "un selector".
    for (const kind of LIST_KIND_ORDER) {
      const clave = LIST_KIND_LABEL[kind];

      expect(dictionaries.es[clave], `${kind} sin etiqueta en castellano`).toBeTruthy();
      expect(dictionaries.en[clave], `${kind} sin etiqueta en ingles`).toBeTruthy();
    }
  });
});

describe("la hoja la monta, y no monta `CreateSheet`", () => {
  it("la pagina existe donde la hoja la busca", () => {
    // El guard de `entity-menu-sheet.test.ts` ya cruza el directorio con
    // `PAGINAS_MONTADAS` para todo el directorio; se repite el path aca para que un
    // fallo diga que la pagina de crear es la que falta y no "una pagina".
    expect(src(PAGINA)).toContain("export function CreatePage");
    expect(paginasMontadas()).toContain("create");
  });

  it("y la hoja la monta cuando la pagina es `create`", () => {
    expect(hoja).toMatch(/pagina === "create" \? <CreatePage onSelect=\{crearDentro\} \/>/);
  });

  it("y en ningun otro sitio", () => {
    // `SharePage` tiene la mitad de este guard porque su caso era el hermano: dos
    // montajes del mismo formulario, uno en la hoja y otro en la pagina. Acá lo que se
    // duplicaria seria el selector de tipos, y la fila seria la misma en dos lugares.
    expect((hoja.match(/<CreatePage/g) ?? []).length).toBe(1);
  });
});

describe("lo que hace la hoja con el tipo, y lo que no hace", () => {
  it("delega el tipo y no cierra el menu", () => {
    /*
      ------------------------------------------------------------------
      POR QUE NO ES UN CORREDOR
      ------------------------------------------------------------------

      `correr` y `correrEnLaPagina` son para **escrituras**: esperan, avisan el fallo
      sin cerrar, y cierran o dejan abierta segun la accion. Elegir el tipo no escribe
      —la lista tiene nombre, y el nombre lo escribe la hoja de creacion que abre el
      call site—, asi que no hay nada que esperar, nada que reintentar y nada que
      decidir aca.

      Por eso el bloque llama al handler directo. Y por eso **no** aparece `onClose` en
      el: si el menu se cierra es porque la pantalla que lo abrio abrio otra cosa, que
      es lo que hacia `onCreateInside`.
    */
    const bloque = bloqueDe("crearDentro");

    expect(bloque).toContain("handler(kind)");
    expect(bloque).not.toMatch(/onClose|router|navigation/);
    expect(bloque).not.toMatch(/correr/);
  });

  it("avisa cuando el handler no llego, y deja el menu abierto", () => {
    /*
      La fila se ofrece porque el `ctx` dice que puede, asi que un handler ausente es
      un call site que se olvido de pasarlo —un fallo de desarrollo, no un caso de
      quien esta usando la app—. `sinHandler()` lo muestra y no cierra, y **sin**
      `Reintentar`: repetir algo que no se puede hacer no es un reintento.

      Y esto **no** es decoracion: cuando la pagina se escribio, ninguna pantalla pasaba
      `createInside`, asi que el camino real era este —la fila se ofrecia y el toque
      avisa—, y por eso la red estaba. Despues lo paso `[workspaceId].tsx` (fix 1 de la
      T12), asi que hoy es el camino de un call site que se olvidara. El contrario —
      esconder la fila porque no hay handler— es el modo de fallo que esta tarea vino a
      cerrar, y por eso el handler **no** decide si la fila se ofrece.
    */
    const bloque = bloqueDe("crearDentro");

    expect(bloque).toContain("sinHandler()");
    // Y el handler sale de los congelados y no de las props: durante los 330 ms de la
    // salida el call site ya devolvio `{}`, y un toque que llega tarde no puede caer
    // en un handler vivo.
    expect(bloque).toContain("handlersVivos.crearDentro");
  });

  it("`MenuHandlers` gana el handler y el registro no", () => {
    /*
      La diferencia entre los dos lados: `crearDentro` se usa **desde adentro** de la
      pagina, como `borrar` desde `DeletePage`, asi que vive en `MenuHandlers` —la
      interfaz que la hoja lee con el reloj del cierre—. `MenuHandlerName` son las
      acciones que el registro apunta con `destino.tipo === "hoja"`, y `createHere` no
      es una: es una pagina. Por eso `crearDentro` **no** va ahi, y este guard lo
      afirma para que agregar el nombre al union no parezca una mejora.
    */
    expect(hoja).toMatch(/crearDentro\?: \(kind: ListKind\) => void;/);
    expect(sinComentarios(src(REGISTRO))).not.toMatch(/"crearDentro"/);
  });

  it("y el adaptador lo pasa tal cual, sin envolverlo", () => {
    // La identidad es el punto: si el adaptador envolviera el callback —para
    // traducir el tipo, para cerrarse, para awaits— esta linea caeria, y con ella la
    // promesa de que la pagina no decide nada.
    const createInside = (_kind: ListKind) => {};
    const menu = menuDeCarpeta(CARPETA, { ...accionesDePrueba, createInside });

    expect(menu.handlers.crearDentro).toBe(createInside);
  });

  it("la capacidad va puesta aunque no haya handler, y las dos mitades se afirman juntas", () => {
    /*
      ------------------------------------------------------------------
      POR QUE ESTE GUARD SIGUE VALIENDO CON LA PANTALLA YA CABLEADA
      ------------------------------------------------------------------

      Porque afirma el contrato del **adaptador**, no el estado de un call site: aqui se
      construye `accionesDeCarpeta` sin `createInside` a proposito, y el adaptador tiene
      que devolver la capacidad puesta y el handler ausente.

      Eso no es lo que hace la app —`[workspaceId].tsx` si lo pasa, desde el fix 1 de la
      T12— sino lo que haria **cualquier** call site que se olvide. Y es justo el caso
      que hay que fijar: si la capacidad dependiera del callback, un call site que se
      olvidara perderia la fila **sin error y sin test rojo**, que es el modo de fallo
      que esta tarea vino a cerrar dos veces. La fila se ofrece y el toque avisa con
      `sinHandler()`, y eso se decide en la hoja, no aqui.

      Y la razon por la que la tentacion existe: es lo que hace `nota.ts` con
      `saveAsTemplate`, y ahi tiene sentido porque no hay ninguna otra pantalla que abra
      ese menu. Para "crear aqui" si la hay.
    */
    const menu = menuDeCarpeta(CARPETA, accionesDePrueba);

    expect(menu.ctx?.caps.createInside).toBe(true);
    expect(menu.handlers.crearDentro).toBeUndefined();
  });

  it("el subtitulo de la pagina lo pone la hoja, y es el de la hoja vieja", () => {
    /*
      La hoja vieja titulaba el panel de los tipos con `t("lists.createHere")` y le
      ponia el nombre de la carpeta de subtitulo. El titulo de esta hoja es el nombre
      de la entidad —la carpeta—, asi que sin esta entrada la cabecera de la pagina sale
      con el nombre de la carpeta y nada mas, y las seis filas no dicen donde van a
      parar.

      Y la clave tiene que estar en **las dos** lenguas: una que esta en `es` y no en
      `en` compila y sale con la llave puesta en ingles.
    */
    expect(hoja).toMatch(/create: "lists\.createHere"/);
    expect(dictionaries.es["lists.createHere"]).toBeTruthy();
    expect(dictionaries.en["lists.createHere"]).toBeTruthy();
    // Y la pagina no dice nada del titulo: el subtitulo lo pinta el `Sheet`, que es
    // el padre, y una pagina no puede dictarselo a quien la contiene.
    expect(sinComentarios(src(PAGINA))).not.toMatch(/subtitle|title=/);
  });
});
