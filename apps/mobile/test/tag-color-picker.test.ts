import { normalizaColor } from "@orbit-hub/contracts";
import { describe, expect, it } from "vitest";

import { ICON_COLORS } from "@/lib/lists/item-icons";
import {
  contrastRatio,
  hexDeHsv,
  normalizaHex,
  tintaDe,
} from "@/lib/lists/tag-colors";
import { hexToHsv } from "@/lib/workspace/picker";
import { esHex } from "@/lib/workspace/hsl";

/**
 * The two things about a label's colour picker that a Node test can say anything
 * about: what the field accepts, and the arithmetic that turns a finger into a
 * colour. Everything else in the component — twelve swatches, hue strip, square,
 * recents — is checked in a browser, in Task 7.
 *
 * **The functions under test live in `@/lib/lists/tag-colors` and not in the
 * component.** `tag-color-picker.tsx` imports `@expo/vector-icons` and
 * `react-native-gesture-handler`, and neither can be loaded by `vitest run`: the
 * first fails with `Cannot find module .../createIconSet` and the second is Flow
 * (`SyntaxError: Unexpected token 'typeof'`), measured in this repo with a test
 * that imports `workspace-color-picker.tsx` and nothing else. The component
 * re-exports all three, so the picker still offers them where this file says it
 * does.
 */
describe("el campo de color", () => {
  it("normaliza un hex de seis digitos a mayusculas", () => {
    expect(normalizaHex("#aabbcc")).toBe("#AABBCC");
    expect(normalizaHex("aabbcc")).toBe("#AABBCC");
  });

  it("amplia un hex de tres digitos y no acepta los demas", () => {
    // `esHex` ya acepta tres y seis, y hay un comentario en `hsl.ts` que explica
    // que se dejo asi a proposito. Este selector no puede ser mas estrecho que el
    // de los espacios: el mismo usuario, el mismo campo, dos reglas distintas.
    expect(normalizaHex("#fff")).toBe("#FFFFFF");
    expect(normalizaHex("#ff")).toBeNull();
    expect(normalizaHex("#gggggg")).toBeNull();
    expect(normalizaHex("")).toBeNull();
  });

  it("el color del cuadro y el del campo son el mismo", () => {
    // `Hsv` es `{ h: 0-360 grados, s: 0-1, v: 0-1 }` — la s y la v van de 0 a 1,
    // no de 0 a 100. Es la forma que ya espera `puntoAHsv`.
    const hsv = hexToHsv("#3B5FDE");
    expect(hexDeHsv(hsv.h, hsv.s, hsv.v)).toBe("#3B5FDE");
  });

  it("y el cuadrado no mueve un color al ir y volver", () => {
    // El round trip es el que decide si el boton de "usar este color" guarda lo
    // que se esta viendo o un hex al lado. Los doce de la paleta y un blanco, un
    // negro y un gris, que son los tres casos donde el tono no existe.
    for (const hex of [...Object.values(ICON_COLORS), "#FFFFFF", "#000000", "#808080"]) {
      const hsv = hexToHsv(hex);
      expect(hexDeHsv(hsv.h, hsv.s, hsv.v)).toBe(hex.toUpperCase());
    }
  });

  /**
   * El campo, el mapa y el otro validador del movil tienen que aceptar lo mismo.
   *
   * Hay tres, y no pueden ser uno: `normalizaColor` esta en el contrato porque el
   * servidor es quien normaliza lo que se guarda, `esHex` esta en el movil porque
   * el selector de espacios lo usa, y `normalizaHex` es la puerta del campo de
   * este selector. Lo que ata a los tres es **esta** comparacion, y solo ella: si
   * uno se estrecha o se ensancha, hay un color que un sitio acepta y otro se
   * come en silencio, que es el fallo invisible que `normalizaColor` existe para
   * evitar.
   *
   * La lista esta **generada, y no escrita**, porque una lista escrita solo pilla
   * el ensanchamiento que alguien se imaginó: la primera version de este test no
   * tenia `"#abcd"` y por eso un hex con alfa —el ensanchamiento mas probable que
   * existe, porque React Native y el CSS lo admiten— lo dejaba verde.
   */
  it("el campo y el mapa y el validador de los espacios aceptan lo mismo", () => {
    for (const candidato of candidatosHex()) {
      // El `as string` es por los que no son cadenas: el campo nunca entrega un
      // numero, pero `normalizaHex` se apoya en `normalizaColor(texto: unknown)` y
      // por eso responde `null` en vez de lanzar.
      const delCampo = normalizaHex(candidato as string) !== null;
      expect({ candidato, esHex: esHex(candidato) }).toEqual({
        candidato,
        esHex: delCampo,
      });
      expect(delCampo).toBe(normalizaColor(candidato) !== null);
    }
  });
});

