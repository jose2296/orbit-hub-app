import { describe, expect, it } from "vitest";

import { menuDeCarpeta } from "@/lib/menus/carpeta";
import type { AccionesDeCarpeta } from "@/lib/menus/carpeta";
import { ACCIONES, accionesPara } from "@/lib/menus/registry";
import { puedeOfrecerse } from "@/lib/menus/paginas";
import type { Folder } from "@orbit-hub/contracts";

import { RAIZ, sinComentarios, src } from "./menus-test-helpers";

/**
 * `createInside` en la pantalla del espacio: **la fila esta, y hay que saber donde cae
 * lo que se crea**.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO Y NO UNO MAS DENTRO DE `create-page.test.ts`
 * ------------------------------------------------------------------
 *
 * Porque lo que se afirma aca no es de la pagina sino de **quien la monta**: que la
 * pantalla pase el handler, que el destino sobreviva al `Sheet` de en medio, y que
 * las dos puertas de esta pantalla —el boton "+" y el menu de una carpeta— digan cada
 * una donde crean. `create-page.test.ts` afirma la costura del menu; este afirma la de
 * la pantalla, y un fallo tiene que poder decir "la fila vuelve pero la lista cae en el
 * espacio".
 *
 * ------------------------------------------------------------------
 * EL FALLO QUE ESTE ARCHIVO EXISTE PARA QUE NO PASE
 * ------------------------------------------------------------------
 *
 * `onCreate` tenia `folderId: null` —y `parentId: null`— en **las cinco** ramas, y eso
 * no es un valor por defecto: `createList` documenta que "`null` es el espacio mismo,
 * que es la carpeta raiz". O sea que un `null` ahi es una afirmacion, y la afirmacion
 * es falsa cuando la persona aprieto "Crear una lista aqui" en una carpeta.
 *
 * El resultado no es un error: es una lista creada **en el sitio que no se pidio**, y
 * una lista creada se ve, asi que nadie se entera. Es peor que la fila perdida del
 * `f371442`, que al menos se notaba.
 */

const PANTALLA = "src/app/(app)/workspace/[workspaceId].tsx";
const CARPETA_PANTALLA = {
  id: "f1",
  name: "Peliculas",
  parentId: null,
  position: 0,
} as Folder;

const accionesDePrueba: AccionesDeCarpeta = {
  layout: [],
  save: () => {},
  updateFolder: () => {},
  deleteFolder: () => {},
  listCount: 3,
  t: (clave) => clave,
};

/** El codigo de la pantalla sin sus comentarios, que nombran las mismas cosas. */
const codigo = sinComentarios(src(PANTALLA));

/**
 * Los `<FloatingButton ...>` de la pantalla, con lo que hay hasta su `/>`.
 *
 * Recorta por elemento y no mira el archivo entero por la razon que ya esta escrita en
 * `note-folder-menu-parity.test.ts`: esta pantalla monta muchos `EntityMenuSheet` y una
 * afirmacion sobre el fuente entero afirmaria sobre todos.
 */
function botonesFlotantes(): string[] {
  const encontrados: string[] = [];
  const abrir = "<FloatingButton";
  let desde = codigo.indexOf(abrir);

  while (desde >= 0) {
    const hasta = codigo.indexOf("/>", desde);

    encontrados.push(codigo.slice(desde, hasta < 0 ? codigo.length : hasta + 2));
    desde = codigo.indexOf(abrir, desde + abrir.length);
  }

  return encontrados;
}

/**
 * El handler `createInside` del adaptador, como lo escribe la pantalla.
 *
 * Se recorta desde el nombre de la prop hasta el cierre del objeto que la recibe, y
 * no se parsea el callback entero: lo que se afirma es que **pasa el destino**, no como
 * esta escrito el resto.
 */
function bloqueDeCreateInside(): string {
  const desde = codigo.indexOf("createInside:");

  if (desde < 0) throw new Error("la pantalla no pasa createInside a menuDeCarpeta");

  // El `},\n  });` que cierra el objeto de `acciones`: el handler es la ultima
  // propiedad, asi que el cierre del objeto es tambien el del handler.
  const hasta = codigo.indexOf("},\n  });", desde);

  if (hasta < 0) throw new Error("no se encontro el cierre del objeto que recibe createInside");

  return codigo.slice(desde, hasta);
}

