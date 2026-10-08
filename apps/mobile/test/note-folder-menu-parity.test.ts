import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ACCIONES, ORDEN_POR_KIND, accionesPara, resuelveLabel } from "@/lib/menus/registry";
import type { MenuContext } from "@/lib/menus/registry";
import { puedeOfrecerse } from "@/lib/menus/paginas";

import { BLOQUE_DE_LA_HOJA_VIEJA as BLOQUE_DE_LA_CARPETA } from "./fixtures/folder-menu-sheet-options";
import {
  CONMUTADOR_DE_LA_HOJA_VIEJA,
  PANELES_DE_LA_HOJA_VIEJA,
} from "./fixtures/folder-menu-sheet-options";
import { BLOQUE_DE_LA_HOJA_VIEJA as BLOQUE_DE_LA_NOTA } from "./fixtures/note-menu-sheet-options";
import { PAGINAS, RAIZ, hojasMontadas, hoja, paginasMontadas, sinComentarios, src } from "./menus-test-helpers";

/**
 * ------------------------------------------------------------------
 * POR QUE ESTE TEST PARSEA DOS ARCHIVOS CONGELADOS Y NO ESCRIBE UNA LISTA
 * ------------------------------------------------------------------
 *
 * Porque la T7 **borra** `note-menu-sheet.tsx` y `folder-menu-sheet.tsx`, y un guard
 * que lee un archivo que se guardo se queda comprobando nada sin avisar —que es la
 * mitad del fallo que `menus-test-helpers.ts` existe para cazar—. Los dos bloques
 * estan congelados en `test/fixtures/` y **se parsean aca**, con el mismo filtro con
 * que se extrajeron: las etiquetas no estan escritas, estan leidas.
 *
 * Escritas a mano serían una copia del registro que se desincroniza en silencio: el
 * dia que el registro cambie, el test seguiria diciendo que estan y estaria
 * mintiendo sobre algo que el mismo test puede comprobar. Es la misma razon por la
 * que `list-menu-parity.test.ts` congela el suyo, y la razon por la que el filtro
 * y el extractor viven **aca** y no en el helper: los paths y las constantes de un
 * solo test siguen en su test.
 */

/** Una nota del dueno, con la capacidad que la hace tener la fila de plantilla. */
const NOTA: MenuContext = {
  kind: "note",
  entity: { id: "n1", title: "Recetas de la abuela", role: "owner", shared: false },
  caps: { saveAsTemplate: true },
};

/** La misma, prestada: no es del dueno y no se borra. */
const NOTA_PRESTADA: MenuContext = {
  ...NOTA,
  entity: { ...NOTA.entity, role: "editor", shared: true },
};

/** Una carpeta del dueno, con las dos capacidades que la hoja vieja no condicionaba. */
const CARPETA: MenuContext = {
  kind: "folder",
  entity: { id: "f1", title: "Peliculas", role: "owner", shared: false },
  caps: { panel: true, createInside: true },
};

/** La misma, prestada. */
const CARPETA_PRESTADA: MenuContext = {
  ...CARPETA,
  entity: { ...CARPETA.entity, role: "editor", shared: true },
};

/** Las pantallas que montaban cada hoja vieja, con el menu que montaban. */
const CALL_SITES_NOTA = ["src/app/(app)/workspace/[workspaceId].tsx", "src/app/(app)/note/[noteId].tsx"];

const CALL_SITES_CARPETA = ["src/app/(app)/workspace/[workspaceId].tsx"];

const ADAPTADOR_NOTA = "src/lib/menus/nota.ts";
const ADAPTADOR_CARPETA = "src/lib/menus/carpeta.ts";
const HOJA_VIEJA_NOTA = "src/components/notes/note-menu-sheet.tsx";
const HOJA_VIEJA_CARPETA = "src/components/folders/folder-menu-sheet.tsx";
const RENOMBRAR = `${PAGINAS}/rename-page.tsx`;

const hay = (ruta: string) => existsSync(join(RAIZ, ruta));

/**
 * Los elementos JSX de un nombre, y no el archivo entero.
 *
 * Estas pantallas montan **varios** `EntityMenuSheet` —coleccion, lista, nota y
 * carpeta— y un `not.toContain` sobre el archivo entero afirmaria sobre los cuatro:
 * el hecho de que la pantalla del espacio pase `onDeleted` a la hoja del espacio
 * no dice nada sobre el menu de lista que esta veinte lineas mas abajo. Es el mismo
 * error que `sinComentarios` —un guard que mira mas de lo que dice— en su otra
 * forma: aca por sobrecarga, no por prosa.
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
 * Las filas de una hoja vieja, con las etiquetas que cada una pintaba.
 *
 * Se parte el bloque por cada `key`, y de cada trozo se saca el `label` **con lo que
 * sea que siga hasta la propiedad siguiente**: una fila cuyo copy depende del estado
 * —`pin`, `delete`— es un ternario con dos claves, y un filtro que solo aceptara la
 * primera contaria cinco etiquetas de nota en vez de seis, y cuatro de carpeta en
 * vez de ocho.
 */