/**
 * Los doce de la paleta llevan encima una tilde, un icono o el anillo del
 * marcador, y esa tinta tiene que leerse **sobre el color elegido**.
 *
 * No es una regla de este archivo: es lo que hace `tintaDe`, y sin ella el
 * selector es un sitio donde doce colores y un blanco se dibujan encima los unos
 * de los otros sin que nadie lo note —que es justo lo que este selector no puede
 * ser, porque el texto de una pastilla ya no es el color que eligio nadie (ver
 * `labelPillColors`): aqui el color elegido se ve, y solo aqui.
 */
describe("la tinta que se lee encima de un color", () => {
  /** 3:1 es el minimo de WCAG para lo que no es texto; el contraste no textual. */
  const MINIMO_DE_UN_ICONO = 3;

  it("se lee sobre los doce de la paleta", () => {
    for (const hex of Object.values(ICON_COLORS)) {
      expect({ hex, ratio: contrastRatio(tintaDe(hex), hex) >= MINIMO_DE_UN_ICONO }).toEqual({
        hex,
        ratio: true,
      });
    }
  });

  it("y sobre lo que escribe el campo, sea del color que sea", () => {
    for (const hex of ["#000000", "#010203", "#FEFEFE", "#7F7F80", "#3B5FDE"]) {
      expect(contrastRatio(tintaDe(hex), hex)).toBeGreaterThanOrEqual(MINIMO_DE_UN_ICONO);
    }
  });

  it("elige el extremo, y no un gris a medio camino", () => {
    // Un gris medio se leeria en los dos extremos y en ninguno del todo: la
    // respuesta tiene que ser uno de los dos o no es una respuesta.
    expect(tintaDe("#000000")).toBe("#FFFFFF");
    expect(tintaDe("#FFFFFF")).toBe("#000000");
    expect(["#000000", "#FFFFFF"]).toContain(tintaDe("#8A93A8"));
  });
});

/**
 * Todo lo que un validador de hex podria aceptar o dejar de aceptar.
 *
 * La primera mitad son los casos que tienen nombre —el `trim`, la `#` que si y la
 * que no, el hexadecimal de funcion— y la segunda son **todas las longitudes de 0
 * a 9**, con y sin almohadilla. Lo segundo es lo que ata de verdad: hoy se aceptan
 * tres y seis, y cualquier otro largo es un `null` en los tres validadores a la
 * vez. Un solo cambio de cualquiera de los dos lados rompe esta lista en la
 * longitud que ese cambio tocase, y no solo si alguien se acordo de escribir el
 * caso.
 */
function candidatosHex(): unknown[] {
  const lista: unknown[] = [
    // Los que se aceptan hoy.
    "#fff",
    "fff",
    "#FFFFFF",
    "aabbcc",
    "#AbC",
    "#abc",
    // Los que no, y por una razon distinta cada uno.
    "#ff",
    "#f",
    "#fffffff",
    "#gggggg",
    "#GGG",
    "#aabbccdd",
    "#aabbccd",
    "rgb(1,2,3)",
    "0xFFFFFF",
    "",
    "   ",
    "#",
    "  #abc  ",
    "\t#aabbcc\n",
    // Y lo que no es una cadena.
    7,
    null,
    undefined,
    {},
    [],
    true,
  ];

  for (let largo = 0; largo <= 9; largo += 1) {
    const cuerpo = "a1b2c3d4e".slice(0, largo);
    lista.push(cuerpo, `#${cuerpo}`);
  }

  return lista;
}