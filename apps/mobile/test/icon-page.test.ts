import { describe, expect, it } from "vitest";

import { dictionaries } from "@/lib/i18n/dictionaries";
import { ORDEN_POR_KIND, accionesPara } from "@/lib/menus/registry";
import type { MenuContext, MenuKind } from "@/lib/menus/registry";

import {
  PAGINAS,
  hojasMontadas,
  hoja,
  paginasMontadas,
  src,
  tsxDeLaApp,
} from "./menus-test-helpers";

/**
 * `IconPage` y `MenuButton`, por fuente.
 *
 * ------------------------------------------------------------------
 * POR QUE ESTE TEST NO MONTA NADA
 * ------------------------------------------------------------------
 *
 * Porque en este repo no hay donde: no hay `@testing-library/react-native` ni
 * `jsdom`, y `IconPickerPanel` es una `FlatList` con `useWindowDimensions` de
 * react-native. Asi que lo que se afirma aca es lo mecanico y lo que se puede
 * leer: que la pagina monta el **panel** y no una hoja, que la accion `icon` del
 * registro llega a una pagina que esta version monta, que el `null` de "sin
 * icono" llega al handler sin filtrarse, que el panel no toma toques mientras se
 * escribe, y que el boton de menu de una fila vive en un archivo en vez de en la
 * pantalla que lo usa.
 *
 * Lo que no se puede comprobar aca, y no se va a prometer: que al tocar una
 * celda del grid se guarde el icono. Eso se mira en la pantalla.
 *
 * El patron es el de `entity-menu-sheet.test.ts` y el de `sheet-back.test.ts`, y
 * lo que se lee del fuente de la hoja y del directorio de paginas sale de
 * `menus-test-helpers.ts` en vez de estar escrito otra vez aca.
 *
 * ------------------------------------------------------------------
 * POR QUE LAS AFIRMACIONES DE ESTE TEST NO ESTAN ESCRITAS A MANO
 * ------------------------------------------------------------------
 *
 * Porque un guard que copia la fuente se desincroniza en silencio: en T2 el
 * guard de iconos listaba once a mano y se le olvido el duodecimo, y paso en
 * verde. Asi que lo de aqui sale del archivo, del directorio o del registro:
 * los kinds vienen de `Object.keys(ORDEN_POR_KIND)`, las paginas montadas del
 * fuente de la hoja, la etiqueta del boton de la linea que la usa, y la clave
 * del subtitulo de la accion `icon` del registro.
 *
 * Lo que **si** estaba escrito a mano era el andamiaje: `RAIZ`, `src` y las dos
 * listas de paginas eran copia de `entity-menu-sheet.test.ts`, y esa duplicacion
 * fue el hallazgo de la revision. Ahora esta en un modulo.
 */

const ICONO = `${PAGINAS}/icon-page.tsx`;
const SELECTOR = "src/components/ui/icon-picker-sheet.tsx";
const BOTON = "src/components/ui/menu-button.tsx";
const LISTA = "src/components/content/content-list.tsx";

const boton = src(BOTON);
const lista = src(LISTA);

/**
 * La clave de i18n que la hoja le pone de subtitulo a una pagina.
 *
 * El `const` y el `};` del cierre estan porque el nombre solo tambien matchea la
 * lectura de la tabla —`SUBTITULO_POR_PAGINA[pagina]`— y ahi el bloque que se
 * captura es media hoja, que es el peor de los dos mundos para un guard.
 */
function subtituloDe(pagina: string): string | undefined {
  const bloque = hoja.match(/const SUBTITULO_POR_PAGINA[^=]*=\s*\{([\s\S]*?)\n\};/);
  return bloque?.[1]?.match(new RegExp(`\\b${pagina}:\\s*"([^"]+)"`))?.[1];
}

/** Todos los kinds, del registro: no hay lista de kinds escrita aca. */
const KINDS = Object.keys(ORDEN_POR_KIND) as MenuKind[];

/** Un `MenuContext` con todas las capacidades, para que solo disponibilidad del tipo corte. */
function ctx(kind: MenuKind): MenuContext {
  return {
    kind,
    entity: { id: "x", title: "Algo", role: "owner", shared: false },
    caps: { editStates: true, saveAsTemplate: true, createInside: true, panel: true, export: true },
  };
}

