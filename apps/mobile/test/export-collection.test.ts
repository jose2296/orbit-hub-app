import { describe, expect, it, vi } from "vitest";

/*
  Las acciones de coleccion tocan la cache, que es `expo-sqlite` y no existe en
  Node. Sin el mock, importar el adaptador —que es puro y no pinta nada— seria
  importar la base de datos, y el fallo es `__DEV__ is not defined` al cargar
  `expo`, no un error de este test. Mismo apunte que el de
  `collection-screen.test.ts:35` y el de `bookmark-menu.test.ts` con
  `@/lib/bookmarks/actions`: el mock va **antes** del import que lo necesita,
  porque `vi.mock` se ejecuta antes que todo lo demas del archivo.
*/
vi.mock("@/lib/collections/actions", () => ({
  deleteCollectionAction: vi.fn(),
  updateCollectionAction: vi.fn(),
}));

import { exportFormatSchema } from "@orbit-hub/contracts";

import { menuCtxDeColeccion } from "@/components/menus/coleccion";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { menuDeLista } from "@/lib/menus/lista";
import type { AccionesDeLista } from "@/lib/menus/lista";
import { PAGINAS_MONTADAS, puedeOfrecerse } from "@/lib/menus/paginas";
import { ACCIONES, ORDEN_POR_KIND, accionesPara } from "@/lib/menus/registry";
import type { MenuContext, MenuKind } from "@/lib/menus/registry";

import {
  PAGINAS,
  hojasMontadas,
  hoja,
  paginasMontadas,
  sinComentarios,
  src,
} from "./menus-test-helpers";

/**
 * `ExportPage`, y el hueco que cerro.
 *
 * ------------------------------------------------------------------
 * POR QUE NO MONTA NADA
 * ------------------------------------------------------------------
 *
 * Por lo que ya dicen `entity-menu-sheet.test.ts`, `share-page.test.ts` y
 * `create-page.test.ts`: no hay `@testing-library` ni `jsdom` en este repo, y esta
 * pagina llega a `SheetOptions` y de ahi al dibujo del icono. Lo que se afirma aca
 * es **la costura**: que la pagina existe donde la hoja la busca, que sus filas
 * salen del enum de formatos del contrato y no de una lista escrita aca, que la
 * ruta sale del `ctx` y apunta a un endpoint, que al elegir un formato devuelve el
 * pedido y no corre nada, y que la hoja hermana de resultados **no** esta dentro
 * del `Sheet` del menu.
 *
 * Lo que no se puede comprobar y no se va a prometer: que al apretar "CSV" se
 * descargue el fichero. Eso se mira en la pantalla.
 *
 * ------------------------------------------------------------------
 * POR QUE EL GUARD DE "UNA SOLA HOJA" SIGUE VALIENDO
 * ------------------------------------------------------------------
 *
 * Porque hay una hoja hermana y aun asi la cuenta da uno: `hojasMontadas` cuenta
 * `<Sheet`, y `ExportResultSheet` es otro componente —el suyo vive en
 * `components/export/`—, asi que desde aca no hay ningun `<Sheet` que contar. Por
 * eso el bloque de abajo mira **la posicion** del hermano y no su ausencia: dos
 * `Modal` sobre una pantalla son dos fondos, y la unica cosa que lo evita es que
 * la hoja hermana este fuera del `Sheet` del menu.
 */

const PAGINA = `${PAGINAS}/export-page.tsx`;

/** Las filas que el menu ofrece de verdad, con el filtro puesto. */
function pintadas(ctx: MenuContext | null): string[] {
  if (!ctx) return [];
  return accionesPara(ctx)
    .filter(puedeOfrecerse)
    .map((accion) => accion.id);
}

/**
 * La tabla de recursos de la pagina, **leida del fuente**.
 *
 * Se parsea en vez de escribirse porque el valor que hay que aprobar es el que esta
 * en el archivo: una copia en el test aprobaria una tabla que nadie esta mirando.
 * Y sale por el nombre de la constante para que renombrarla falle con un mensaje
 * que lo diga.
 */