/** El cuerpo de `onCreate`, del `useCallback` a su cierre. */
function bloqueDeOnCreate(): string {
  const desde = codigo.indexOf("const onCreate = useCallback(");
  const hasta = codigo.indexOf("]);", desde);

  if (desde < 0 || hasta < 0) throw new Error("la pantalla no declara onCreate como se espera");

  return codigo.slice(desde, hasta);
}

describe("la pantalla pasa el handler, y la fila deja de avisar un error", () => {
  it("la pantalla le pasa `createInside` al adaptador de carpeta", () => {
    // El bug del `f371442`: `MenuHandlers.crearDentro` existia, `menuDeCarpeta` lo
    // reenviaba y ninguna pantalla lo pasaba, asi que la fila —que ya se ofrecia—
    // caia en `sinHandler()` al tocarla. "Error inesperado" en una fila que dice
    // "Crear una lista aqui".
    expect(codigo).toContain("createInside:");
    expect(codigo).toMatch(/createInside: \(kind\) =>/);
  });

  it("y el handler llega al `MenuHandlers` de la hoja, no a otro lado", () => {
    // La identidad de la ruta completa, de punta a punta y sin renderizar: la pantalla
    // pasa un callback, el adaptador lo reenvia y la hoja lo lee por su nombre. Los
    // tres nombres aparecen, y el ultimo es el que la pagina consume.
    const menu = menuDeCarpeta(CARPETA_PANTALLA, {
      ...accionesDePrueba,
      createInside: () => {},
    });

    expect(menu.handlers.crearDentro).toBeTypeOf("function");
    expect(src("src/components/menus/entity-menu-sheet.tsx")).toContain(
      "handlersVivos.crearDentro",
    );
    expect(src("src/components/menus/entity-menu-sheet.tsx")).toContain(
      "<CreatePage onSelect={crearDentro} />",
    );
  });

  it("y la fila se ofrece, que es lo que la hace necesitar el handler", () => {
    // Si la fila no se ofreciera, que no se pase `createInside` seria correcto. Se
    // afirma el otro lado del mismo hecho: la fila esta, asi que el handler hace falta.
    const ctx = menuDeCarpeta(CARPETA_PANTALLA, accionesDePrueba).ctx;

    expect(accionesPara(ctx!).filter(puedeOfrecerse).map((accion) => accion.id)).toContain(
      "createHere",
    );
    expect(ACCIONES.createHere?.destino).toEqual({ tipo: "pagina", page: "create" });
  });
});