describe("la pagina de icono es un panel, y no una hoja encima de la hoja", () => {
  it("monta el panel y no monta ninguna hoja", () => {
    // `IconPickerSheet` es un `Sheet`, y un `Sheet` es un `Modal`: montarlo
    // adentro de `EntityMenuSheet` son dos fondos sobre una pantalla y un toque
    // que llega a la de arriba cerrando la de abajo. Es el motivo por el que
    // `icon-picker-sheet.tsx` exporta las dos puertas.
    expect(hojasMontadas(src(ICONO)), "una pagina con Sheet es panel sobre panel").toBe(0);
    expect(src(ICONO)).toMatch(/<IconPickerPanel[\s/>]/);
  });

  it("y no pide la puerta que si trae hoja", () => {
    // El guard mira el **uso**, no la palabra: la pagina explica en un
    // comentario por que no usa la hoja, y un `not.toContain("IconPickerSheet")`
    // pasaria por encima de esa explicacion y dejaria de comprobar justo cuando
    // el comentario esta. Es la misma trampa que el `useSheetSucio` de T2.
    expect(src(ICONO)).not.toMatch(/<IconPickerSheet[\s/>]/);
    expect(src(ICONO)).toMatch(/import \{ IconPickerPanel \} from "@\/components\/ui\/icon-picker-sheet"/);
  });

  it("la otra puerta si sigue montando su hoja, o el contraste no dice nada", () => {
    // Sin esto, "esta pagina no monta un Sheet" pasaria en un archivo que no
    // monta nada: es una afirmacion sobre una ausencia y necesita la presencia
    // al lado para que signifique algo.
    expect(hojasMontadas(src(SELECTOR))).toBe(1);
    expect(src(SELECTOR)).toMatch(/export function IconPickerSheet/);
    expect(src(SELECTOR)).toMatch(/export function IconPickerPanel/);
  });
});

describe("la accion icon del registro llega a una pagina que existe", () => {
  it("todo kind al que se le ofrece icono tiene la pagina montada", () => {
    const conIcono = KINDS.filter((kind) =>
      accionesPara(ctx(kind)).some((accion) => accion.id === "icon"),
    );

    expect(conIcono.length, "sin kinds con icono el guard no comprobaria nada").toBeGreaterThan(0);

    for (const kind of conIcono) {
      const icono = accionesPara(ctx(kind)).find((accion) => accion.id === "icon")!;

      expect(icono.destino, `${kind}: la fila de icono tiene que decir a donde va`).toEqual({
        tipo: "pagina",
        page: "icon",
      });
      expect(paginasMontadas(), `${kind} ofrece icono y la hoja no lo monta`).toContain("icon");
    }
  });

  it("el subtitulo de la pagina es la etiqueta que el registro le pone a la fila", () => {
    // Las dos claves salen de su lado: la de la fila del registro y la del
    // subtitulo del fuente de la hoja. Si `ACCIONES.icon` cambia de copy, esta
    // tiene que cambiar con el y no quedar mostrando la palabra de ayer. Y el
    // descriptor sale de `accionesPara` y no de `ACCIONES.icon`, para que el
    // guard no dependa de escribir el id a mano.
    const kind = KINDS.find((k) => accionesPara(ctx(k)).some((accion) => accion.id === "icon"))!;
    const icono = accionesPara(ctx(kind)).find((accion) => accion.id === "icon")!;

    expect(typeof icono.labelKey, "el copy de icono no depende del tipo").toBe("string");
    expect(subtituloDe("icon")).toBe(icono.labelKey);
  });
});

