import { ITEM_ICON_COLORS } from "@orbit-hub/contracts";
import type { ItemIconColor } from "@orbit-hub/contracts";
import { describe, expect, it } from "vitest";

import { iconColor } from "@/lib/lists/item-icons";
import {
  contrastRatio,
  labelTextColor,
  planTagColorChange,
} from "@/lib/lists/tag-colors";
import { createTheme } from "@/theme/tokens";

/**
 * Los dos temas de verdad, no los numeros de los tests.
 *
 * Se construyen con `createTheme` —la misma puerta que usa `useTheme`— en vez de
 * con los hex a mano, para que un cambio en `surfaceMuted` o en `text` se note
 * aqui como un test rojo y no como un test que sigue hablando de un color que la
 * app ya no pinta. El acento da igual para esto: los dos vienen de `NEUTRALS`, y
 * "orbit" es solo uno de los cinco que hay.
 */
const CLARO = createTheme("light", "orbit").colors;
const OSCURO = createTheme("dark", "orbit").colors;

describe("cambiar el color de una etiqueta", () => {
  it("guarda el color que se ha elegido", () => {
    expect(planTagColorChange({}, "Mercadona", "green")).toEqual({
      Mercadona: "green",
    });
  });

  it("no toca los colores de las demas etiquetas", () => {
    // El mapa entero viaja en una sola operacion del sync, asi que una
    // escritura que pierde un color ajeno pierde el de otra persona sin que
    // ninguna de las dos se entere.
    expect(
      planTagColorChange({ Alcampo: "red", casa: "blue" }, "Mercadona", "green"),
    ).toEqual({ Alcampo: "red", casa: "blue", Mercadona: "green" });
  });

  it("cambia el color de una etiqueta que ya tenia uno", () => {
    expect(planTagColorChange({ Mercadona: "red" }, "Mercadona", "green")).toEqual({
      Mercadona: "green",
    });
  });

  it("quitar el color devuelve la etiqueta al que se deduce de su nombre", () => {
    // No es "sin color": es el estado de "no hay color guardado", que es el que
    // hace que la etiqueta vuelva al deducido. Por eso la opcion se llama
    // "volver al deducido" y no "quitar".
    expect(planTagColorChange({ Mercadona: "green", Alcampo: "red" }, "Mercadona", null)).toEqual({
      Alcampo: "red",
    });
  });

  it("quitar el color de una etiqueta que no tenia ninguno no cambia nada", () => {
    expect(planTagColorChange({ Alcampo: "red" }, "Mercadona", null)).toEqual({
      Alcampo: "red",
    });
  });

  it("no muta el mapa que le pasan", () => {
    const original = { Mercadona: "red" as const };
    planTagColorChange(original, "Mercadona", "green");
    expect(original).toEqual({ Mercadona: "red" });
  });

  it("tampoco lo muta al quitar el color", () => {
    // El caso espejo del de arriba, y el que un `delete` ingenuo rompe sin que
    // se note: quitar el color es media funcion, asi que una copia solo en el
    // camino de elegir un color deja el otro sin cubrir.
    //
    // Y aqui el mapa que le pasan no es una copia de nada: es el mismo objeto
    // que la lista tiene guardado. Un `delete current[tag]` lo vacia en sitio, y
    // como el estado ya apunta a el, nadie repinta y nadie se entera: la lista se
    // queda mostrando un color que ya no esta en el mapa que se acaba de enviar.
    const original = { Mercadona: "green" as const, Alcampo: "red" as const };
    expect(planTagColorChange(original, "Mercadona", null)).toEqual({
      Alcampo: "red",
    });
    expect(original).toEqual({ Mercadona: "green", Alcampo: "red" });
  });
});

/**
 * De que color se escribe una etiqueta, o de si el suyo se puede leer.
 *
 * El componente no se puede pintar en un test de este repo —`vitest.config.ts` solo
 * recoge los de la carpeta `test`, con `environment: 'node'` y React Native
 * sustituido—, asi que lo que se comprueba aqui es la regla, que es pura y por eso
 * si se puede.
 */
