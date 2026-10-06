import glyphMap from "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json";
import {
  MATERIAL_BY_CATEGORY,
  MATERIAL_FILL_ONLY,
  MATERIAL_KEYWORDS,
  MATERIAL_LABELS,
} from "@orbit-hub/contracts";
import {
  VECTOR_ICON_CATALOG,
  VECTOR_ICON_CATEGORIES,
  vectorGlyph,
} from "@orbit-hub/contracts";
import { describe, expect, it } from "vitest";

/**
 * The MaterialCommunityIcons half of the catalogue, checked against the real font.
 *
 * Same discipline as `test/icons-ampliados.test.ts`: every entry below was written
 * by hand, and a hand-written glyph name is wrong in ways nothing catches — a typo,
 * a key that duplicates one the Ionicons half already has, a glyph named twice.
 * All of those are invisible until somebody opens the picker and finds a blank
 * cell where a picture should be, so this reads the actual `glyphMap`.
 */

const GLYPHS = new Set(Object.keys(glyphMap as Record<string, number>));

const PARES = Object.values(MATERIAL_BY_CATEGORY).flatMap((entries) =>
  entries.map((entry) => {
    const [key = "", glyph = "", ...resto] = entry.split(" ");
    return { key, glyph, resto };
  }),
);
const CLAVES = new Set(PARES.map((par) => par.key));

describe("la mitad material del catalogo", () => {
  it("aporta cientos de dibujos, que es para lo que viene", () => {
    expect(PARES.length).toBeGreaterThanOrEqual(300);
  });

  it("cada glifo existe de verdad en la fuente", () => {
    for (const par of PARES) {
      expect(GLYPHS.has(par.glyph), `${par.key} -> ${par.glyph}`).toBe(true);
    }
  });

  it("cada entrada son dos palabras y nada mas", () => {
    for (const par of PARES) {
      expect(par.resto, par.key).toEqual([]);
      expect(par.glyph, par.key).toBeTruthy();
    }
  });

  it("ninguna clave se repite dentro de la mitad material", () => {
    const repetidas = PARES.filter((par, i) => PARES.findIndex((o) => o.key === par.key) !== i);
    expect(repetidas.map((par) => par.key)).toEqual([]);
  });

  it("ningun glifo se repite: una celda, un dibujo", () => {
    const glifos = PARES.map((par) => par.glyph);
    expect(new Set(glifos).size).toBe(glifos.length);
  });

  it("ninguna clave estaba ya en la mitad de Ionicons", () => {
    // La misma palabra en las dos mitades es la misma celda dos veces con dos
    // dibujos distintos, y la busqueda no sabria cual de los dos ensenar.
    const deIonicons = new Set(
      VECTOR_ICON_CATALOG.filter((entry) => entry.library === "ionicons").map((entry) => entry.key),
    );
    expect([...CLAVES].filter((key) => deIonicons.has(key))).toEqual([]);
  });

  it("cada categoria es una de las once que ya hay", () => {
    for (const category of Object.keys(MATERIAL_BY_CATEGORY)) {
      expect(VECTOR_ICON_CATEGORIES, category).toContain(category);
    }
  });

  it("el contorno existe o la clave esta en la lista de solo-relleno", () => {
    // Material nombra sus versiones de contorno como glifos aparte, y la mayoria
    // no tiene. Sin esta comprobacion, la pestana "Contorno" pintaria huecos.
    for (const par of PARES) {
      const tiene = GLYPHS.has(`${par.glyph}-outline`);
      expect(
        tiene || MATERIAL_FILL_ONLY.has(par.key),
        `${par.key} -> ${par.glyph}: ni tiene -outline ni esta en MATERIAL_FILL_ONLY`,
      ).toBe(true);
    }
  });

  it("lo que dice solo-relleno es verdad: ese glifo no tiene contorno", () => {
    for (const key of MATERIAL_FILL_ONLY) {
      const par = PARES.find((p) => p.key === key);
      expect(par, key).toBeDefined();
      expect(GLYPHS.has(`${par!.glyph}-outline`), key).toBe(false);
    }
  });

  it("vectorGlyph resuelve las dos librerias", () => {
    expect(vectorGlyph("manzana", "outline", "material")).toBe("food-apple-outline");
    expect(vectorGlyph("manzana", "fill", "material")).toBe("food-apple");
    // Sin variante de contorno: el mismo dibujo en los dos estilos.
    const soloRelleno = [...MATERIAL_FILL_ONLY][0]!;
    const par = PARES.find((p) => p.key === soloRelleno)!;
    expect(vectorGlyph(soloRelleno, "outline", "material")).toBe(par.glyph);
    expect(vectorGlyph(soloRelleno, "fill", "material")).toBe(par.glyph);
    // Y la de Ionicons sigue resolviendo como siempre.
    expect(vectorGlyph("pan", "outline")).toBe("cafe-outline");
    expect(vectorGlyph("manzana", "outline", "ionicons")).toBeNull();
  });

  it("las palabras extra y las etiquetas apuntan a claves que existen", () => {
    const delCatalogo = new Set(VECTOR_ICON_CATALOG.map((entry) => entry.key));
    for (const key of Object.keys(MATERIAL_KEYWORDS)) {
      expect(delCatalogo.has(key), `MATERIAL_KEYWORDS: ${key}`).toBe(true);
    }
    for (const key of Object.keys(MATERIAL_LABELS)) {
      expect(delCatalogo.has(key), `MATERIAL_LABELS: ${key}`).toBe(true);
    }
  });

  it("ninguna palabra extra esta vacia", () => {
    for (const [key, words] of Object.entries(MATERIAL_KEYWORDS)) {
      for (const word of words.split("|")) {
        expect(word.trim(), key).not.toBe("");
      }
    }
  });
});