describe("sin icono es null, y null llega hasta el handler", () => {
  it("la fila de 'sin icono' existe en el selector y manda null", () => {
    // Leido del selector y no afirmado de memoria: si esa fila se va, el
    // `null` deja de existir y el guard tiene que enterarse.
    expect(src(SELECTOR)).toMatch(/onPress=\{\(\) => onSelect\(null\)\}/);
  });

  it("la pagina admite el null en vez de narrowing a IconRef", () => {
    // Si el prop fuera `(icon: IconRef) => void`, el `onSelect(null)` del
    // selector no compilaria al pasar el tipo: el compilador es el filtro.
    expect(src(ICONO)).toMatch(/onSelect: \(icon: IconRef \| null\) => void/);
    expect(src(ICONO)).toMatch(/current=\{icon\}/);
  });

  it("y la hoja lo pasa al handler sin filtrarlo", () => {
    /*
      El cuerpo de `ponerIcono` y no el archivo entero, porque el riesgo es
      local: un `if (!icon) return` o un `icon ?? undefined` compilan, dejan la
      fila de "sin icono" conectada a un handler que nunca corre, y no dicen
      nada por eso.
    */
    const declarada = hoja.match(
      /const ponerIcono = \(icon: IconRef \| null\) => \{([\s\S]*?)\n {2}\};/,
    );

    expect(declarada, "la hoja tiene que declarar ponerIcono").not.toBeNull();
    const cuerpo = declarada![1]!;

    expect(cuerpo).toContain("handlersVivos.icon");
    expect(cuerpo).toMatch(/\(\) => handler\(icon\)/);
    expect(cuerpo, "el null de 'sin icono' no puede filtrarse por verdadismo").not.toMatch(
      /if \(!?icon\b/,
    );
    expect(cuerpo, "el null de 'sin icono' no puede rellenarse").not.toMatch(/icon \?\?/);
  });

  it("el icono que se esta mirando es el de la entidad, y lo recibe la hoja", () => {
    // Sin esto la pagina no tiene de donde sacar el `current`: `MenuEntity` no
    // trae icono —el registro no pregunta por ese campo a nadie— y por eso el
    // dato entra como prop y no por el `ctx`.
    expect(hoja).toMatch(/icon\?: IconRef \| null/);
    expect(hoja).toMatch(/<IconPage/);
    expect(hoja).toMatch(/icon=\{iconoVivo\}/);
    expect(hoja).toMatch(/onSelect=\{ponerIcono\}/);
  });
});

describe("el boton de menu de una fila vive en un archivo", () => {
  it("la lista lo importa y ya no lo declara", () => {
    /*
      El import trae dos simbolos y no uno: `MenuButton` y `ANCHO_RESERVADO`, el
      ancho que el boton necesita que le reserven. Por eso el patron admite los
      que.nlista dentro de las llaves en vez de exactamente uno — lo que el guard
      afirma es de donde sale el boton, no cuantos nombres viajan en la linea.
    */
    expect(lista).toMatch(
      /import \{[^}]*\bMenuButton\b[^}]*\} from "@\/components\/ui\/menu-button"/,
    );
    expect(lista).toMatch(/<MenuButton\b/);
    expect(lista, "la copia local es lo que esta tarea vino a sacar").not.toMatch(
      /function BotonMenu/,
    );
  });

  it("conserva la accesibilidad y el area tactil que tenia", () => {
    // El area de 40x40 con `hitSlop` es lo que hace el boton alcanzable con un
    // dedo, y `rowActions.menuOf` es lo que lee el lector de pantalla: las dos
    // cosas se pierden en silencio cuando un boton se reescribe de memoria.
    expect(boton).toMatch(/accessibilityRole="button"/);
    expect(boton).toMatch(/hitSlop=\{8\}/);
    expect(boton).toContain('t("rowActions.menuOf", { name: label })');
    expect(boton).toMatch(/ellipsis-horizontal/);
  });

  it("la etiqueta sale del diccionario, y existe en los dos idiomas", () => {
    // La clave se **lee de la linea que la usa**, no se escribe aca: si el
    // archivo cambia de copy, el guard va con el.
    const clave = boton.match(/t\("([^"]+)", \{ name: label \}\)/)?.[1];

    expect(clave, "el boton tiene que pedir una clave, no una frase").toBeTruthy();
    expect(dictionaries.es[clave as keyof typeof dictionaries.es]).toBeTruthy();
    expect(dictionaries.en[clave as keyof typeof dictionaries.en]).toBeTruthy();
  });

  it("y es el unico archivo del arbol que la declara", () => {
    // Derivado del arbol entero, no de una lista de archivos: por eso T4 puede
    // usar `MenuButton` en las filas de los enlaces sin que este guard haya
    // que enterarse, y por eso una segunda copia si se cuela, falla.
    const conLaEtiqueta = tsxDeLaApp().filter((nombre) =>
      src(`src/${nombre}`).includes("rowActions.menuOf"),
    );

    expect(conLaEtiqueta).toEqual(["components/ui/menu-button.tsx"]);
  });

  it("el posicionamiento absoluto viaja con el boton y no queda en la fila", () => {
    // `styles.menu` es `position: "absolute"`: sin el, el boton se va de flujo y
    // se monta encima del nombre de la fila, y como se dibuja igual de bien
    // parece que funciona.
    expect(boton).toMatch(/position: "absolute"/);
    expect(lista, "el estilo se mudo con el componente").not.toContain("styles.menu");
  });

  it("y todo archivo que lo monta tiene la caja relativa que el boton necesita", () => {
    /*
      La otra mitad del contrato, y la que se pierde en silencio: `absolute` sin
      un padre relativo se posiciona contra el contenedor equivocado. El boton
      dice en su comentario que lo necesita y `content-list.tsx` lo tiene
      (`caja: { position: "relative" }`), pero "lo tiene hoy" no es un guard: T4
      monta `MenuButton` en las filas de los enlaces y ese archivo tendria que
      acordarse solo.

      Por eso la lista sale de **quien lo monta**, y no de una lista escrita aca:
      con T4 usando el boton, este guard empieza a mirar ese archivo sin que
      nadie tenga que actualizarlo. Y el `toBeGreaterThan(0)` es para que una
      lista vacia no pase en verde por no tener nada que comprobar.
    */
    const queLoMantan = tsxDeLaApp().filter((nombre) => src(`src/${nombre}`).includes("<MenuButton"));

    expect(
      queLoMantan.length,
      "sin archivos que lo monten el guard no comprobaria nada",
    ).toBeGreaterThan(0);

    for (const archivo of queLoMantan) {
      expect(src(`src/${archivo}`), `${archivo} monta MenuButton sin caja relativa`).toMatch(
        /position: "relative"/,
      );
    }
  });
});