function filasDe(hoja: string): { fila: string; etiquetas: string[] }[] {
  const CLAVE = /key: "([^"]+)"/;
  const ETIQUETA =
    /label:([\s\S]{0,200}?),?\n\s*(icon|description|disabled|tone|onPress|key):/g;
  const CLAVE_I18N = /t\(\s*"([^"]+)"/g;

  const filas = hoja.split(/(?=key: ")/).slice(1).flatMap((trozo) => {
    const fila = CLAVE.exec(trozo)?.[1];

    /*
      Sin `key` legible el trozo no es una fila: es un fragmento del bloque que el
      filtro de arriba metio y que no es una opcion. Se descarta **aca** y no en el
      `expect`, porque un nombre vacio en un mensaje de fallo no dice que archivo se
      rompio —y este archivo no tiene otra forma de avisar—.
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

/**
 * Las **claves del registro** de cada fila vieja, y no el nombre de la fila.
 *
 * Porque tres filas se llamaban distinto en la hoja y en el registro, y el mapa
 * esta escrito —con la razon— en el `describe` de abajo en vez de estar repartido
 * por los guards: un nombre viejo que aparece suelto en cuatro asserts es un
 * nombre viejo que alguien va a "arreglar" sin saber que el registro no lo tiene.
 */
const CLAVE_EN_EL_REGISTRO: Record<string, string> = {
  // La hoja la llamaba `template` porque el boton decia "guardar como plantilla";
  // el registro la llama por lo que **es**, que es una accion.
  template: "saveAsTemplate",
  // Estas dos si tienen el mismo nombre, y estan escritas igual por el motivo
  // contrario: la equivalencia se ve y no hace falta saberla de memoria.
  "new-list": "createHere",
};

/** El id del registro de una fila vieja, y el nombre viejo si no hay equivalencia. */
const idDe = (fila: string): string => CLAVE_EN_EL_REGISTRO[fila] ?? fila;

/** La etiqueta de un id, ya resuelta para el contexto que hace falta. */
function etiquetaDe(id: string, ctx: MenuContext): string | undefined {
  return ACCIONES[id] ? resuelveLabel(ACCIONES[id], ctx) : undefined;
}

/**
 * Todas las etiquetas que una fila puede decir, **en los dos estados que la
 * distinguen**.
 *
 * Sin esto, `pin` y `delete` darian un falso negativo que parece una fila perdida y
 * no lo es: las dos son una fila con un ternario en el `label` y el registro las
 * guarda como una o dos entradas segun si el estado es de la entidad (`shared`) o de
 * la pantalla (`pinned`). Comparar los conjuntos es lo que hace que las dos mitades
 * queden cubiertas por el mismo guard.
 *
 * Y el `pin` de una carpeta trae **las dos** del registro, porque la de "quitar del
 * panel" es `unpin` —otra etiqueta, mismo destino— y la hoja la elegia con
 * `onPanel`. Es el mismo caso que en `list-menu-parity.test.ts`, y por eso esta
 * funcion no mira que kind es: mira la fila.
 */
function etiquetasDeLaFila(fila: string, dupla: MenuContext, prestada: MenuContext): string[] {
  const id = idDe(fila);
  const delOtroEstado = id === "pin" ? [etiquetaDe("unpin", dupla)] : [];

  return [
    ...new Set([dupla, prestada].flatMap((ctx) => [etiquetaDe(id, ctx), ...delOtroEstado])),
  ].filter((clave): clave is string => clave !== undefined).sort();
}

describe("lo que las hojas viejas ofrecian, leido de su fuente congelada", () => {
  it("la de nota: cinco filas y seis etiquetas, y el numero no esta escrito a mano", () => {
    const filas = filasDe(BLOQUE_DE_LA_NOTA);

    expect(filas.map((fila) => fila.fila)).toEqual(["rename", "icon", "share", "template", "delete"]);
    // El seis del brief son seis **etiquetas**, no seis filas: `delete` son dos,
    // porque una fila que cambia de copy con el estado tiene dos etiquetas. Y este
    // numero sale de contar, no de escribir.
    expect(filas.flatMap((fila) => fila.etiquetas)).toHaveLength(6);
  });

  it("la de nota: las seis etiquetas son las que el brief nombra", () => {
    expect(filasDe(BLOQUE_DE_LA_NOTA).flatMap((fila) => fila.etiquetas)).toEqual([
      "note.rename",
      "icons.title",
      "share.pickSomeone",
      "note.templates.saveCurrent",
      "common.deleteNotYours",
      "note.delete",
    ]);
  });

  it("la de carpeta: seis filas y ocho etiquetas", () => {
    const filas = filasDe(BLOQUE_DE_LA_CARPETA);

    expect(filas.map((fila) => fila.fila)).toEqual([
      "new-list",
      "pin",
      "rename",
      "icon",
      "share",
      "delete",
    ]);
    expect(filas.flatMap((fila) => fila.etiquetas)).toHaveLength(8);
  });

  it("la de carpeta: las ocho etiquetas son las que el brief nombra", () => {
    // Las dos de `pin` son `dashboard.takeOffPanel` y `dashboard.putOnPanel`, no
    // `lists.pinToDashboard` / `lists.unpinFromDashboard` como las de la lista. El
    // bloque de abajo esta escrito por que eso no se puede igualar.
    expect(filasDe(BLOQUE_DE_LA_CARPETA).flatMap((fila) => fila.etiquetas)).toEqual([
      "lists.createHere",
      "dashboard.takeOffPanel",
      "dashboard.putOnPanel",
      "common.rename",
      "icons.title",
      "share.pickSomeone",
      "common.deleteNotYours",
      "common.delete",
    ]);
  });
});

describe("cada fila de las hojas viejas sigue existiendo", () => {
  it("con el mismo nombre, o con el que el registro le dio y esta escrito", () => {
    for (const bloque of [BLOQUE_DE_LA_NOTA, BLOQUE_DE_LA_CARPETA]) {
      for (const { fila } of filasDe(bloque)) {
        expect(ACCIONES[idDe(fila)], `el registro no declara "${fila}"`).toBeTruthy();
      }
    }
  });

  it("y el mapa de equivalencias no tiene una fila que el registro no conozca", () => {
    /*
      `CLAVE_EN_EL_REGISTRO` traduce el nombre viejo al del registro, y una entrada
      que apunta a un id inexistente haria que el guard de arriba pasara mirando al
      vacio —`ACCIONES[undefined]` es `undefined`, y `undefined` con `toBeTruthy`
      falla, pero el mensaje seria el de la fila y no el del mapa—.

      Se comprueba el mapa entero y no sus entradas: asi el dia que alguna fila
      renombre su id en el registro, esta linea dice **cual**, en vez de fallar
      cinco asserts con el mismo nombre de fila vieja.
    */
    for (const [viejo, delRegistro] of Object.entries(CLAVE_EN_EL_REGISTRO)) {
      expect(ACCIONES[delRegistro], `el mapa lleva "${viejo}" a un id que no existe`).toBeTruthy();
    }
  });

  it("y el registro no le muestra a ninguna de las dos una etiqueta que la hoja vieja no tuviera", () => {
    /*
      La comparacion por los dos lados, porque una de fila por fila no avisa si
      aparecio algo. Las diferencias son **dos por kind** y ninguna es una fila
      perdida:

      - `menus.access`: la declara el registro desde la T1 y su pagina es de la T8.
      - Los titulos de las demas paginas (`common.rename`, `icons.title`, …) **no**
        son filas: son lo que la hoja pone en `SUBTITULO_POR_PAGINA`, y salen de ahi
        y no de acia.

      Lo que este guard forbids es una tercera diferencia: una etiqueta que el
      registro le muestre a una nota o a una carpeta y que la hoja vieja no le
      mostrara nunca.
    */
    for (const [bloque, kind, ctx, prestada] of [
      [BLOQUE_DE_LA_NOTA, "note", NOTA, NOTA_PRESTADA],
      [BLOQUE_DE_LA_CARPETA, "folder", CARPETA, CARPETA_PRESTADA],
    ] as const) {
      const deLaHojaVieja = new Set(
        filasDe(bloque).flatMap(({ fila }) => etiquetasDeLaFila(fila, ctx, prestada)),
      );
      const delRegistro = new Set(
        ORDEN_POR_KIND[kind].flatMap((id) => etiquetasDeLaFila(id, ctx, prestada)),
      );

      expect([...delRegistro].filter((clave) => !deLaHojaVieja.has(clave)).sort(), kind).toEqual([
        "menus.access",
      ]);
    }
  });
});

describe("la divergencia de copy, escrita y no arreglada", () => {
  it("la nota decia 'Cambiar el nombre' y el registro dice 'Renombrar'", () => {
    /*
      ------------------------------------------------------------------
      LA DIVERGENCIA, Y POR QUE NO SE ARREGLA ACA
      ------------------------------------------------------------------

      La hoja de nota decia `note.rename` —"Cambiar el nombre" en castellano— y el
      registro dice `common.rename` —"Renombrar"—. Lo eligio la T1, cuando el
      registro unifico las filas de las cinco entidades, y **no es un error de T7**:
      la hoja de carpeta decia `common.rename`, la de lista tambien, y la de nota
      era la unica que decia otra cosa.

      Igualarla haria falta tocar `registry.tsx`, que esta fuera de la superficie de
      esta tarea. Queda escrita y no borrada en silencio: el guard de arriba afirma
      que las cinco filas de la nota **siguen existiendo** —que es lo que no se puede
      perder— y este dice que el copy de una cambio y por que.
    */
    expect(etiquetaDe("rename", NOTA)).toBe("common.rename");
    expect(filasDe(BLOQUE_DE_LA_NOTA).find((f) => f.fila === "rename")?.etiquetas).toEqual([
      "note.rename",
    ]);
  });

  it("la carpeta decia 'Poner/Quitar del panel' y el registro dice 'Pinear/Quitar del inicio'", () => {
    /*
      La misma clase de divergencia y la misma razon, con una diferencia que si
      importa: aca el registro tiene **las dos** etiquetas que la hoja tenia, y solo
      cambian las palabras. `dashboard.putOnPanel` se paso a `lists.pinToDashboard` y
      `dashboard.takeOffPanel` a `lists.unpinFromDashboard`.

      O sea que la fila no cambio de copy por accidente: cambio al unificar con la
      lista, que es la unica que se pinea con el mismo gesto y con el mismo
      `isPinned`. Y "Poner en el panel" / "Quitar del panel" **siguen existiendo en el
      diccionario** para los otros lugares que las usan, asi que no son claves
      huerfanas.

      Igualar el texto seria otra cosa, y de otra tarea: haria falta un `labelKey`
 * por kind en el registro, que es justo lo que `ACCIONES` evita.
    */
    const [pinesada, noPinesada] = [
      etiquetasDeLaFila("pin", CARPETA, CARPETA_PRESTADA),
      ACCIONES.unpin ? resuelveLabel(ACCIONES.unpin, CARPETA) : undefined,
    ];

    expect(ACCIONES.pin ? resuelveLabel(ACCIONES.pin, CARPETA) : undefined).toBe(
      "lists.pinToDashboard",
    );
    expect(noPinesada).toBe("lists.unpinFromDashboard");
    expect(pinesada).toEqual(["lists.pinToDashboard", "lists.unpinFromDashboard"]);
  });
});

describe("lo que se ofrece, y lo que todavia no se puede pintar", () => {
  /*
    Lo que la hoja **pinta**, y no lo que el registro declara.

    `accionesPara` responde "que filas existen y se pueden usar", que es una
    pregunta del modelo; `puedeOfrecerse` responde "cuales puede pintar esta version
    de la hoja", que es una pregunta del estado del trabajo. Comparar contra la
    primera y esperando la segunda es el error que hace que un test de migracion
    cuente filas que nadie ve.
  */
  const pintadas = (ctx: MenuContext) => accionesPara(ctx).filter(puedeOfrecerse).map((a) => a.id);

  it("una nota ofrece las cinco que ofrecia, mas la de acceso cuando exista su pagina", () => {
    /*
      Las cinco de la hoja vieja, en el orden del registro, y `access` sale porque
      su pagina todavia no existe —abajo esta escrito quien la escribe—.
    */
    expect(pintadas(NOTA)).toEqual(["rename", "icon", "share", "saveAsTemplate", "delete"]);
  });

  it("una nota sin plantilla no ofrece esa fila, porque no hay quien la ejecute", () => {
    // `onSaveAsTemplate` era un prop **opcional** de la hoja vieja y la fila se
    // ofrecia solo con el: la capacidad y el handler son la misma fila. Ver
    // `AccionesDeNota.onSaveAsTemplate`.
    const sinPlantilla: MenuContext = { ...NOTA, caps: {} };

    expect(accionesPara(sinPlantilla).map((accion) => accion.id)).not.toContain("saveAsTemplate");
  });

  it("una nota prestada puede compartir con motivo y no puede borrar", () => {
    /*
      La Review Focus #1: una accion que no se puede **y explica por que** se queda
      en la lista para que la hoja la dibuje apagada con el motivo en `description`,
      porque esconderla deja a la persona creyendo que no existe en vez de que existe
      y no es suya.

      Y lo que se mira es `accionesPara`, **no** `pintadas`: las dos filas existen y
      se pintan; lo que cambia es si se pueden tocar.
    */
    const compartir = ACCIONES.share!;
    const borrar = ACCIONES.delete!;

    expect(compartir.disponible?.(NOTA_PRESTADA)).toBe(false);
    expect(compartir.motivo?.(NOTA_PRESTADA)).toBe("share.onlyOwner");
    expect(borrar.motivo?.(NOTA_PRESTADA)).toBe("common.deleteNotYoursHint");
    // Y el dueno si puede, que es lo que hace que el motivo no aparezca siempre.
    expect(compartir.motivo?.(NOTA)).toBeNull();
    expect(borrar.disponible?.(NOTA)).toBe(true);
  });

  it("una carpeta ofrece las seis que la hoja puede pintar, y la de acceso sigue pendiente con nombre", () => {
    /*
      ------------------------------------------------------------------
      "CREAR UNA LISTA AQUI": LA FILA VUELVE, Y POR QUE ERA UNA PERDIDA
      ------------------------------------------------------------------

      La hoja vieja la ofrecia de verdad: abria una hoja hermana con los tipos de
      `LIST_KIND_ORDER` y llamaba a `onCreateInside(kind)`. El registro la declara
      (`ACCIONES.createHere`), la lista para `folder` (`ORDEN_POR_KIND`) y
      `menuDeCarpeta` pone `createInside: true` porque la pantalla si sabe crearla.

      Lo que la sacaba era `puedeOfrecerse`: `MenuPageId` declaraba `"create"` y
      **ningun componente de `components/menus/pages/` montaba esa pagina**, asi que el
      filtro se la comia entera. Con la pagina escrita —`create-page.tsx`, y
      `"create"` en `PAGINAS_MONTADAS`— la fila sale. **Es la segunda vez que este
      patron aparece en el plan** —la primera fue `share`, en la T11—, y las dos
      veces una accion existed en el registro sin que ninguna tarea escribiera su
      pagina, que es una capacidad que se pierde sin error ni test rojo.

      Queda una sola pendiente, `access`, que la cierra la T8.

      Y el `onCreateInside` de la pantalla tambien: `EntityMenuSheet` tiene por donde
      (`MenuHandlers.crearDentro`), `menuDeCarpeta` lo reenvia y `[workspaceId].tsx` lo
      pasa —con el destino y todo, en el fix 1 de la T12—. Que el destino no fuera solo
      el handler era la mitad mas grave: `onCreate` tenia `folderId: null` en las cuatro
      ramas, y `null` es **la raiz del espacio**, no un default.
    */
    const montadas = paginasMontadas();
    const sinMontar = accionesPara(CARPETA)
      .flatMap((accion) => (accion.destino.tipo === "pagina" ? [accion.destino.page] : []))
      .filter((page) => !montadas.includes(page));

    expect(pintadas(CARPETA)).toEqual(["createHere", "pin", "rename", "icon", "share", "delete"]);
    expect(accionesPara(CARPETA).map((accion) => accion.id)).toContain("createHere");
    expect(sinMontar.sort()).toEqual(["access"]);
  });

  it("cada pagina sin montar tiene alguien anotado para escribirla", () => {
    const montadas = paginasMontadas();
    /*
      `create` **estuvo aca** y sale con la T12: decia "nadie en este plan" con esas
      palabras precisamente para que el hueco se notara antes de que alguien lo cerrara
      por su cuenta, y no con un nombre de tarea inventado. Lo que se reemplaza es la
      entrada, no el mapa entero, asi que `access` sigue siendo la unica que hay.
    */
    const PENDIENTES: Record<string, string> = {
      access: "T8: AccessPage, con SharedBadge y useShareReach",
    };

    for (const ctx of [NOTA, CARPETA]) {
      const sinMontar = accionesPara(ctx)
        .flatMap((accion) => (accion.destino.tipo === "pagina" ? [accion.destino.page] : []))
        .filter((page) => !montadas.includes(page));

      for (const page of sinMontar) {
        expect(PENDIENTES[page], `la pagina "${page}" no se monta y nadie la escribe`).toBeTruthy();
      }
    }
  });

  it("la carpeta que no es del dueno no ofrece compartir y no puede borrar", () => {
    // La misma regla que la nota y que la lista, escrita una sola vez en el
    // registro, y aca se comprueba que el kind la recibe igual.
    expect(ACCIONES.share?.disponible?.(CARPETA_PRESTADA)).toBe(false);
    expect(ACCIONES.delete?.motivo?.(CARPETA_PRESTADA)).toBe("common.deleteNotYoursHint");
    expect(ACCIONES.delete?.disponible?.(CARPETA)).toBe(true);
  });
});

describe("la carpeta deja de ser seis paneles hermanos", () => {
  it("la hoja vieja montaba seis, y el numero sale del fixture y no de escribirlo", () => {
    /*
      El contraste tiene que estar en el test, o "un solo `Sheet`" no dice nada: es
      una afirmacion sobre un numero que el archivo nuevo podria cumplir por tener
      menos contenido. Y como el archivo se borro, el numero sale **del fixture**, que
      son las seis lineas que abrian cada panel del archivo viejo.

      Los dos se cuentan con `hojasMontadas` y con un `split`, no con numeros
      escritos: el helper es el mismo que usa `entity-menu-sheet.test.ts`, asi que
      "cuantas hojas monta esto" tiene una sola respuesta en el repo.
    */
    // Las `<Sheet>` a secas: el helper cuenta `<Sheet`, y las tres hermanas
    // (`RenameSheet`, `IconPickerSheet`, `ConfirmSheet`) no entran en ese conteo.
    expect(hojasMontadas(PANELES_DE_LA_HOJA_VIEJA)).toBe(3);
    // Y las seis en total, que es lo que la hoja conmutaba con un flag.
    expect(PANELES_DE_LA_HOJA_VIEJA.split("\n")).toHaveLength(6);
    // La de hoy, una sola.
    expect(hojasMontadas(hoja)).toBe(1);
  });

  it("los conmutaba un flag, y el menu se cerraba mientras el otro estaba", () => {
    // `visible={pedido !== null && !inside}`: sin el `!inside`, el menu seguiria
    // debajo del panel que se abre y un toque en la de arriba cerraria la de abajo.
    expect(PANELES_DE_LA_HOJA_VIEJA).toContain("<Sheet");
    expect(CONMUTADOR_DE_LA_HOJA_VIEJA).toBe("visible={pedido !== null && !inside}");
  });

  it("y ahora la unica hoja cambia de pagina con step y con onBack", () => {
    expect(hoja).toMatch(/\bstep=\{pagina\}/);
    expect(hoja).toMatch(/pagina === "options" \? undefined : \(\) => setPagina\("options"\)/);
  });
});

describe("el setSucio de la nota, y por que el archivo puede desaparecer", () => {
  it("la hoja vieja lo llamaba siendo el padre del Provider, y no llegaba a nada", () => {
    /*
      ------------------------------------------------------------------
      EL BUG, Y POR QUE ESTA TAREA LO ARREGLA "POR BORRAR"
      ------------------------------------------------------------------

      `note-menu-sheet.tsx:97` hacia `const { setSucio } = useSheetSucio();` siendo
      el **padre** del `Sheet` que pintaba. El `SheetSucioContexto.Provider` esta
      **dentro** del `<Modal>` (`sheet.tsx:630`), asi que su `setSucio` era el del
      contexto por defecto: `() => {}`. La pregunta de "¿salir sin guardar?" nunca se
      armo, y el sintoma es el peor posible —escribir un nombre, cerrar, perderlo sin
      preguntar— con dos propiedades que lo hacen invisible: no rompe nada y no hay
      typecheck que lo note.

      El fix no es "mover el `setSucio`": es que **la hoja deja de existir**. El
      renombrar de una nota pasa a ser `RenamePage`, que ya deriva adentro del
      Provider por el mismo motivo que `rename-sheet.tsx` y `share-node-sheet.tsx`, y
      no resetea al desmontarse (`rename-page.tsx:82-92`). O sea que la fila de
      "renombrar" de la nota ahora **si** pregunta.

      Y ningun guard afirmaba la forma rota: los cinco que existen apuntan a
      `rename-sheet.tsx`, `item-edit-sheet.tsx` (dos), `workspace-create-sheet.tsx` y
      `save-template-sheet.tsx` —verificado sobre las variables que cada uno lee, no
      sobre el numero de linea—. Por eso el archivo se puede borrar entero sin dar
      vuelta ninguna señal.
    */
    expect(hay(HOJA_VIEJA_NOTA), "la hoja vieja de nota sigue en el repo").toBe(false);
  });

  it("y la pagina que ahora la monta si arma sucio, adentro del Provider y sin reset", () => {
    const pagina = sinComentarios(src(RENOMBRAR));

    expect(pagina).toMatch(/\{\s*setSucio\s*\}\s*=\s*useSheetSucio\(\)/);
    expect(pagina).toMatch(/setSucio\(borrador !== null && borrador\.trim\(\) !== titulo\.trim\(\)\)/);
    /*
      Y el reset que hace falta **ya existe** y no hay que repetirlo: `Sheet` limpia
      su propio "sucio" al abrir. Un `return () => setSucio(false)` en el cleanup
      desarmaria la pregunta en el mismo toque en que la flecha desmonta la pagina
      con el texto escrito ahi, y cerrar despues se iria sin preguntar.
    */
    expect(pagina).not.toMatch(/setSucio\(false\)/);
  });
});

describe("las hojas viejas no existen mas", () => {
  it("los dos archivos se borraron", () => {
    // Si queda alguno, hay dos menus de esa entidad y el que gana es el que se
    // importa ultimo. Esta linea es la que hace fallar el test mientras el archivo
    // siga en el repo, que es lo que el paso 2 del brief pide ver.
    expect(hay(HOJA_VIEJA_NOTA)).toBe(false);
    expect(hay(HOJA_VIEJA_CARPETA)).toBe(false);
  });

  it("y ninguna pantalla los importa", () => {
    for (const pantalla of [...CALL_SITES_NOTA, ...CALL_SITES_CARPETA]) {
      const fuente = src(pantalla);

      // El nombre sin `toContain` sobre el archivo entero, porque el nombre aparece
      // en la prosa de comentarios que explican la migracion —y ahi un `not` falla
      // por su propia explicacion—. Se mira el **import**, que es lo que de verdad
      // engancha el componente.
      expect(fuente, pantalla).not.toMatch(/import[^;]*NoteMenuSheet/);
      expect(fuente, pantalla).not.toMatch(/import[^;]*FolderMenuSheet/);
    }
  });
});

describe("la normalizacion vive en un archivo y no en las pantallas", () => {
  it("el adaptador es el unico que dice de que kind es esto y de como se llama", () => {
    const nota = src(ADAPTADOR_NOTA);
    const carpeta = src(ADAPTADOR_CARPETA);

    expect(nota).toContain('kind: "note"');
    expect(nota).toContain("title: note.title");
    expect(carpeta).toContain('kind: "folder"');
    // `Folder` dice `name` y `MenuEntity` dice `title`: es la unica normalizacion
    // que hace el registro, y por eso la hoja vieja no puede seguir con un tipo
    // estructural escrito a mano.
    expect(carpeta).toContain("title: folder.name");

    for (const pantalla of [...CALL_SITES_NOTA, ...CALL_SITES_CARPETA]) {
      const fuente = sinComentarios(src(pantalla));

      /*
        ------------------------------------------------------------------
        LO QUE SE FORBID ES LA PALABRA, NO UNA FORMA DE ELLA
        ------------------------------------------------------------------

        Lo que se forbid **no** es el `kind`, porque esta pantalla lo usa en el tipo
        de su propia union —`{ kind: "folder"; folder: Folder }`—, y eso no es
        normalizar nada.

        Y `caps` se busca como **palabra**, no como `caps:`. La primera version de
        este guard buscaba la forma con dos puntos y paso en verde con
        `caps={{ panel: true }}` pegado en el JSX: es la misma regla escrita con otra
        sintaxis, y un guard que solo conoce una forma del fallo es un guard que el
        proximo escribe de otra manera —el mismo modo de fallo que
        `entity-menu-sheet.test.ts` documenta cuando cambio el marcador del reset de
        `setSucio` a secas por `return () => setSucio(false)`.

        Sin comentarios, ademas, porque estas pantallas explican la migracion y un
        `not` sobre el archivo entero se encontraria con su propia prosa.
      */
      expect(fuente, `${pantalla} arma las capacidades por su cuenta`).not.toMatch(/\bcaps\b/);

      for (const hoja of elementos(fuente, "EntityMenuSheet")) {
        expect(hoja, `${pantalla} arma el ctx a mano`).not.toContain("ctx={{");
      }
    }
  });

  it("las pantallas montan el menu del registro y le pasan todo lo que el adaptador armó", () => {
    for (const pantalla of CALL_SITES_NOTA) {
      const hojas = elementos(src(pantalla), "EntityMenuSheet");
      const delMenu = hojas.filter((hoja) => hoja.includes("menuNota."));

      expect(delMenu, `${pantalla} no monta el menu de nota`).toHaveLength(1);

      for (const prop of ["ctx", "icon", "handlers"]) {
        expect(delMenu[0], `${pantalla} no pasa "${prop}"`).toContain(`${prop}={menuNota.${prop}}`);
      }
    }

    for (const pantalla of CALL_SITES_CARPETA) {
      const hojas = elementos(src(pantalla), "EntityMenuSheet");
      const delMenu = hojas.filter((hoja) => hoja.includes("menuCarpeta."));

      expect(delMenu, `${pantalla} no monta el menu de carpeta`).toHaveLength(1);

      for (const prop of ["ctx", "icon", "pinned", "subtitulo", "handlers"]) {
        expect(delMenu[0], `${pantalla} no pasa "${prop}"`).toContain(
          `${prop}={menuCarpeta.${prop}}`,
        );
      }
    }
  });

  it("y ninguna pantalla decide si esta pineada, ni como se llama la carpeta", () => {
    /*
      `isFolderPinned` es estado de pantalla y por eso no puede ir en el `ctx`, pero
      puede —y debe— estar en un solo archivo: si estuviera en dos, dos pantallas
      pueden discrepar sobre si la carpeta esta en el panel y solo una lo sabe de
      verdad.
    */
    expect(src(ADAPTADOR_CARPETA)).toContain("isFolderPinned(");

    for (const pantalla of CALL_SITES_CARPETA) {
      expect(src(pantalla), pantalla).not.toContain("isFolderPinned(");
    }
  });

  it("y el numero de listas lo cuenta la pantalla y lo pasa, y la frase es una sola", () => {
    /*
      El `listCount` sale del `lists` de la pantalla, que es el unico lugar donde esta
      la verdad de cuantas listas hay —cualquier otra cuenta seria una copia de esa—,
      y lo que el adaptador hace con el es **no dejar que cada pantalla escriba la
      frase del subtitulo por su cuenta**.

      La segunda mitad es la que importa: `folders.whatItHolds` en dos pantallas es
      una regla de formato en dos lugares, y el dia que el numero se cuente distinto
      una de las dos va a mentir sin que nada falle.
    */
    /*
      Y los tres `toContain` de aca van **sin comentarios**. Verificado por
      mutacion: con el archivo entero, cambiar la linea por un template literal
      —`` `${acciones.listCount} listas dentro` ``— dejo el test en verde, porque el
      nombre de la clave esta escrito en el comentario de arriba y el guard se
      satisfacia con su propia prosa. Es el mismo fallo que el del `testID` que
      cerro la T5, del otro lado: un guard que no comprueba lo que dice comprobar.
    */
    expect(sinComentarios(src(ADAPTADOR_CARPETA))).toContain("folders.whatItHolds");
    for (const pantalla of CALL_SITES_CARPETA) {
      const fuente = sinComentarios(src(pantalla));

      expect(fuente, pantalla).toContain("folderListCount(");
      expect(fuente, pantalla).toContain("listCount: folderListCount(");
      expect(fuente, pantalla).not.toContain("folders.whatItHolds");
    }
  });
});

describe("la nota: la plantilla y el borrado se siguen moviendo lo que movian", () => {
  it("guardar como plantilla sale de la capacidad y no de un prop opcional escrito a mano", () => {
    /*
      La fila existe si la pantalla sabe hacerlo, y el adaptador es el que lee el
      parametro para contestar las dos mitades —capacidad y handler—. La pantalla
      pasa una funcion o no pasa nada, y nunca escribe un booleano que pueda
      contradecir a la funcion.
    */
    expect(src(ADAPTADOR_NOTA)).toMatch(/saveAsTemplate: acciones\.onSaveAsTemplate !== undefined/);
    expect(src(ADAPTADOR_NOTA)).toContain("guardarComoPlantilla:");

    for (const pantalla of CALL_SITES_NOTA) {
      expect(src(pantalla), pantalla).toContain("onSaveAsTemplate:");
    }
  });

  it("borrar sigue importando el modulo dinamicamente", () => {
    /*
      La razon esta escrita en `nota.ts`: el codigo de la unica escritura que no se
      puede deshacer no tiene por que estar cargado en una pantalla que nadie va a
      borrar nada. Y la **misma** importacion la hace `handlers.borrar` con un
      `await`, que es lo que la convierte en promesa y la deja entrar en el corredor
      de error de la hoja —que espera, avisa sin cerrar y cierra solo si va bien—.

      Sin comentarios, y verificado por mutacion: con el archivo entero, subir el
      `deleteNoteAction` a un import estatico y borrar la linea dinamica dejo el test
      en verde, porque el import aparece escrito en el comentario de arriba. Un guard
      que se satisface con su propia prosa no comprueba nada —es el fallo que cerro
      la T5 con el `testID` de la pantalla de coleccion—.
    */
    const adaptador = sinComentarios(src(ADAPTADOR_NOTA));

    expect(adaptador).toMatch(/await import\("@\/lib\/notes\/actions"\)/);
    expect(adaptador).toMatch(/borrar: async \(\) =>/);
    // Y que el import estatico **no** este arriba: si lo estuviera, el dinamico no
    // buyaria nada y la fila borraria con el codigo cargado igual.
    expect(adaptador).not.toMatch(/^import \{[^}]*deleteNoteAction/m);
  });

  it("y la pantalla ya no pasa onDeleted ni onChanged, porque no los pasaba nadie", () => {
    /*
      Los props de la hoja vieja eran `{ note, onClose, onSaveAsTemplate?,
      onDeleted?, onChanged? }` y **las dos pantallas pasaban solo
      `onSaveAsTemplate`**: los otros dos no los paso nadie, nunca. Asi que no es una
      capacidad que se pierda al migrar, son dos props sin un solo lector.

      Y lo que hacia `onChanged` —avisar que la nota cambio— no lo hace nadie porque
      no hace falta: `saveNoteAction` escribe en la cache local y las pantallas leen
      de ahi.

      Y el guard mira **los elementos** del menu, no el archivo: la pantalla del
      espacio le pasa `onDeleted` a la hoja del espacio —que es otra hoja y otro
      trato— y el `onChanged` de la pantalla de la nota es el que avisa del editor,
      no el de una fila del menu. Mirar el archivo entero daria dos falsos positivos
      que le enseñarian a este guard a ignorar lo que si dice.
    */
    for (const pantalla of CALL_SITES_NOTA) {
      const hojas = elementos(sinComentarios(src(pantalla)), "EntityMenuSheet");

      expect(hojas.filter((hoja) => hoja.includes("menuNota.")), pantalla).toHaveLength(1);

      for (const hoja of hojas) {
        expect(hoja, pantalla).not.toContain("onDeleted");
        expect(hoja, pantalla).not.toContain("onChanged");
      }
    }
  });
});