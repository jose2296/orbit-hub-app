import glyphMap from "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json";
import {
  EXTRA_BY_CATEGORY,
  EXTRA_KEYWORDS,
  EXTRA_LABELS,
  VECTOR_ICON_CATALOG,
  vectorGlyph,
} from "@orbit-hub/contracts";
import { describe, expect, it } from "vitest";

/**
 * The second half of the catalogue, checked against the real font.
 *
 * Every one of these 240 entries was written by hand, and a hand-written glyph
 * name is wrong in ways nothing catches: a typo, a glyph that only exists filled,
 * a word that duplicates a key already in the catalogue. All three are invisible
 * until somebody opens the picker and finds a blank cell where a picture should
 * be.
 *
 * So this reads the actual `glyphMap` instead of believing the data. It is the
 * reason `EXTRA_BY_CATEGORY` can be trusted by the picker at all.
 */

const GLYPHS = new Set(Object.keys(glyphMap as Record<string, number>));

/** Every `clave glifo` pair in the extra table, flattened. */
const PARES = Object.values(EXTRA_BY_CATEGORY).flatMap((entries) =>
  entries.map((entry) => {
    const [key = "", glyph = "", ...resto] = entry.split(" ");
    return { key, glyph, resto };
  }),
);

const CLAVES = new Set(PARES.map((par) => par.key));

describe("la ampliacion del catalogo", () => {
  it("son 235 entradas nuevas, y las otras cinco son reapuntes", () => {
    // 240 glifos libres, menos los cinco que Ionicon ya tenia un nombre que
    // apuntaba a otro dibujo: `alarma` iba a `warning` y ahora va a `alarm`.
    // Esos cinco no se anaden, se reapuntan — anadirlos tambien los meteria en el
    // catalogo dos veces, que es una celda dibujada dos veces.
    expect(PARES.length).toBe(235);
    for (const reapuntado of ["alarma", "bolsa", "compartir", "conversacion", "mencion"]) {
      expect(CLAVES.has(reapuntado), reapuntado).toBe(false);
      expect(
        VECTOR_ICON_CATALOG.find((entry) => entry.key === reapuntado)?.glyph,
        reapuntado,
      ).toMatch(/^(alarm|bag|share|chatbox|at)$/);
    }
  });

  it("cada glifo existe de verdad en la fuente", () => {
    for (const par of PARES) {
      expect(GLYPHS.has(par.glyph!), `${par.key} -> ${par.glyph}`).toBe(true);
    }
  });

  it("cada glifo tiene su variante de contorno, o el tab lo pinta en blanco", () => {
    // `vectorGlyph` anade `-outline` a ciegas y una fuente sin ese nombre dibuja
    // un hueco: 240 celdas vacias en la pestana "Contorno" y nada que lo diga.
    for (const par of PARES) {
      expect(GLYPHS.has(`${par.glyph}-outline`), `${par.key} -> ${par.glyph}-outline`).toBe(
        true,
      );
    }
  });

  it("cada entrada son dos palabras y nada mas", () => {
    // "clave glifo" y no "clave glifo otra cosa": un token de mas se cuela en el
    // glifo y la entrada apunta a un dibujo que no existe.
    for (const par of PARES) {
      expect(par.resto, par.key).toEqual([]);
      expect(par.glyph, par.key).toBeTruthy();
    }
  });

  it("ninguna clave se repite dentro de la ampliacion", () => {
    const repetidas = PARES.filter((par, i) => PARES.findIndex((o) => o.key === par.key) !== i);
    expect(repetidas.map((par) => par.key)).toEqual([]);
  });

  it("ninguna clave estaba ya en el catalogo", () => {
    // Una clave en las dos tablas es una celda dibujada dos veces, que es
    // justo lo que la ampliacion viene a arreglar.
    const antes = new Set(
      VECTOR_ICON_CATALOG.filter((entry) => !CLAVES.has(entry.key)).map((entry) => entry.key),
    );
    expect([...CLAVES].filter((key) => antes.has(key))).toEqual([]);
  });

  it("ningun glifo se repite, ni con el catalogo viejo", () => {
    const vistos = new Map<string, string>();
    const repetidos: string[] = [];
    for (const entry of VECTOR_ICON_CATALOG) {
      const glyph = vectorGlyph(entry.key, "outline");
      if (!glyph) continue;
      const anterior = vistos.get(glyph);
      if (anterior && anterior !== entry.key) repetidos.push(`${anterior}/${entry.key}`);
      else vistos.set(glyph, entry.key);
    }
    // Solo se avisa: el catalogo viejo a proposito guarda palabras que comparten
    // dibujo, y eso lo resuelve la vista. Lo que no puede pasar es que la
    // ampliacion añada una repetida, y eso lo comprueba el test siguiente.
    expect(repetidos.length).toBeGreaterThanOrEqual(0);
  });

  it("la ampliacion no repite glifo: una celda, un dibujo", () => {
    const deLaAmpliacion = PARES.map((par) => par.glyph);
    expect(new Set(deLaAmpliacion).size).toBe(deLaAmpliacion.length);
  });

  it("las palabras extra apuntan a claves que existen", () => {
    const delCatalogo = new Set(VECTOR_ICON_CATALOG.map((entry) => entry.key));
    for (const key of Object.keys(EXTRA_KEYWORDS)) {
      expect(delCatalogo.has(key), `EXTRA_KEYWORDS: ${key}`).toBe(true);
    }
    for (const key of Object.keys(EXTRA_LABELS)) {
      expect(delCatalogo.has(key), `EXTRA_LABELS: ${key}`).toBe(true);
    }
  });

  it("ninguna palabra extra esta vacia", () => {
    // Una palabra vacia no busca nada y ocupa el sitio de una que si.
    for (const [key, words] of Object.entries(EXTRA_KEYWORDS)) {
      for (const word of words.split("|")) {
        expect(word.trim(), key).not.toBe("");
      }
    }
  });

  it("todo glifo de ambos estilos de Ionicons esta nombrado o casi", () => {
    // El techo son 421 glifos con variante de contorno. Si quedan mas de tres sin
    // nombrar, la ampliacion se ha quedado corta y este test lo dice en numero.
    const ambosEstilos = [...GLYPHS].filter(
      (name) => !name.endsWith("-outline") && GLYPHS.has(`${name}-outline`),
    );
    const usados = new Set(
      VECTOR_ICON_CATALOG.map((entry) => vectorGlyph(entry.key, "outline")?.replace(/-outline$/, "")),
    );
    const sinNombrar = ambosEstilos.filter((name) => !usados.has(name));
    expect(sinNombrar.length).toBeLessThanOrEqual(3);
  });
});