describe("mientras se escribe, el panel no toma toques", () => {
  /*
    `IconPickerPanel` es `Pick<IconPickerSheetProps, "current" | "onSelect">`: no
    tiene `disabled` ni ningun otro prop por el que avisarle de una escritura en
    vuelo. Y `correrEnLaPagina` corta el segundo toque con `if (trabajando)
    return`, o sea que sin algo mas **el toque se pierde sin que nada lo diga**:
    el grid entero sigue tappable, la pagina no se apaga y la persona toca dos
    veces sin que pase nada. Con T6 y T7 entregando esta pagina a lista, nota y
    carpeta, tocar dos celdas seguidas es lo normal y no el caso raro.

    Y por que no "no montar el panel": `IconPickerBody` guarda su estado adentro
    —la pestana, lo escrito en el buscador y los emojis recientes—, y la pagina
    se desmonta al volver con la flecha, asi que sacarlo mientras se escribe
    perderia el buscador y la pestana en cada eleccion. El guard no comprueba ese
    motivo (aca no se renderiza nada), pero esta escrito en la pagina.
  */
  it("la pagina recibe que se esta escribiendo y apaga el panel, no lo saca", () => {
    // El regex junta las dos cosas a proposito: el panel tiene que estar **dentro**
    // del `View` que se apaga, y no al lado. `{trabajando ? null : <IconPickerPanel
    // ... />}` compila, pasa el conteo de `<Sheet` y pierde el buscador en cada
    // eleccion, asi que la forma importa y no solo que el `pointerEvents` exista.
    expect(src(ICONO)).toMatch(/trabajando: boolean/);
    expect(src(ICONO)).toMatch(
      /pointerEvents=\{trabajando \? "none" : "auto"\}>\s*<IconPickerPanel current=\{icon\} onSelect=\{onSelect\} \/>/,
    );
  });

  it("la hoja se lo pasa", () => {
    expect(hoja).toMatch(/<IconPage[\s\S]{0,120}trabajando=\{trabajando\}/);
  });

  it("y avisa que esta guardando, como las otras dos paginas", () => {
    // `RenamePage` y `DeletePage` ya tienen la convencion de la palabra
    // "Guardando"; esta se suma al mismo grupo y no queda como la unica que no
    // dice nada mientras trabaja.
    expect(src(ICONO)).toContain('t("common.saving")');
  });
});