function recursosDelFuente(fuente: string): Record<string, string | null> {
  const bloque = fuente.match(/RECURSO_POR_KIND[^=]*=\s*\{([\s\S]*?)\n\}/)?.[1];

  if (bloque === undefined) {
    throw new Error("la pagina no declara RECURSO_POR_KIND, o no con esa forma");
  }

  const entradas: Record<string, string | null> = {};

  for (const linea of bloque.split("\n")) {
    const entrada = linea.match(/^\s*(?<kind>[a-zA-Z]+):\s*(?<valor>null|"[a-zA-Z]+")\s*,?\s*$/);

    // Con `noUncheckedIndexedAccess` el tipo no sabe que los dos grupos existen —
    // el `$` del patron lo exige—, asi que se comprueban por nombre.
    if (entrada?.groups?.kind === undefined || entrada.groups.valor === undefined) continue;

    const { kind, valor } = entrada.groups;
    entradas[kind] = valor === "null" ? null : valor.slice(1, -1);
  }

  return entradas;
}

/**
 * Los kinds a los que el registro **ofrece** la fila de exportar, y no solo la
 * declara. Sale del registro y del filtro, no de una lista escrita aca.
 */
function kindsQueExportan(): MenuKind[] {
  return (Object.keys(ORDEN_POR_KIND) as MenuKind[]).filter((kind) =>
    accionesPara({ ...ctxDe(kind), caps: { export: true } })
      .filter(puedeOfrecerse)
      .some((accion) => accion.id === "export"),
  );
}

function ctxDe(kind: MenuKind): MenuContext {
  return {
    kind,
    entity: { id: `${kind}-1`, title: "Recetas", role: "owner", shared: false },
    caps: { export: true },
  };
}

/**
 * Una lista y las cosas que su adaptador necesita, **para poder preguntar por
el `ctx` que arma de verdad**.

 * `folder` y `t` no son de `AccionesDeLista`: son del segundo parametro de
 * `menuDeLista`, que los pide para el subtitulo y para nada mas. El `t` de mentira
 * es el mismo apunte que `create-page.test.ts` usa con `menuDeCarpeta`: el
 * adaptador lo pide para el subtitulo y no para la fila que se esta mirando, asi
 * que puede devolver la clave. Y `menuDeLista` se llama con el `ctx` que sale de
 * el y no con uno escrito aca, que es lo unico que detecta que `lista.ts` deje de
 * poner `export: true`.
 */
const LISTA = {
  id: "l1",
  title: "Peliculas",
  kind: "movies",
  itemCount: 3,
  version: 1,
  role: "owner",
  shared: false,
} as never;

const ACCIONES_DE_LISTA = {
  layout: [],
  save: () => {},
  updateList: () => {},
  deleteList: () => {},
  duplicateList: () => {},
  folder: null,
  t: (clave: string) => clave,
} satisfies AccionesDeLista & { folder: null; t: (clave: string) => string };

