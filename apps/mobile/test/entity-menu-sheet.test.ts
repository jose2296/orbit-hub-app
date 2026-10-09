import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ACCIONES, accionesPara } from "@/lib/menus/registry";
import type { MenuContext } from "@/lib/menus/registry";

import { PANELES_DE_LA_HOJA_VIEJA as PANELES_DE_LA_CARPETA_VIEJA } from "./fixtures/folder-menu-sheet-options";
import {
  PAGINAS,
  RAIZ,
  hojasMontadas,
  hoja,
  paginasEnElDirectorio,
  paginasMontadas,
  sinComentarios,
  src,
} from "./menus-test-helpers";

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
 * El patron es el de `sheet-back.test.ts`. Lo que se lee del fuente de la hoja y
 * del directorio de paginas **no vive aca**: esta en `menus-test-helpers.ts`, que
 * es de donde `icon-page.test.ts` lo toma tambien, porque eran la misma funcion
 * escrita dos veces.
 */

const hay = (ruta: string) => existsSync(join(RAIZ, ruta));

const RENOMBRAR = `${PAGINAS}/rename-page.tsx`;
const BORRAR = `${PAGINAS}/delete-page.tsx`;

const COLECCION: MenuContext = {
  kind: "collection",
  entity: { id: "c1", title: "Recetas", role: "owner", shared: false },
  caps: {},
};