describe("el destino de la creacion es un parametro, y la raiz es un valor", () => {
  it("`onCreate` no tiene ningun `null` de destino adentro", () => {
    /*
      ------------------------------------------------------------------
      EL `null` NO ERA UN DEFAULT
      ------------------------------------------------------------------

      `createList` lo documenta en su propio contrato: "`null` es el espacio mismo, que
      es la carpeta raiz". O sea que `folderId: null` escrito adentro de `onCreate` es una
      afirmacion —"esto va en la raiz"— y no un "no se". Cuando la persona aprieto "Crear
      una lista aqui" en una carpeta, esa afirmacion es falsa: la lista se creaba **en el
      sitio que no se pidio, sin fallar**.

      Y el fallo no se ve, que es lo que lo hace grave: una lista creada aparece en el
      espacio, que es donde se ven las listas, asi que parece que funciono.

      El `parentId` va con el: es la rama de **crear una carpeta**, y dice `parentId` en vez
      de `folderId` porque una carpeta cuelga de `parentId`. "Crear aqui" ofrece hoy un
      tipo de lista, pero la accion es "crear dentro de esta carpeta" y el dia que
      ofrezca tambien una nota o una carpeta tienen que ir al mismo sitio. Dejar
      `parentId: null` seria dejar la mitad de la accion con el destino equivocado para
      siempre.
    */
    const cuerpo = bloqueDeOnCreate();

    expect(cuerpo, "folderId: null dentro de onCreate").not.toMatch(/folderId: null/);
    expect(cuerpo, "parentId: null dentro de onCreate").not.toMatch(/parentId: null/);
  });

  it("las cuatro ramas leen el destino, y no solo la de lista", () => {
    /*
      ------------------------------------------------------------------
      CUATRO LLAMADAS, Y POR QUE NO ES UNA LISTA ESCRITA ACa
      ------------------------------------------------------------------

      El numero sale de lo que hay: se cuentan las llamadas a los actions de creacion
      dentro de `onCreate` y se mira que **cada una** pase el destino. El mapa
      `accion -> campo del destino` sale del nombre de la llamada —`createFolder` dice
      `parentId` porque una carpeta cuelga de `parentId`, los otros tres dicen
      `folderId`—, asi que el guard no tiene una lista escrita que se pueda quedar
      vieja.

      Por que cuenta la llamada y no la rama del `if`: porque el `folderId: null` estaba
      en las cuatro y un guard que solo mirara la de lista pasaria. Y por que la de
      carpeta va aparte: es la unica con `parentId`, y es la que mas se pierde de vista
      porque "crear aqui" hoy ofrece tipos de lista.
    */
    const cuerpo = bloqueDeOnCreate();
    const acciones = cuerpo.match(/await create(?:Folder|List|Note|CollectionAction)\(\{/g) ?? [];

    // Que sean cuatro y no tres: una llamada menos seria una rama que dejo de crear.
    expect(acciones).toHaveLength(4);
    // Y las cuatro leen el destino —una vez por llamada, mas una en las dependencias
    // del `useCallback`, que es lo que cuenta la quinta.
    expect(cuerpo.match(/createFolderId/g) ?? []).toHaveLength(5);

    // Y cada llamada con su campo.
    expect(cuerpo).toContain("await createFolder({ name: trimmed, parentId: createFolderId });");
    expect(cuerpo.match(/folderId: createFolderId,/g) ?? []).toHaveLength(3);
  });

  it("el estado distingue 'la raiz' de 'todavia no se'", () => {
    // `string | null` y no `string`: `null` es lo que los cuatro actions leen como la
    // raiz, asi que un string vacio obligaria a inventar un centinela que no existe del
    // otro lado del contrato. Y `useState<string | null>(null)` deja el default en la
    // raiz, que es donde crea el boton "+" sin tocar nada.
    expect(codigo).toMatch(/useState<string \| null>\(null\)/);
  });

  it("y el destino viaja en las dependencias del `useCallback`", () => {
    // Sin esto la funcion se cerraria sobre el `null` del primer render para siempre, y
    // la lista caeria en la raiz **siempre** —con el typecheck en verde y todos los
    // tests en verde—, porque `createFolderId` es el valor que cambia.
    const cuerpo = bloqueDeOnCreate();
    const deps = cuerpo.slice(cuerpo.lastIndexOf("[", cuerpo.length));

    expect(deps).toContain("createFolderId,");
  });
});

describe("las dos puertas dicen donde crean, y cada una la suya", () => {
  it("el boton \"+\" crea en la raiz, y lo dice", () => {
    /*
      ------------------------------------------------------------------
      POR QUE ESTO NO ES "QUE NO QUEDE UN NULL"
      ------------------------------------------------------------------

      Porque el boton "+" **necesita** un destino tambien: el `onCreate` es el mismo
      para las dos puertas, asi que si el boton no dijera el suyo heredaria el de la
      apertura anterior. Un guard que solo afirmara "no hay `folderId: null` en el
      archivo" pasaria con un boton que no dice nada y depende del reset.

      Y hay dos `<FloatingButton>` porque hay dos `return`: el de "espacio no encontrado"
      y el del resto. Se afirman los dos.
    */
    const botones = botonesFlotantes();

    expect(botones.length).toBeGreaterThan(0);

    for (const boton of botones) {
      expect(boton, "el boton + no dice donde crea").toContain("setCreateFolderId(null)");
    }
  });

  it("y el camino de la carpeta pasa la carpeta de **esa** carpeta", () => {
    /*
      La otra mitad del mismo par. El handler tiene que leer el id de la carpeta del menu
      abierto —`carpetaDelMenu.id`, no un id suelto— porque es la carpeta que la persona
      tiene delante. Y tiene que leer el **campo de la fila**, no el `folder` de otra
      variable: `carpetaDelMenu` es el unico nombre que esta pantalla le da a "la carpeta
      del menu que esta abierto", asi que el guard puede exigir ese nombre y no un
      `id` cualquiera.
    */
    const bloque = bloqueDeCreateInside();

    expect(bloque).toContain("setCreateFolderId(carpetaDelMenu.id)");
    expect(bloque).not.toContain("setCreateFolderId(null)");
  });

  it("las dos mitades del par, y no una aproximacion", () => {
    // El par entero en un solo guard, porque cada mitad sola se puede satisfacer con un
    // archivo donde la otra puerta esta rota: la fila vuelve a ofrecerse con el handler
    // puesto pero la lista cae en el espacio, o el destino esta bien pero la fila avisa
    // un error. El fallo que hay que cazar necesita las dos en verde para pasar.
    const menu = menuDeCarpeta(CARPETA_PANTALLA, {
      ...accionesDePrueba,
      createInside: () => {},
    });
    const acciones = menu.ctx
      ? accionesPara(menu.ctx).filter(puedeOfrecerse).map((accion) => accion.id)
      : [];

    expect(acciones).toContain("createHere");
    expect(menu.handlers.crearDentro).toBeTypeOf("function");
    expect(bloqueDeCreateInside()).toContain("setCreateFolderId(carpetaDelMenu.id)");
    expect(bloqueDeOnCreate()).not.toMatch(/folderId: null|parentId: null/);
  });

  it("y el handler no cae en la raiz cuando no hay carpeta", () => {
    /*
      El `if (!carpetaDelMenu) return` va **antes** del `setCreateFolderId`, y no es
      defensa teorica: `carpetaDelMenu` es `menuFor?.kind === "folder" ? menuFor.folder
      : null`, o sea que puede ser `null` si el menu se cerro entre que se abrio y que
      se toco. Un `?? null` ahi crearia en la raiz, que es exactamente el fallo que este
      handler arregla. Un `return` callado es preferible a una lista en el sitio que no
      se pidio.
    */
    const bloque = bloqueDeCreateInside();
    const guarda = bloque.indexOf("if (!carpetaDelMenu) return;");
    const destino = bloque.indexOf("setCreateFolderId(carpetaDelMenu.id)");

    expect(guarda).toBeGreaterThan(-1);
    expect(guarda, "la guarda tiene que ir antes de poner el destino").toBeLessThan(destino);
  });
});

describe("el destino sobrevive a la hoja de en medio, y se limpia con ella", () => {
  it("el handler pone el destino antes de abrir la hoja, y no despues", () => {
    /*
      ------------------------------------------------------------------
      EL ORDEN, Y POR QUE `closeSheets` NO SIRVE ACA
      ------------------------------------------------------------------

      Entre que la persona elige el tipo y aprieta Crear hay un `Sheet` entero en el
      medio, con su propio borrador de nombre —que vive en la pantalla por el mismo
      motivo—. El destino es del mismo genero: pertenece a la apertura, no al envio.

      Y por eso el handler **no** llama `closeSheets()`: esa funcion limpia
      `createFolderId`, o sea que si se usara para cerrar el menu de la carpeta borraria
      el destino que recien se puso y la lista caeria en la raiz. Por eso cierra el menu
      suelto —`setMenuFor(null)`— y pone el destino en el mismo paso.

      Y el orden importa entre las dos lineas: primero el destino, despues
      `setCreateOpen(true)`. Al reves, la hoja se abriria con el destino del render
      anterior, que es `null` salvo que se este abriendo encima de otra apertura.
    */
    const bloque = bloqueDeCreateInside();

    expect(bloque, "cerrar con closeSheets borraria el destino").not.toContain("closeSheets()");
    expect(bloque).toContain("setMenuFor(null)");

    expect(bloque.indexOf("setCreateFolderId")).toBeLessThan(bloque.indexOf("setCreateOpen(true)"));
  });

  it("`closeSheets` lo devuelve a la raiz, y con las demas piezas", () => {
    /*
      ------------------------------------------------------------------
      EL CICLO QUE SE ROMPE SI ESTO FALTA
      ------------------------------------------------------------------

      "Crear aqui" en la carpeta `Peliculas`, cerrar, apretar "+", crear una lista: el
      `folderId` sigue siendo `Peliculas` y la lista nueva cae adentro, sin error y sin
      que nadie la haya pedido ahi.

      Por eso el boton "+" pone `null` explicito **ademas** de este reset: el reset es
      lo que limpia, y el `null` explicito es lo que hace que el boton no dependa de
      una cadena de tres pasos. Los dos estan, y los dos se afirman.
    */
    const desde = codigo.indexOf("const closeSheets = useCallback(");
    const hasta = codigo.indexOf("}, []);", desde);
    const bloque = codigo.slice(desde, hasta);

    expect(bloque).toContain("setCreateFolderId(null)");
    // Y con el resto del bloque, que es lo que hacia: si el reset viviera suelto, la
    // hoja y el destino se limpiarían en momentos distintos.
    expect(bloque).toContain("setCreateOpen(false)");
    expect(bloque).toContain("setCreateKind(null)");
    expect(bloque).toContain('setTitle("")');
  });

  it("y el handler abre la hoja en el paso de detalles, con el tipo puesto", () => {
    // El paso y el tipo: es lo que hacia la hoja vieja —`setCreateStep("details")` con el
    // kind ya elegido— y sin el se abriria en "que vas a crear", que pregunta otra vez
    // lo que el menu acaba de preguntar.
    const bloque = bloqueDeCreateInside();

    expect(bloque).toContain("setCreateKind(kind)");
    expect(bloque).toContain('setCreateStep("details")');
    // Y sin origen: no se abrio desde un boton, asi que no tiene de donde crecer.
    expect(bloque).toContain("setCreateOrigin(null)");
  });
});

describe("lo que esta pantalla no decide", () => {
  it("no decide si se puede crear aqui: eso es del registro", () => {
    /*
      La capacidad y el handler son las dos mitades de la misma fila —es el reparto que
      ya hacen `nota.ts` y `lista.ts`—, y la capacidad la lee el registro. Si esta
      pantalla escribiera un `if (role === ...)` para la fila, la regla tendria dos
      casas y la que se desincroniza es la que no tiene test.

      Se mira el **codigo sin los comentarios**, que nombran el registro y el rol, y la
      razon es la de siempre: la prosa del archivo se encontraria con su propio
      `not.toMatch`.
    */
    expect(codigo).not.toMatch(/role|disponible|motivo|createInside !==/);
    // Y que la regla exista y funcione, para que el guard de arriba no approve con el
    // registro vacio.
    expect(ACCIONES.createHere?.disponible?.({
      kind: "folder",
      entity: { id: "f1", title: "Peliculas", role: "viewer", shared: false },
      caps: { createInside: true },
    })).toBe(true);
  });

  it("no inventa la navegacion: el menu de la carpeta no es una ruta", () => {
    // Ni `router.push`, ni un `navigate`, ni una pantalla nueva: "crear aqui" abre la
    // hoja que esta pantalla ya tiene y le pasa el destino. Lo que la persona ve es la
    // hoja de creacion de siempre, con el nombre y el tipo ya puestos.
    const bloque = bloqueDeCreateInside();

    expect(bloque).not.toMatch(/router|navigation|navigate/);
  });

  it("y el `folder` del menu se sigue leyendo de ahi, no de un parametro suelto", () => {
    // `carpetaDelMenu` es el nombre que esta pantalla le da a "la carpeta del menu
    // abierto", y el handler lo lee de ahi. Un `id` suelto seria el valor correcto con
    // la variable equivocada, y el dia que el menu de una carpeta sea de otro sitio el
    // handler seguia compilando.
    expect(codigo).toContain(
      "const carpetaDelMenu = menuFor?.kind === \"folder\" ? menuFor.folder : null;",
    );
    expect(bloqueDeCreateInside()).toContain("carpetaDelMenu");
  });

  it("la pantalla sigue montando el menu del registro, no una hoja propia", () => {
    // La carpeta de esta pantalla no cambio de superficie: lo que cambio es que ahora
    // tiene el handler que le faltaba. El guard esta porque el camino deerial para
    // resolver "no hay handler" es abrir otra hoja, y eso seria volver a los seis
    // paneles hermanos que la T7 borro.
    expect(codigo).toContain("EntityMenuSheet");
    expect(codigo).not.toContain("FolderMenuSheet");
    expect(codigo).not.toContain("CreateKind = ListKind");
  });

  it("y la raiz del repo no se movio, que es donde vive el archivo que se lee", () => {
    // El path de la pantalla tiene corchetes y parentesis, y un `join` mal hecho lo
    // convierte en algo que no existe y `readFileSync` lanza. Si este guard falla, el
    // problema es el path del test y no el codigo de la pantalla.
    expect(RAIZ.endsWith("apps/mobile")).toBe(true);
    expect(codigo.length).toBeGreaterThan(0);
  });
});