describe("la fila de exportar vuelve a existir, y con la pagina que la monta", () => {
  it("`export` esta entre las paginas montadas", () => {
    /*
      ------------------------------------------------------------------
      LA REGRESION EN UNA LINEA, Y LA TERCERA VEZ
      ------------------------------------------------------------------

      `ACCIONES.export` declara `destino: { tipo: "pagina", page: "export" }` desde
      la T1 y `ORDEN_POR_KIND` la lista para lista y coleccion; sin esta entrada
      `puedeOfrecerse` saca la fila y **exportar deja de existir** en el menu. No
      hay ningun error ni ningun test rojo en el camino: una opcion que no esta y
      una opcion que todavia no se escribio se ven igual.

      Es el tercer caso del patron, despues de `share` (T11) y `create` (T12), y
      los tres se perdieron por la misma razon: el registro declara la fila desde
      el principio y la pagina que la monta llega en otra tarea.
    */
    expect(paginasMontadas()).toContain("export");
    expect(PAGINAS_MONTADAS).toContain("export");
  });

  it("y el filtro deja de sacarla para lista y para coleccion", () => {
    // Los `ctx` salen **de los adaptadores** y no de literales escritos aca: lo
    // que hay que comprobar es que la fila se ofrece para una entidad de verdad,
    // con las capacidades que `menuDeLista` y `menuCtxDeColeccion` le ponen. Un
    // `MenuContext` a mano aprobaria un `export: true` que el archivo hubiera
    // dejado de poner sin que nada se enterara.
    expect(pintadas(menuDeLista(LISTA, ACCIONES_DE_LISTA).ctx)).toContain("export");
    expect(
      pintadas(
        menuCtxDeColeccion({
          id: "c1",
          name: "Recetas",
          role: "owner",
          shared: false,
        } as never),
      ),
    ).toContain("export");
  });

  it("la capacidad la pone el call site, no la pagina, y sin ella no se ofrece", () => {
    // La fila es una capacidad y no un kind, y esa es la decision que hizo que no
    // apareciera en vez de aparecer y fallar. El otro lado —sin `caps.export` la
    // fila no se ofrece— lo comprueba `menu-registry.test.ts` para la lista; aca
    // se mira que el `ctx` sin la capacidad no la ofrezca tampoco a una coleccion.
    const sinCapacidad = menuCtxDeColeccion({
      id: "c1",
      name: "Recetas",
      role: "owner",
      shared: false,
    } as never);
    const apagada = sinCapacidad ? { ...sinCapacidad, caps: {} } : null;

    expect(ACCIONES.export?.disponible?.(ctxDe("collection"))).toBe(true);
    expect(pintadas(apagada)).not.toContain("export");
  });
});

describe("la pagina existe donde la hoja la busca", () => {
  it("la hoja la monta por pagina, y el directorio y la lista siguen siendo lo mismo", () => {
    // El guard de `entity-menu-sheet.test.ts` ya afirma el cruce del directorio
    // entero con `PAGINAS_MONTADAS`; se repite el path aca para que un fallo diga
    // que la pagina de exportar es la que falta y no "una pagina".
    expect(hoja).toMatch(/pagina === "export"/);
    expect(src(PAGINA)).toContain("export function ExportPage");
    expect(hoja).toContain("<ExportPage");
    expect(hoja).toContain("export function EntityMenuSheet");
  });

  it("y el subtitulo de la cabecera lo pone la hoja, que es quien la pinta", () => {
    // El subtitulo lo pinta el `Sheet`, que es el padre, y una pagina no puede
    // dictarselo a quien la contiene —el mismo reparto que el borrador de
    // renombrar, del otro lado del arbol—. La pagina usa `export.running` para la
    // espera y **no** para el subtitulo, porque la espera es estado y el subtitulo
    // es fijo.
    expect(hoja).toMatch(/export: "export\.format"/);
    expect(sinComentarios(src(PAGINA))).not.toMatch(/subtitle|title=/);
  });
});

