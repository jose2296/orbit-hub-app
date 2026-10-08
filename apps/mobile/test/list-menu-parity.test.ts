import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ACCIONES, ORDEN_POR_KIND, accionesPara, resuelveLabel } from "@/lib/menus/registry";
import type { MenuContext } from "@/lib/menus/registry";
import { puedeOfrecerse } from "@/lib/menus/paginas";

import { BLOQUE_DE_LA_HOJA_VIEJA } from "./fixtures/list-menu-sheet-options";
import { PAGINAS, RAIZ, paginasMontadas, src } from "./menus-test-helpers";

/**
 * ------------------------------------------------------------------
 * POR QUE ESTE TEST PARSEA UN ARCHIVO Y NO ESCRIBE UNA LISTA
 * ------------------------------------------------------------------
 *
 * Porque la T6 borra `list-menu-sheet.tsx` y un guard que lee un archivo que se
 * guardo se queda comprobando nada sin avisar. El bloque `options` de la hoja vieja
 * esta congelado en `fixtures/list-menu-sheet-options.ts` y **se parsea aca**, con
 * el mismo filtro con que se extrajo: las etiquetas no estan escritas, estan leidas.
 *
 * Escritas a mano seriam una copia del registro que se desincroniza en silencio: el
 * dia que el registro cambie, el test seguiria diciendo que las nueve estan y
 * estaria mintiendo sobre algo que el mismo test puede comprobar.
 */

/** Un tablero, con todo lo que el registro puede ofrecerle a una lista. */
const LISTA: MenuContext = {
  kind: "list",
  entity: { id: "l1", title: "Peliculas", role: "owner", shared: false },
  caps: { panel: true, export: true, editStates: true },
};

/** La misma, prestada: no es del dueno y no se borra. */
const PRESTADA: MenuContext = {
  ...LISTA,
  entity: { ...LISTA.entity, role: "editor", shared: true },
};

/** Las cuatro pantallas que montaban la hoja vieja. */
const CALL_SITES = [
  "src/app/(app)/list/[listId].tsx",
  "src/app/(app)/board/[listId].tsx",
  "src/app/(app)/workspace/[workspaceId].tsx",
  "src/components/media/media-list-screen.tsx",
];

const ADAPTADOR = "src/lib/menus/lista.ts";
const HOJA = "src/components/menus/entity-menu-sheet.tsx";
const HOJA_VIEJA = "src/components/lists/list-menu-sheet.tsx";

const hay = (ruta: string) => existsSync(join(RAIZ, ruta));

/**
 * Los fuente de **todos** los elementos JSX de un nombre, y no el archivo entero.
 *
 * Existe porque estas pantallas montan varias hojas y un `not.toContain` sobre el
 * archivo entero afirma sobre las cuatro: la pantalla del espacio pasa `onDeleted`
 * a la hoja del espacio, y eso no dice nada sobre el menu de lista que esta veinte
 * lineas mas abajo. Es el mismo error que `sinComentarios` —un guard que mira mas
 * de lo que dice— en su otra forma: aca por sobrecarga, no por prosa.
 *
 * Y son **todos** y no el primero porque la pantalla del espacio monta dos
 * `EntityMenuSheet` —el de la coleccion y el de la lista— y adivinar cual de los
 * dos es el que importa seria escribir en el test la regla que deberia estar en el
 * codigo. Lo que se afirma no es "el menu de lista dice tales cosas" sino "ningun
 * `EntityMenuSheet` de esta pantalla recibe algo que la hoja no tiene", y eso si se
 * puede afirmar sin adivinar.
 */
function elementos(fuente: string, nombre: string): string[] {
  const encontrados: string[] = [];
  const abrir = `<${nombre}`;
  let desde = fuente.indexOf(abrir);

  while (desde >= 0) {
    const hasta = fuente.indexOf("/>", desde);

    encontrados.push(fuente.slice(desde, hasta < 0 ? fuente.length : hasta + 2));
    desde = fuente.indexOf(abrir, desde + abrir.length);
  }

  return encontrados;
}