describe("el contraste", () => {
  it("de un color consigo mismo es 1", () => {
    // Un color de laboratorio y no uno de los tokens: aqui se comprueba la
    // cuenta, y un token en el argumento haria dudar de que color se esta midiendo.
    expect(contrastRatio("#3A7BD5", "#3A7BD5")).toBeCloseTo(1, 6);
  });

  it("es 21 en los dos sentidos entre blanco y negro", () => {
    // Los dos 21, y no 21 y 1/21: el contraste se define como la parte clara
    // partida por la oscura, para que el numero signifique algo sin depender del
    // orden de los argumentos. "Blanco sobre negro" son 21:1 — el 1/21 es la misma
    // medicion leida al reves, no un segundo resultado.
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 6);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 6);
  });

  it("no depende del orden de los argumentos", () => {
    expect(contrastRatio("#3A7BD5", "#E8EAF2")).toBeCloseTo(
      contrastRatio("#E8EAF2", "#3A7BD5"),
      10,
    );
  });
});

describe("el color con el que se escribe una etiqueta", () => {
  it("usa el color de la etiqueta cuando se lee encima de la pastilla", () => {
    // Azul: 4.62 sobre el `surfaceMuted` claro, y el mas alto de los doce ahi.
    expect(labelTextColor("blue", CLARO.surfaceMuted, CLARO.text)).toBe(
      iconColor("blue"),
    );
  });

  it("usa el color del tema cuando el de la etiqueta no se lee", () => {
    // Naranja: 3.18 sobre el mismo fondo, y de los doce que se ofrecen en el
    // selector. Es el caso que mas se nota cuando la pastilla se pinta sin puerta.
    expect(labelTextColor("orange", CLARO.surfaceMuted, CLARO.text)).toBe(
      CLARO.text,
    );
  });

  it("mide contra el fondo que le pasan, y no contra uno supuesto", () => {
    // El mismo color, los dos lados de la puerta, y lo unico que cambia es el
    // fondo: verde pasa en el oscuro (4.83) y no en el claro (2.94).
    expect(labelTextColor("green", OSCURO.surfaceMuted, OSCURO.text)).toBe(
      iconColor("green"),
    );
    expect(labelTextColor("green", CLARO.surfaceMuted, CLARO.text)).toBe(
      CLARO.text,
    );
  });

  it("usa el texto del tema que le pasan como ultimo recurso", () => {
    // El ultimo recurso es el que le da el que llama, y no uno fijo: asi el
    // componente no necesita saber de que tema lo estan pintando.
    expect(labelTextColor("purple", OSCURO.surfaceMuted, "#ABCDEF")).toBe(
      "#ABCDEF",
    );
  });

  it("pinta el color del tema antes que un color que no se puede calcular", () => {
    // Una clave de una cache escrita por una version que si sabia mas colores: la
    // app no la tiene, `iconColor` la devuelve en el neutro, y el neutro pasa por
    // la misma puerta que todos los demas. Un color que sale `NaN` tampoco llega
    // al umbral, asi que fallar aqui es pintar el texto del tema, que si se lee.
    expect(
      labelTextColor(
        "no-existe" as ItemIconColor,
        CLARO.surfaceMuted,
        CLARO.text,
      ),
    ).toBe(CLARO.text);
  });
});

/**
 * El test que sostiene la puerta.
 *
 * Los doce colores de la paleta, contra el `surfaceMuted` real de cada esquema, y
 * lo que la puerta conteste tiene que leerse a 4.5 o mas contra ese mismo fondo.
 * Se comprueba el resultado de `labelTextColor` y no solo la funcion, para que el
 * test se caiga entero si alguien quita la puerta del componente, si afloja el
 * umbral, o si cambia el relleno de la pastilla.
 *
 * Y el 4.5 va escrito a mano en vez de leido de `MIN_LABEL_CONTRAST`, a proposito:
 * leerlo de ahi aflojaria los dos a la vez y el test seguiria en verde.
 */
describe("ninguna etiqueta se escribe con un color que no se lee", () => {
  for (const nombre of ["light", "dark"] as const) {
    const tema = createTheme(nombre, "orbit").colors;

    it(`los doce se leen en el tema ${nombre}`, () => {
      for (const color of ITEM_ICON_COLORS) {
        const escrito = labelTextColor(color, tema.surfaceMuted, tema.text);
        expect(
          contrastRatio(escrito, tema.surfaceMuted),
          `${color} (${escrito}) sobre ${tema.surfaceMuted}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`el texto del tema, que es el otro color posible, tambien se lee en ${nombre}`, () => {
      // La mitad del contrato sin la cual la puerta no serviria de nada: si el
      // color del tema tampoco llegara al umbral, la pastilla no tendria nada que
      // escribir y la regla solo habria movido el problema de sitio.
      expect(contrastRatio(tema.text, tema.surfaceMuted)).toBeGreaterThanOrEqual(
        4.5,
      );
    });
  }
});