describe("las dos filas se derivan del contrato, y en el orden del contrato", () => {
  it("los formatos salen del enum y no de una lista escrita en la pagina", () => {
    /*
      `exportFormatSchema.options` es el unico lugar del repo donde esta la lista de
      formatos que el servidor acepta. Escribirlos aca seria una copia que se
      desincroniza en silencio: un formato nuevo en el contrato llegaria a la API y
      no al menu, o al reves, y las dos cosas son una fila que ofrece algo que la
      API no contesta.
    */
    const codigo = src(PAGINA);

    expect(codigo).toContain('from "@orbit-hub/contracts"');
    expect(codigo).toContain("exportFormatSchema.options.map(");
    expect(codigo).not.toMatch(/\[\s*["']json["']\s*,\s*["']csv["']/);
    // Y una fila por formato, no una por formato escrito: el `map` es lo que hace
    // que el numero de filas no pueda ser otro que el del enum.
    expect(codigo).toContain("key: formato");
  });

  it("el orden es el del enum: JSON primero y CSV segundo", () => {
    // No por gusto: `json` esta antes que `csv` en el enum del contrato y el
    // builder responde en ese orden. JSON es la copia —todo lo que hay, en una
    // forma que se puede volver a leer— y CSV es el que se abre en una hoja de
    // calculo, que es donde esta quien lo elige. Invertirlo seria offering la
    // copia de una hoja de calculo como si fuera el fichero de la copia.
    expect([...exportFormatSchema.options]).toEqual(["json", "csv"]);

    // Y el icono de cada formato sale de una tabla completa sobre `ExportFormat`,
    // no de un icono suelto en la fila: con un `Record` parcial, un formato nuevo
    // en el contrato llegaria al menu sin icono y sin que el compilador pregunte.
    const codigo = src(PAGINA);

    expect(codigo).toMatch(/const ICONO_POR_FORMATO: Record<ExportFormat,/);
    expect(codigo).toContain('json: "code-slash-outline"');
    expect(codigo).toContain('csv: "grid-outline"');
  });

  it("cada formato tiene su frase, en los dos idiomas, y sale del contrato", () => {
    // La etiqueta se construye por plantilla —`export.format.${formato}`— para no
    // escribir dos claves a mano. Una clave que falta sale **cruda en pantalla**,
    // porque `t()` devuelve la propia clave cuando no la encuentra, asi que este
    // guard pregunta valor por valor contra el enum y no contra una lista escrita.
    for (const formato of exportFormatSchema.options) {
      const clave = `export.format.${formato}` as keyof typeof dictionaries.es;

      expect(dictionaries.es[clave], `${clave} falta en es`).toBeTruthy();
      expect(dictionaries.en[clave], `${clave} falta en en`).toBeTruthy();
    }

    // Y la clave de la espera, que es lo unico que la pagina pinta y no viene de
    // una fila.
    for (const locale of ["es", "en"] as const) {
      expect(dictionaries[locale]["export.running"], `export.running falta en ${locale}`).toBeTruthy();
    }

    expect(src(PAGINA)).toContain("t(`export.format.${formato}` as TranslationKey)");
  });

  it("las filas se apagan mientras hay una exportacion en vuelo", () => {
    // No es decoracion: el menu se cierra antes de que salga el peticion, asi que
    // la unica forma de ver esta pagina con algo en vuelo es reabrir el menu
    // mientras el fichero baja. Dos filas grises sin frase son un menu roto, y por
    // eso la pagina pinta `export.running` en ese estado.
    const codigo = src(PAGINA);

    expect(codigo).toContain("disabled: running");
    expect(codigo).toContain("running ? (");
    expect(codigo).toContain('t("export.running")');
    // Y `running` es una prop y no estado de la pagina: la pagina no sabe si hay
    // una peticion en vuelo, lo sabe la hoja que la corre.
    expect(codigo).toContain("running: boolean");
    expect(codigo).not.toMatch(/useExport|deliverExport/);
  });
});

describe("la ruta sale del ctx y apunta a un endpoint", () => {
  it("la tabla cubre todos los kinds, y no hay kind nuevo sin decidir", () => {
    // El `Record<MenuKind, ...>` del tipo ya obliga a esto en tiempo de
    // compilacion; el guard lo afirma porque el typecheck no corre con cada test y
    // porque **la lista de kinds sale del registro**.
    const recursos = recursosDelFuente(src(PAGINA));

    expect(Object.keys(recursos).sort()).toEqual(Object.keys(ORDEN_POR_KIND).sort());
  });

  it("todo kind al que se le ofrece la fila tiene recurso, y sin recurso no hay endpoint", () => {
    const recursos = recursosDelFuente(src(PAGINA));

    for (const kind of kindsQueExportan()) {
      expect(
        recursos[kind],
        `el registro ofrece exportar a "${kind}" y la pagina no tiene ruta para el`,
      ).toBeTruthy();
      expect(
        ACCIONES.export?.disponible?.(ctxDe(kind)),
        `${kind} recibe la fila y el recurso sale en null`,
      ).toBe(true);
    }

    // Y la vuelta: un recurso no nulo para un kind al que el registro **no** le
    // ofrece la fila es una ruta que existe en el menu y a la que nadie llega, o
    // peor, un `kind` que se ofrece con una ruta equivocada.
    for (const [kind, recurso] of Object.entries(recursos)) {
      if (recurso === null) continue;

      expect(
        kindsQueExportan(),
        `"${kind}" tiene ruta de exportacion y el registro no le ofrece la fila`,
      ).toContain(kind);
    }
  });

  it("y la ruta se arma con el id del ctx, no con un id escrito en la pagina", () => {
    // Un id en la pagina seria el id de otra entidad, y el fallo —un 404, o peor,
    // el fichero de otra persona— no aparece hasta que alguien exporta.
    const codigo = sinComentarios(src(PAGINA));

    expect(codigo).toContain("path: `/${recurso}/${ctx.entity.id}/export`");
    expect(codigo).not.toMatch(/path:\s*["'`]\/[^"'`]*[0-9a-f]{8}-/);
  });

  it("el endpoint existe, y el servidor es el que lo declara", () => {
    // El otro lado de la comparacion, y el que de verdad importa: una ruta que la
    // pagina construye y el API no monta es un 404 con una pantalla que dice "no lo
    // encuentras". Los dos se leen del **servidor**, no de una constante del test:
    // el `Router.get` de cada archivo de rutas es lo que existe.
    //
    // Y la ruta se lee de un archivo de `apps/api`, asi que el path sale de
    // `RAIZ` —`apps/mobile`— con `..` y no con un `../../api` a ojo: el helper
    // resuelve contra el directorio de este archivo de test y no contra el `cwd`.
    const rutas = Object.values(recursosDelFuente(src(PAGINA)))
      .filter((recurso): recurso is string => recurso !== null)
      .map((recurso) => src(`../api/src/routes/${recurso}.ts`));

    // Y son dos, que es lo que declara el registro: si la tabla de la pagina
    // dejara de tener un recurso, el bucle pasaria sobre menos rutas y este guard
    // diria que todo sigue bien.
    expect(rutas).toHaveLength(2);

    for (const fuente of rutas) {
      expect(fuente, "la ruta de exportacion no esta montada").toMatch(
        /Router\.get\('\/:id\/export'/,
      );
      // Y con `sendFile`, que es lo que la distingue de un 2xx con `{ data, meta }`:
      // el fichero se baja entero y el movil lo relee del cache.
      expect(fuente).toContain("sendFile(res, 200, fichero)");
    }
  });
});

describe("la pagina devuelve el pedido y no corre nada", () => {
  it("el pedido lo arma con lo del ctx y lo entrega entero", () => {
    /*
      La division que hace que esto no sea una segunda implementacion de exportar:
      la pagina sabe **que** se pide —ruta, formato, nombre y `fallbackId`—, y la
      hoja sabe **cuando** y **que hacer con el resultado**. Un `onSelect(format)` con
      los campos sueltos seria lo mismo repartido en cinco parametros; y un
      `onExport({path, format, title, fallbackId})` con un `fallbackId` puesto a mano
      seria una segunda fuente para algo que el registro ya sabe.
    */
    const codigo = sinComentarios(src(PAGINA));

    expect(codigo).toContain("title: ctx.entity.title");
    expect(codigo).toContain("fallbackId: ctx.entity.id");
    expect(codigo).toContain("onPress: () => onExport(pedidoDe(formato))");
    expect(codigo).not.toMatch(/onClose|router|navigation|apiRaw|apiRequest/);
  });

  it("y no decide nada del menu: ni lo cierra ni lo sabe", () => {
    // La hoja es la que cierra antes de pedir —es lo unico que garantiza que las
    // dos hojas no se pisen— y la pagina no tiene por que saberlo. Una pagina que
    // se cierra sola tendria dos formas de irse del menu, y el `Sheet` se queda
    // montado 330 ms en su salida.
    expect(hoja).toMatch(/exportar[\s\S]{0,220}onClose\(\);\s*\n\s*try/);
    expect(sinComentarios(src(PAGINA))).not.toMatch(/onClose|useSheetSucio|setSucio/);
  });
});

describe("la hoja hermana del resultado no esta dentro del menu", () => {
  it("la pagina no monta ninguna hoja, ni el nombre de la hermana", () => {
    // `ExportPage` es una pagina de la hoja unica. Si montara un `Sheet`, seria
    // `Modal` dentro de `Modal`: dos fondos sobre una pantalla y un toque que llega
    // al de arriba cerrando el de abajo. Es el mismo guard que corre sobre el
    // directorio entero en `entity-menu-sheet.test.ts`; se repite para que un fallo
    // diga que la pagina de exportar es la que lo rompe.
    expect(hojasMontadas(src(PAGINA)), "una pagina con Sheet es panel sobre panel").toBe(0);

    // Y el **nombre** de la hoja hermana tampoco sale de aca, mirado sin la prosa:
    // la pagina explica arriba por que el resultado no es una pagina suya, y un
    // `not.toContain` sobre el fuente entero se encontraria con su propia
    // explicacion y fallaria por la razon equivocada. Lo que se afirma es que no
    // la monta, no que la palabra no este.
    expect(sinComentarios(src(PAGINA))).not.toContain("ExportResultSheet");
  });

  it("la hoja la monta **fuera** del Sheet del menu, y por eso el menu se cierra antes", () => {
    /*
      Lo unico que evita que las dos hojas coexistan es el orden dentro de
      `exportar`: `onClose()` antes de `run`. Por eso el guard mira las dos mitades
      juntas —la hoja hermana despues de `</Sheet>` **y** el cierre antes del
      `await`—: cualquiera de las dos sola pasa en un archivo donde la otra se
      rompió.
    */
    const sister = hoja.indexOf("<ExportResultSheet");

    expect(sister, "la hoja no monta la hoja hermana de resultados").toBeGreaterThan(-1);
    expect(hoja.indexOf("</Sheet>"), "el menu no cierra su Sheet").toBeGreaterThan(-1);
    expect(
      sister,
      "la hoja hermana esta dentro del Sheet del menu: son dos Modal sobre una pantalla",
    ).toBeGreaterThan(hoja.indexOf("</Sheet>"));

    // Y la hoja del menu sigue siendo una sola: `hojasMontadas` cuenta `<Sheet` y
    // el hermano es otro componente, asi que el numero no se mueve. Sin esta
    // linea, el guard de "una sola hoja" de arriba podria estar contando la mitad
    // de lo que hay sin que nadie lo notara.
    expect(hojasMontadas(hoja)).toBe(1);
  });

  it("el reintento reenvia el mismo pedido, y el pedido se guarda en un ref", () => {
    /*
      La razon por la que el pedido va en un `ref` y no en estado: **el reintento
      tiene que ser la misma peticion**. Reconstruido en el momento, cogeria el
      titulo de ahora —que tras un renombrar es el nombre de otro fichero— y el
      formato de la lista, que es JSON, cuando el que fallo era CSV. Las dos cosas
      son "reintentar" de palabra y son otra exportacion en los hechos.
    */
    const codigo = sinComentarios(hoja);

    expect(codigo).toContain("useRef<ExportRequest | null>(null)");
    expect(codigo).toMatch(/const reintentarExport[\s\S]{0,200}pedidoDeExport\.current/);
    expect(codigo).not.toMatch(/reintentarExport[\s\S]{0,200}pedidoDe\(\s*["']json/);
  });

  it("el titulo de la hoja hermana sale del pedido, no del ctx de pantalla", () => {
    // Si el intento se resolviera con otra entidad delante, un titulo leido del
    // `ctx` seria el nombre equivocado sobre los numeros correctos. Es el mismo
    // argumento por el que la hoja vieja pasaba `request.current?.title`.
    expect(sinComentarios(hoja)).toContain("title={pedidoDeExport.current?.title}");
  });
});