/**
 * Las filas de la hoja vieja, con las etiquetas que cada una pintaba.
 *
 * Se parte el bloque por cada `key`, y de cada trozo se saca el `label` **con lo que
 * sea que siga hasta la propiedad siguiente**: una fila cuyo copy depende del estado
 * —`pin`, `delete`— es un ternario con dos claves, y un filtro que solo aceptara la
 * primera contaria siete etiquetas en vez de nueve.
 */
function filasDeLaHojaVieja(): { fila: string; etiquetas: string[] }[] {
  const CLAVE = /key: "([^"]+)"/;
  const ETIQUETA =
    /label:([\s\S]{0,200}?),?\n\s*(icon|description|disabled|tone|onPress|key):/g;
  const CLAVE_I18N = /t\(\s*"([^"]+)"/g;

  const filas = BLOQUE_DE_LA_HOJA_VIEJA.split(/(?=key: ")/)
    .slice(1)
    .flatMap((trozo) => {
      const fila = CLAVE.exec(trozo)?.[1];

      /*
        Sin `key` legible el trozo no es una fila y se descarta: es un fragmento del
        bloque que el filtro de arriba metio y que no es una opcion. Se descarta
        **aca** y no en el `expect`, porque un nombre vacio en un mensaje de fallo no
        dice que archivo se rompio —y este archivo no tiene otra forma de avisar.
      */
      if (!fila) return [];

      const etiquetas: string[] = [];
      for (const encontrado of trozo.matchAll(ETIQUETA)) {
        for (const clave of (encontrado[1] ?? "").matchAll(CLAVE_I18N)) {
          if (clave[1]) etiquetas.push(clave[1]);
        }
      }

      return [{ fila, etiquetas }];
    });

  return filas;
}

/** La etiqueta de un id, ya resuelta para el contexto que hace falta. */
function etiquetaDe(id: string, ctx: MenuContext): string | undefined {
  return ACCIONES[id] ? resuelveLabel(ACCIONES[id], ctx) : undefined;
}

/**
 * Todas las etiquetas que una fila puede decir, **en los dos estados que la
 * distinguen**.
 *
 * Sin esto, `pin` y `delete` darían un falso negativo que parece una fila perdida
 * y no lo es: las dos son una fila con un ternario en el `label` —pineada o no,
 * prestada o no— y el registro las guarda como una o dos entradas segun si el
 * estado es de la entidad (`shared`) o de la pantalla (`pinned`). Comparar los
 * conjuntos es lo que hace que las dos mitaxes queden cubiertas por el mismo guard.
 */
function etiquetasDeLaFila(fila: string): string[] {
  const delOtroEstado = fila === "pin" ? [etiquetaDe("unpin", LISTA)] : [];

  return [
    ...new Set(
      [LISTA, PRESTADA].flatMap((ctx) => [etiquetaDe(fila, ctx), ...delOtroEstado]),
    ),
  ].filter((clave): clave is string => clave !== undefined).sort();
}

describe("lo que la hoja vieja ofrecia, leido de su fuente", () => {
  it("siete filas y nueve etiquetas, y el numero no esta escrito a mano", () => {
    const filas = filasDeLaHojaVieja();

    expect(filas.map((fila) => fila.fila)).toEqual([
      "states",
      "rename",
      "pin",
      "duplicate",
      "share",
      "export",
      "delete",
    ]);
    // El nueve del brief son nueve **etiquetas**, no nueve filas: `pin` y `delete`
    // son dos cada una, porque una fila que cambia de copy con el estado tiene dos
    // etiquetas. Y este numero sale de contar, no de escribir.
    expect(filas.flatMap((fila) => fila.etiquetas)).toHaveLength(9);
  });

  it("las nueve etiquetas son las que el brief nombra", () => {
    // La lista del brief, escrita, contra la lista leida. Si el fixture y el brief
    // se separan, esta linea lo dice; si el fixture se cambia a mano, tambien.
    const leidas = filasDeLaHojaVieja().flatMap((fila) => fila.etiquetas);

    expect(leidas).toEqual([
      "board.editStates",
      "common.rename",
      "lists.unpinFromDashboard",
      "lists.pinToDashboard",
      "lists.duplicate",
      "share.title",
      "export.list.title",
      "common.deleteNotYours",
      "common.delete",
    ]);
  });
});

describe("cada fila de la hoja vieja sigue declarada", () => {
  it("la fila existe en el registro con el mismo nombre", () => {
    for (const { fila } of filasDeLaHojaVieja()) {
      expect(ACCIONES[fila], `el registro no declara "${fila}"`).toBeTruthy();
    }
  });

  it("y dice exactamente lo mismo, salvo la fila de compartir", () => {
    /*
      ------------------------------------------------------------------
      LA UNICA DIVERGENCIA, Y POR QUE NO SE ARREGLA ACA
      ------------------------------------------------------------------

      La hoja de lista decia `share.title` —"Compartir {name}", con el nombre de
      la lista dentro— y el registro dice `share.pickSomeone` —"Con quién"—. La
      chose la T1, y **no es un error de T6**: `note-menu-sheet.tsx:286` y
      `folder-menu-sheet.tsx:175` ya decian `share.pickSomeone`, o sea que dos de
      las tres hojas coinciden con el registro y la lista era la que se diferenciaba.

      Igualar las tres hacia falta tocar `registry.tsx`, que esta fuera de la
      superficie de esta tarea, asi que queda escrita y no borrada en silencio: el
      guard de arriba afirma que la fila **sigue existiendo** —que es lo que no se
      puede perder— y este dice que el copy cambio y por que.

      Y la fila de compartir, que era el unico caso en que la perdida se **veia**:
      mientras la pagina no existia el filtro la sacaba entera, y entonces compartir
      una lista dejo de estar en el menu sin error en ninguna parte. La T11 escribio
      la pagina. Igualar las tres etiquetas necesita `registry.tsx`, que sigue
      estando fuera de la superficie: la divergencia de copy queda, la **fila** ya
      no.

      La comparacion es de **conjuntos y no etiqueta por etiqueta**, y eso no es un
      detalle: `pin` y `delete` son dos filas con dos etiquetas cada una, porque su
      copy depende del estado. Compararlas de a una daria un falso negativo —"la fila
      `delete` ya no dice `common.delete`" cuando lo que pasa es que la estoy
      mirando con la lista prestada— y ese falso negativo es exactamente el ruido
      que hace que un guard de migracion se apague.
    */
    const DIVERGE: Record<string, string> = { "share.title": "share.pickSomeone" };
    const declaradas = filasDeLaHojaVieja();

    for (const { fila, etiquetas } of declaradas) {
      const esperadas = etiquetas.map((clave) => DIVERGE[clave] ?? clave).sort();
      const delRegistro = etiquetasDeLaFila(fila);

      expect(delRegistro, `la fila "${fila}" no dice lo que decia`).toEqual(esperadas);
    }
  });

  it("y el registro no le muestra a una lista ninguna etiqueta que la hoja vieja no tuviera", () => {
    /*
      La comparacion por los dos lados, porque una de fila por fila no avisa si
      aparecio algo. Las diferencias son **tres** y ninguna es una fila perdida:

      - `icons.title`, la de `icon`: la hoja vieja tenia el selector **adentro de la
        pagina de renombrar** (`list-menu-sheet.tsx:552-573`) y el registro lo sube a
        fila propia. No esta en la lista del brief porque esa lista es lo que la hoja
        vieja tenia, pero si aparece aca, y esta bien que aparezca.
      - `menus.access`, la de `access`: el registro la declaro en la T1 y su pagina
        es de la T8.
      - `share.pickSomeone`: el copy de la divergencia de arriba.

      Lo que este guard forbids es una cuarta: una etiqueta que el registro le
      muestre a una lista y que la hoja vieja no le mostrara nunca.
    */
    const deLaHojaVieja = new Set(
      filasDeLaHojaVieja().flatMap((fila) => fila.etiquetas),
    );
    const delRegistro = new Set(
      ORDEN_POR_KIND.list.flatMap((id) => etiquetasDeLaFila(id)),
    );

    expect([...delRegistro].filter((clave) => !deLaHojaVieja.has(clave)).sort()).toEqual([
      "icons.title",
      "menus.access",
      "share.pickSomeone",
    ]);
  });
});

describe("el orden y lo que se ofrece", () => {
  /*
    Lo que la hoja **pinta**, y no lo que el registro declara.

    `accionesPara` responde "que filas existen y se pueden usar", que es una
    pregunta del modelo; `puedeOfrecerse` responde "cuales puede pintar esta version
    de la hoja", que es una pregunta del estado del trabajo. Comparar contra la
    primera y esperando la segunda es el error que hace que un test de migracion
    cuente filas que nadie ve.
  */
  const pintadas = (ctx: MenuContext) => accionesPara(ctx).filter(puedeOfrecerse).map((a) => a.id);

  it("un tablero ofrece las filas que ofrecia, mas la de icono", () => {
    /*
      Las siete de la hoja vieja y la de icono, y **`share` esta entre ellas desde
      la T11**: `PAGINAS_MONTADAS` la inclui, o sea que el filtro ya no la saca. Esta
      linea estuvo diciendo seis, con un comentario al lado que explicaba por que
      faltaba una —"la pagina la escribe una tarea que no existe en el plan"—, y la
      perdida se veía **igual que el filtro**: por eso quedo escrita con nombre en el
      bloque de abajo en vez de solo anotada aca.
    */
    expect(pintadas(LISTA)).toEqual([
      "states",
      "rename",
      "icon",
      "pin",
      "duplicate",
      "share",
      "delete",
    ]);
  });

  it("una lista que no es tablero no ofrece la fila de estados", () => {
    const sinTablero: MenuContext = { ...LISTA, caps: { ...LISTA.caps, editStates: false } };

    expect(pintadas(sinTablero)).not.toContain("states");
  });

  it("una lista prestada no puede compartir ni borrar, y las dos lo dicen", () => {
    /*
      Los `!` de abajo no son ruido: `ACCIONES` es un `Record<string, MenuAccion>` y
      el registro lo declaro asi **a proposito** —el comentario de `ACCIONES` dice que
      un id descolocado tiene que ser un error de escritura y no de orden—, asi que
      indexarlo da `MenuAccion | undefined`. Un `!` aca no es "silenciar el
      compilador": es decir que el id existe, y si mañana no existiera el test falla
      con `undefined` en vez de romperse en el `expect`.
    */
    /*
      La Review Focus #1: una accion que no se puede **y explica por que** se queda
      en la lista para que la hoja la dibuje apagada con el motivo en `description`,
      porque esconderla deja a la persona creyendo que no existe en vez de que existe
      y no es suya. Compartir y borrar tienen las dos motivo escrito.

      Y lo que se mira es `accionesPara`, **no** `pintadas`: compartir no se pinta
      hoy porque su pagina no existe —abajo esta escrito que ninguna tarea del plan
      la escribe—, y si este guard mirara lo que se pinta estaria afirmando que la
      fila de compartir no existe, que es falso.
    */
    const ids = accionesPara(PRESTADA).map((accion) => accion.id);
    const compartir = ACCIONES.share!;
    const borrar = ACCIONES.delete!;

    expect(ids).toContain("share");
    expect(ids).toContain("delete");
    expect(compartir.disponible?.(PRESTADA)).toBe(false);
    expect(compartir.motivo?.(PRESTADA)).toBe("share.onlyOwner");
    expect(borrar.motivo?.(PRESTADA)).toBe("common.deleteNotYoursHint");
    // Y el dueno si puede, que es lo que hace que el motivo de compartir no
    // aparezca siempre y no sea una frase que ya nadie lee.
    expect(compartir.motivo?.(LISTA)).toBeNull();
    expect(borrar.disponible?.(LISTA)).toBe(true);
  });

  it("pin y unpin son un solo slot del orden, con el mismo destino y la misma capacidad", () => {
    /*
      El registro declara las dos etiquetas porque el copy es distinto y el orden
      reserva **un** lugar: el estado de "ya esta en el panel" lo sabe la pantalla
      (`isPinned(layout, id)`) y no la entidad. La hoja elige cual de las dos
      pintura segun ese estado, asi que si las dos entraran en el orden habria dos
      filas de pineo, y si dejaran de coincidir sus destinos una apuntaria a otra
      cosa sin que nada se rompa.
    */
    const pinear = ACCIONES.pin!;
    const quitar = ACCIONES.unpin!;

    expect(ORDEN_POR_KIND.list.filter((id) => id === "pin" || id === "unpin")).toEqual(["pin"]);
    expect(pinear.destino).toEqual(quitar.destino);

    const sinPanel: MenuContext = { ...LISTA, caps: {} };

    expect(pinear.disponible?.(LISTA)).toBe(quitar.disponible?.(LISTA));
    expect(pinear.disponible?.(sinPanel)).toBe(false);
    expect(quitar.disponible?.(sinPanel)).toBe(false);
  });

  it("la hoja elige el descriptor del slot a partir del registro, no de un id escrito", () => {
    // La eleccion va en la hoja porque ahi se pinta, pero el **descriptor** sale del
    // registro: si `unpin` dejara de existir, la fila cae en `ACCIONES.pin` y se
    // dice "Pinear" sobre una lista que ya esta en el inicio, en vez de romperse.
    const hoja = src(HOJA);

    expect(hoja).toMatch(/ACCIONES\.pin\?\.id === declarada\.id && pinned === true/);
    expect(hoja).toMatch(/ACCIONES\.unpin \?\? declarada/);
  });
});

describe("las paginas que el filtro saca, con nombre", () => {
  it("cada pagina sin montar tiene alguien anotado para escribirla", () => {
    const montadas = paginasMontadas();
    const sinMontar = [
      ...new Set(
        accionesPara(LISTA)
          .flatMap((accion) => (accion.destino.tipo === "pagina" ? [accion.destino.page] : []))
          .filter((page) => !montadas.includes(page)),
      ),
    ];

    /*
      ------------------------------------------------------------------
      LOS DOS HUECOS, Y POR QUE ESTAN ESCRITOS Y NO OCULTOS
      ------------------------------------------------------------------

      La hoja vieja **si** ofrecia las dos ultimas, y las ofrecia de verdad.
      Perder una fila es lo peor que puede pasar en una migracion asi, asi que cada
      hueco lleva escrito quien lo cierra:

      - `access`: la declara el registro desde la T1 y la cierra la T8. **No** es una
        perdida: la hoja vieja no la tenia, es una fila de mas que todavia no se
        puede pintar.
      - `export`: la hoja vieja montaba la pagina de formatos (`:616`) y la hoja
        hermana de resultados (`:698`), con los dos formatos y el reintento.
        **Exportar una lista deja de estar disponible con esta tarea**, y queda
        escrito para que nadie lo lea como un olvido. Lo cierra la T9.

      ------------------------------------------------------------------
      Y `share` ESTUVO ACA, Y POR QUE NO ESTA MAS
      ------------------------------------------------------------------

      El tercer hueco no era de este bloque: era **sin dueno**. `ACCIONES.share`
      declara su destino como una pagina desde la T1 y las diez tareas del plan
      ninguna escribia el componente que la monte, asi que el filtro sacaba la fila
      entera y **compartir una lista dejo de existir** —sin error, sin test rojo, y
      con la lista de este archivo diciendo que la fila seguia ahi.

      Lo cierra la T11, con `SharePage`. Por eso este bloque tiene dos entradas y no
      tres: `share` sale del mapa y del `toEqual` cuando su pagina entra en
      `PAGINAS_MONTADAS`, y ese mismo `toEqual` es lo que va a fallar el dia que
      aparezcan dos huecos nuevos sin escribir.
    */
    const PENDIENTES: Record<string, string> = {
      access: "T8: AccessPage, con SharedBadge y useShareReach",
      export: "T9: ExportPage, con los dos formatos y ExportResultSheet",
    };

    for (const page of sinMontar) {
      expect(PENDIENTES[page], `la pagina "${page}" no se monta y nadie la escribe`).toBeTruthy();
    }

    // Y el conjunto es exactamente este, no un subconjunto: cuando T8 y T9 monten
    // las suyas hay que sacar sus entradas de aca, y el conjunto tiene que quedar
    // vacio.
    expect(sinMontar.sort()).toEqual(["access", "export"]);
  });
});

describe("la hoja vieja no existe mas", () => {
  it("el archivo se borro", () => {
    // Si queda, hay dos menus de lista y el que gana es el que se importa ultimo.
    // Esta linea es la que hace fallar el test mientras el archivo siga en el repo,
    // que es lo que el paso 2 del brief pide ver.
    expect(hay(HOJA_VIEJA), "la hoja vieja de lista sigue en el repo").toBe(false);
  });

  it("y ninguna pantalla la importa, y las cuatro la abren con el adaptador", () => {
    for (const pantalla of CALL_SITES) {
      const fuente = src(pantalla);

      expect(fuente, pantalla).toContain("EntityMenuSheet");
      // El nombre sin `toContain` sobre el archivo entero, porque el nombre aparece
      // en la prosa de comentarios que explican la migracion —y ahi un `not` falla
      // por su propia explicacion—. Se mira el **import**, que es lo que de verdad
      // engancha el componente.
      expect(fuente, pantalla).not.toMatch(/import[^;]*ListMenuSheet/);
      // El `ctx`, los handlers y los tres datos que no viajan en el ctx los arma
      // `lib/menus/lista.ts`: si una pantalla vuelve a normalizar por su cuenta, las
      // cuatro empiezan a diferir el dia que cambie algo.
      expect(fuente, pantalla).toContain("menuDeLista(");
    }
  });
});

describe("la normalizacion de la lista vive en un archivo y no en cuatro pantallas", () => {
  it("el adaptador es el unico que dice de que kind es esto y de como se llama", () => {
    const adaptador = src(ADAPTADOR);

    expect(adaptador).toContain('kind: "list"');
    expect(adaptador).toContain("title: list.title");
    /*
      `folder` es la que mas cuesta ver. `entity.title` de una lista es `list.title`,
      asi que usar el `ctx` para el subtitulo hace creer que el `folder` dejo de
      importar, y lo que deja de importar es justo el "· Films" que dice donde vive
      la lista. La regla del subtitulo esta en el adaptador, y cada pantalla solo
      resuelve **que carpeta** es la suya.
    */
    expect(adaptador).toContain("LIST_KIND_LABEL");
    expect(adaptador).toContain("folder.name");

    for (const pantalla of CALL_SITES) {
      const fuente = src(pantalla);

      /*
        El `kind` no se forbids por nombre porque la pantalla del espacio lo usa en
        el tipo de su union —`{ kind: "list"; list: List }`—, que no es normalizar
        nada. Lo que no puede aparecer en una pantalla es un `caps`: armar el `ctx`
        a mano exige escribir las capacidades, y sin eso no hay `MenuContext`.
      */
      expect(fuente, pantalla).not.toContain("caps:");
      expect(fuente, pantalla).not.toContain("LIST_KIND_LABEL");
      expect(fuente, pantalla).toContain("folder:");
    }
  });

  it("las cuatro pasan las seis cosas por el elemento del menu, y ninguna por su cuenta", () => {
    /*
      Las seis props salen de `menuLista`, y el guard mira **los** elementos
      `EntityMenuSheet` de la pantalla: la del espacio monta dos —coleccion y lista—
      y lo que se afirma es que el de la lista existe y esta completo, sin adivinar
      cual de los dos es.

      La forma vieja —la entidad entera y la carpeta por prop— no puede quedar en
      ninguno: `EntityMenuSheet` no las tiene en su tipo, asi que si alguien las
      escribiera ahi el compilador lo dira y este guard lo dice antes.
    */
    for (const pantalla of CALL_SITES) {
      const hojas = elementos(src(pantalla), "EntityMenuSheet");
      const delMenu = hojas.filter((hoja) => hoja.includes("menuLista."));

      expect(delMenu, `${pantalla} no monta el menu de lista`).toHaveLength(1);

      for (const prop of ["ctx", "icon", "conteo", "pinned", "subtitulo", "handlers"]) {
        expect(delMenu[0], `${pantalla} no pasa "${prop}"`).toContain(`${prop}={menuLista.${prop}}`);
      }

      for (const hoja of hojas) {
        expect(hoja, pantalla).not.toContain("list=");
        expect(hoja, pantalla).not.toContain("folder=");
      }
    }
  });

  it("y el unico que decide si esta pineada", () => {
    // `isPinned(layout, id)` es estado de pantalla y por eso no puede ir en el
    // `ctx`. Lo que no puede es estar escrito en cuatro pantallas, porque entonces
    // cuatro pantallas pueden discrepar sobre si la lista esta en el panel y solo
    // una lo sabe de verdad.
    expect(src(ADAPTADOR)).toContain("isPinned(");

    for (const pantalla of CALL_SITES) {
      expect(src(pantalla), pantalla).not.toContain("isPinned(");
    }
  });

  it("y el unico que dice que se vuelve atras despues de borrar", () => {
    /*
      La hoja vieja llamaba `onDeleted` en el mismo toque que `deleteList`, sin
      esperarla: `router.back()` corria aunque borrar fallara, y la pantalla volvia
      con el tombstone sin escribir. Aca va en el handler y **despues** del await, asi
      que volver atras es consecuencia de haber borrado y no un efecto del toque.

      Y el guard mira **los elementos** del menu, no el archivo: la pantalla del
      espacio le pasa `onDeleted` a la hoja del espacio —que es otra hoja y otro
      trato— y eso no dice nada sobre la lista.
    */
    expect(src(ADAPTADOR)).toMatch(/await deleteList\(list\);[\s\S]{0,80}onDeleted\?\.\(\)/);

    for (const pantalla of CALL_SITES) {
      for (const hoja of elementos(src(pantalla), "EntityMenuSheet")) {
        expect(hoja, pantalla).not.toContain("onDeleted");
      }
    }
  });
});

describe("el cuerpo de borrar de una lista conserva el numero", () => {
  /*
    ------------------------------------------------------------------
    LA DECISION, Y POR QUE EL NUMERO NO ESTA EN EL REGISTRO
    ------------------------------------------------------------------

    `lists.deleteBody` cuenta: "Se elimina la lista y sus {count} elementos", y
    `MenuEntity` no lo trae. Las dos salidas eran darle el campo al registro —y
    `registry.tsx` esta fuera de la superficie de esta tarea— o que la pagina lo
    recibiera de otro lado. Se eligio la segunda, y **es el mismo caso que el
    icono**: `EntityMenuSheetProps.icon` entra por props justamente porque
    `MenuEntity` no puede llevar el campo de icono. El conteo es el mismo problema:
    es un dato de la entidad que el registro no necesita para decidir que fila se
    ofrece, y meterlo en el `ctx` seria hacer que las cinco entidades lleven un
    campo que cuatro no llenan.

    Y el que lo pasa es el call site que ya lo tiene a mano, `list.itemCount`,
    resuelto una vez en `lista.ts`.
  */
  it("la hoja se lo pasa a la pagina de borrar, y la pagina no lo inventa", () => {
    expect(src(HOJA)).toMatch(/conteo=\{conteo\}/);
    // Y la pagina decide que sin numero no dice nada, en vez de pintar un
    // `{count}` crudo. Ya esta escrito; este guard lo abarca.
    expect(src(`${PAGINAS}/delete-page.tsx`)).toContain("conteo === undefined");
  });

  it("el conteo sale de la lista y viaja por props, no por el ctx", () => {
    expect(src(ADAPTADOR)).toMatch(/conteo:[\s\S]{0,40}itemCount/);

    for (const pantalla of CALL_SITES) {
      expect(src(pantalla), pantalla).toMatch(/conteo=\{menu\w*\.conteo\}/);
    }
  });
});