describe("una sola hoja, y con una pila de paginas adentro", () => {
  it("monta un unico Sheet", () => {
    expect(hojasMontadas(hoja), "mas de un Sheet es panel sobre panel").toBe(1);
  });

  it("la hoja de carpeta, que es lo que se esta reemplazando, montaba varios", () => {
    /*
      El contraste tiene que estar en el test, o "un solo Sheet" no dice nada: es
      una afirmacion sobre un numero que el archivo nuevo podria cumplir por tener
      menos contenido.

      Y el numero sale de un **fixture**, no de leer la hoja vieja: esa se borro en
      la T7, y un guard que lee un archivo que se guardo se queda comprobando nada
      sin avisar. Los paneles congelados estan en
      `fixtures/folder-menu-sheet-options.ts`, que es donde vive la razon de por que
      eran seis.
    */
    expect(hojasMontadas(PANELES_DE_LA_CARPETA_VIEJA)).toBeGreaterThan(1);
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

describe("la pregunta de salir sin guardar llega a la hoja", () => {
  /*
    ------------------------------------------------------------------
    POR QUE ESTE BLOQUE CAMBIO DE SIGNO
    ------------------------------------------------------------------

    Antes afirmaba dos cosas: que la hoja derivaba `sucio` y que la pagina **no**
    lo hacia. Las dos eran el bug, escritas como si fueran el acuerdo.

    `SheetSucioContexto.Provider` esta **dentro** del `<Modal>` de `Sheet`
    (`sheet.tsx:630`), asi que el que consume el contexto tiene que ser un **hijo**
    de `Sheet`. `EntityMenuSheet` es su **padre**: su `useSheetSucio()` leia el
    contexto por defecto y escribia a un `() => {}`. La pregunta no se armo nunca,
    con dos propiedades que la hacen invisible: no rompe nada y `setSucio` no
    fallando es indistinguible de `setSucio` funcionando. Un `not.toContain` en la
    pagina era un guard que **impedia el arreglo**.

    Asi que ahora hay dos mitades y las dos importan por igual:

    - la pagina **si** arma, porque ahi el canal llega, y
    - la hoja **no** arma, porque si vuelve a hacerlo el bug regresa sin que nada
      se rompa.
  */

  it("la pagina de renombrar arma 'sucio' a traves del canal", () => {
    // El `setSucio` de la pagina: una llamada a la `useSheetSucio`, y por eso
    // llega. El guard mira **la llamada**, no la palabra, porque la pagina explica
    // en un comentario por que la tiene y un `toContain` sin mas no distinguiria
    // esa explicacion del codigo.
    const pagina = sinComentarios(src(RENOMBRAR));

    expect(pagina).toMatch(/\{\s*setSucio\s*\}\s*=\s*useSheetSucio\(\)/);
    // Y deriva de los dos datos que se le pasan, no de un estado propio: el
    // borrador tiene que sobrevivir a la flecha y por eso vive en la hoja.
    expect(pagina).toMatch(/setSucio\(borrador !== null && borrador\.trim\(\) !== titulo\.trim\(\)\)/);
  });

  it("la hoja NO arma 'sucio', porque ahi el canal no llega", () => {
    /*
      La mitad que se pierde sin querer. Es tentador "dejarlo en la hoja" porque
      la verdad —el borrador— si vive ahi, y parece el lugar natural; y el
      `setSucio` no falla cuando escribe al valor por defecto, asi que el cambio
      entra verde, los tres guards de esta hoja siguen pasando, y la pregunta
      sigue sin estar conectada a nada.

      Se mira el **codigo sin los comentarios**, y no el archivo entero: la hoja
      explica aca mismo por que la llamada vivio aqui y por que se fue, y un
      `not.toMatch` sobre el fuente entero se encontraria con su propia prosa y
      fallaria por la razon equivocada. Lo que se afirma es que el codigo no la
      usa: sin el import no puede haber llamada.
    */
    expect(sinComentarios(hoja), "la hoja llama a useSheetSucio").not.toMatch(/useSheetSucio/);
    expect(sinComentarios(hoja), "la hoja llama a setSucio").not.toMatch(/setSucio/);
  });

  it("y la hoja le pasa a la pagina lo que hay que derivar", () => {
    // El `borrador` y el `titulo` llegan por props, no por `ctx`: el `MenuContext`
    // no lleva un borrador —el registro no conoce borradores— y la pagina no
    // recibe el `ctx` entero desde T2.
    expect(hoja).toMatch(/borrador=\{borrador\}/);
    expect(hoja).toMatch(/titulo=\{titulo\}/);
  });

  it("el borrador se distingue de 'nada escrito', o el menu abre sucio", () => {
    // `borrador: string` arrancaba en `""` contra un titulo no vacio, o sea
    // "sucio" en un menu que nadie habia tocado. Y `null` es lo que viaja a la
    // pagina: es el unico dato que distingue "nadie escribio" de "borro el campo".
    expect(hoja).toMatch(/useState<string \| null>\(null\)/);
    expect(sinComentarios(src(RENOMBRAR))).toContain("borrador: string | null;");
  });

  it("la pagina NO lo resetea al desmontarse, que es el otro bug", () => {
    /*
      La flecha de "Volver" desmonta la pagina **con el texto escrito ahi**. Un
      `return () => setSucio(false)` en su cleanup desarmaria la pregunta en el
      mismo toque, y cerrar despues se iria sin preguntar: edicion perdida en
      silencio, por el otro lado, y con el arreglo de arriba puesto para que se
      notara.

      Y el reset que hace falta **ya existe** y no hay que repetirlo: `Sheet` limpia
      su propio "sucio" al abrir (`sheet.tsx:200-205`), que es el unico momento en
      que "vacio" tiene que significar vacio.
    */
    const pagina = sinComentarios(src(RENOMBRAR));

    expect(pagina).toMatch(/useEffect\(\(\) => \{\s*setSucio\(/);

    /*
      Y el marcador del reset es **`setSucio(false)` a secas**, no una forma
      concreta de cleanup: la derivacion de arriba escribe un booleano —`true` o
      `false` segun la comparacion— y nunca el literal, asi que cualquier
      `setSucio(false)` escrito aqui es alguien desarmando la pregunta a mano.

      Se busco esa forma primero —`return () => setSucio(false)` en un cleanup— y
      el guard pasaba con un `useEffect(() => () => setSucio(false), [])` al lado:
      es el mismo bug con otra sintaxis, y un guard que solo conoce una forma del
      fallo es un guard que el proximo escribe de otra manera. El literal no
      tiene sinaxis.
    */
    expect(
      pagina,
      "la pagina desarma la pregunta al desmontarse: el borrador sobrevive a la flecha y la pregunta tiene que sobrevivir con el",
    ).not.toMatch(/setSucio\(false\)/);
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
    /*
      El **codigo sin los comentarios**, y no el archivo entero. La hoja explica en un
      bloque por que cada pagina se monta como se monta, y esos comentarios nombran el
      registro —`ORDEN_POR_KIND.folder` en el de la pagina `create`—, asi que un
      `not.toContain` sobre el fuente entero se encuentra con su propia prosa y falla
      por la razon equivocada: no es que la hoja ordene, es que la hoja lo explique.

      Lo que se afirma es que no **usa** el orden: sin la llamada no hay lectura, y
      `ACCIONES[` es la forma de indexar el catalogo, que tampoco puede aparecer.
    */
    const codigo = sinComentarios(hoja);

    expect(codigo, "la hoja lee el orden del registro").not.toContain("ORDEN_POR_KIND");
    expect(codigo, "la hoja indexa el catalogo de acciones").not.toContain("ACCIONES[");
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

describe("las paginas que la hoja monta hoy", () => {
  it("la lista de paginas montadas y los archivos que hay son lo mismo", () => {
    // Si se declara una pagina que no existe, la fila lleva a un hueco; si existe
    // un archivo que nadie declara, la pagina esta muerta. Las dos cosas son
    // fallos de escritura y las dos se ven aca.
    expect([...paginasMontadas()].sort()).toEqual(paginasEnElDirectorio().sort());
  });

  it("ninguna pagina monta su propia hoja", () => {
    // El directorio entero y no la lista de arriba: cuando se agrego `icon-page`
    // esta lista manual seguia diciendo "ninguna" y no miraba la pagina nueva.
    for (const pagina of paginasEnElDirectorio()) {
      expect(
        hojasMontadas(src(`${PAGINAS}/${pagina}-page.tsx`)),
        `${pagina} monta un Sheet`,
      ).toBe(0);
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
    // `rename` y `delete`, y eso son las dos filas que tienen que seguir saliendo.
    // `access` y `export` son filas de mas que el registro declara; `access` las
    // ofrecio la T8 y `export` la T9, y lo que se comprueba para las dos esta
    // abajo y en `collection-screen.test.ts`.
    const ids = accionesPara(COLECCION).map((accion) => accion.id);

    expect(ids).toContain("rename");
    expect(ids).toContain("delete");
  });

  it("la fila de acceso ya no esta pendiente, y el hueco quedo vacio", () => {
    /*
      ------------------------------------------------------------------
      LOS HUECOS QUE ESTUVIERON ACA, Y POR QUE EL TEST NO SE BORRO
      ------------------------------------------------------------------

      Este test existia al reves: decia que `access` se filtraba porque su pagina
      era de la T8, y enumeraba el hueco como una perdida declarada. T8 la monto y
      el hueco se cerro, asi que **ahora** lo que se afirma es que no quedo nada.

      `export` fue el segundo, y lo cerro la T9 cuando creo
      `GET /collections/:id/export` y monto su pagina. El `ctx` de arriba lleva
      `caps: {}` a proposito —es el `ctx` minimo, no el que arma `coleccion.ts`— y
      por eso `export` ni se ofrece aqui: lo que se comprueba para esa fila es que
      **este** conjunto quedo vacio, y lo que se ofrece de verdad se mira en
      `collection-screen.test.ts`, sobre el `ctx` del adaptador.

      El valor de haberlo tenido escrito es que la perdida fue una decision con
      nombre y no un olvido — que es exactamente como se encontraron `share` y
      `create`, las otras dos. La diferencia es que esas la agarraron sus
      implementadores y no el plan.
    */
    const montadas = paginasMontadas();
    const sinMontar = accionesPara(COLECCION)
      .flatMap((accion) => (accion.destino.tipo === "pagina" ? [accion.destino.page] : []))
      .filter((page) => !montadas.includes(page));

    // El conjunto de pendientes declarados, con la tarea que cierra cada hueco.
    const PENDIENTES: Record<string, string> = {};

    for (const page of sinMontar) {
      expect(
        PENDIENTES[page],
        `la pagina "${page}" no se monta y no hay nadie anotado para escribirla`,
      ).toBeTruthy();
    }

    // Y el conjunto sigue vacio: `access` se monto en la T8 y `export` en la T9.
    expect(sinMontar).toEqual([]);
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
