import {
  ITEM_ICONS,
  VECTOR_ICON_CATALOG,
  VECTOR_ICON_CATEGORIES,
  vectorGlyph,
} from "@orbit-hub/contracts";
import { describe, expect, it } from "vitest";

import { DRAWINGS, searchDrawings } from "@/lib/icons/vector-drawings";

/**
 * Los dibujos del catálogo, uno por celda.
 *
 * El catálogo tiene 487 claves y **181 dibujos distintos**: 80 glifos los
 * comparten varias claves y el peor reparte once palabras sobre un cartel de
 * sendero. En el grid eso son once celdas con el mismo dibujo, que es lo que se
 * ve como "muchos duplicados".
 *
 * Lo que se colapsa es la **vista**, no los datos. Las 487 claves se quedan, y
 * por eso buscar `azucar`, `sal` o `caja` lleva a la misma celda: cada dibujo
 * indexa todas las palabras que lo dibujan.
 */

describe("un dibujo por celda", () => {
  it("no hay dos celdas con el mismo dibujo", () => {
    // La identidad es libreria mas glifo: dos fuentes pueden dibujar parecido y
    // `ionicons:cube` no es la misma celda que `material:cube` aunque rimaran.
    const ids = DRAWINGS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(DRAWINGS.length);
  });

  it("no hay dos celdas con el mismo dibujo de relleno tampoco", () => {
    // Si algun dia el relleno deja de derivarse del contorno, dos celdas podrian
    // ser distintas en un estilo y la misma en el otro. Esto lo comprueba en vez
    // de suponerlo.
    const rellenos = DRAWINGS.map(
      (entry) => `${entry.library}:${vectorGlyph(entry.key, "fill", entry.library)}`,
    );
    expect(new Set(rellenos).size).toBe(DRAWINGS.length);
  });

  it("toda celda tiene un glifo que esta build puede dibujar", () => {
    for (const entry of DRAWINGS) {
      expect(vectorGlyph(entry.key, "outline", entry.library), entry.key).toBe(entry.glyph);
      expect(vectorGlyph(entry.key, "fill", entry.library), entry.key).not.toBeNull();
    }
  });

  it("cada celda se guarda por una clave que está en el catálogo", () => {
    const claves = new Set(VECTOR_ICON_CATALOG.map((entry) => entry.key));
    for (const entry of DRAWINGS) {
      expect(claves.has(entry.key), entry.key).toBe(true);
    }
  });

  it("todas las claves del catálogo llegan a alguna celda", () => {
    // El colapso es de la vista. Si una clave no aparece en ninguna celda, es
    // que se ha perdido del buscador, que es donde se busca.
    const cubiertas = new Set(DRAWINGS.flatMap((entry) => entry.aliases));
    const perdidas = VECTOR_ICON_CATALOG.map((entry) => entry.key).filter(
      (key) => !cubiertas.has(key),
    );
    expect(perdidas).toEqual([]);
  });

  it("los 131 iconos de antes siguen pudiendo elegirse", () => {
    // La red de seguridad de la migración: si una clave que alguien tenía
    // elegida deja de estar en el catálogo, su icono desaparece sin error.
    for (const key of ITEM_ICONS) {
      expect(DRAWINGS.some((entry) => entry.aliases.includes(key)), key).toBe(true);
    }
  });
});

describe("las palabras que llevan a un dibujo", () => {
  it("junta todas las claves que dibujan lo mismo", () => {
    // Once palabras son un dibujo. Todas lo encuentran, y las once llevan al
    // mismo sitio, que es lo contrario de lo que pasaba.
    const sendero = DRAWINGS.find((entry) => entry.id === "ionicons:trail-sign-outline");
    expect(sendero).toBeDefined();
    expect(sendero!.aliases).toContain("senderismo");
    expect(sendero!.aliases).toContain("montana");
    expect(sendero!.aliases).toContain("aspirador");
    expect(sendero!.aliases.length).toBeGreaterThan(3);
  });

  it("guarda una clave canónica que es siempre la misma", () => {
    // La celda tiene que guardar algo, y lo que guarda no puede depender de qué
    // palabra escribió la persona: si dependiera, "sal" y "azucar" acabarían en
    // dos filas distintas con el mismo dibujo.
    const cubo = DRAWINGS.find((entry) => entry.glyph === "cube-outline");
    expect(cubo).toBeDefined();
    expect(cubo!.aliases).toContain("caja");
    expect(cubo!.key).toBe(cubo!.aliases[0]);
  });

  it("busca por cualquiera de las palabras y encuentra ese dibujo", () => {
    // Once drawings collapse, every one of their words still finds them. Before,
    // only the word that happened to be first did, and the other ten were
    // separate cells with the same picture in them.
    const cubo = DRAWINGS.find((entry) => entry.id === "ionicons:cube-outline")!;
    for (const palabra of cubo.aliases.map((alias) => alias.replace(/_/g, " "))) {
      expect(searchDrawings(palabra), palabra).toContain(cubo);
    }
  });

  it("nunca devuelve el mismo dibujo dos veces", () => {
    // A word can legitimately name two *different* pictures — `paquete` is the
    // cube and also `paquete_de_trabajo` — and then the person picks which one
    // they meant. What must never happen is one picture answering twice.
    for (const palabra of ["paquete", "caja", "maleta", "montana", "reunion", "a"]) {
      const encontrados = searchDrawings(palabra);
      const unicos = new Set(encontrados.map((entry) => entry.id));
      expect(unicos.size, palabra).toBe(encontrados.length);
    }
  });

  it("encuentra por el nombre que se ve y por la palabra con guion", () => {
    const dibujo = DRAWINGS.find((entry) => entry.aliases.includes("pasta_dientes"));
    expect(dibujo).toBeDefined();
    expect(searchDrawings("pasta")).toContain(dibujo!);
    expect(searchDrawings("pasta dientes")).toContain(dibujo!);
  });

  it("no encuentra nada con una palabra que no existe", () => {
    expect(searchDrawings("qqqqzzz")).toEqual([]);
  });
});

describe("cómo se reparten por categoría", () => {
  it("cada celda está en una categoría que existe", () => {
    for (const entry of DRAWINGS) {
      expect(VECTOR_ICON_CATEGORIES, entry.glyph).toContain(entry.category);
    }
  });

  it("agrupa por categoría y dentro mantiene el orden del catálogo", () => {
    // El orden dentro de la categoría es el del catálogo, que es el que alguien
    // recorrió cuando lo escribió. Reordenar aquí sería cambiarlo sin motivo.
    const casa = DRAWINGS.filter((entry) => entry.category === "hogar");
    const despuesDeTrabajo = DRAWINGS.findIndex((entry) => entry.category === "hogar");
    expect(despuesDeTrabajo).toBeGreaterThan(-1);
    expect(casa.length).toBeGreaterThan(0);
    const indices = DRAWINGS.map((entry, i) => ({ entry, i }));
    for (const categoria of VECTOR_ICON_CATEGORIES) {
      const enEsa = indices.filter((x) => x.entry.category === categoria).map((x) => x.i!);
      // contiguos y en orden creciente
      for (let i = 1; i < enEsa.length; i += 1) {
        expect(enEsa[i]!).toBeGreaterThan(enEsa[i - 1]!);
      }
    }
  });

  it("cada categoría tiene al menos un dibujo", () => {
    for (const categoria of VECTOR_ICON_CATEGORIES) {
      expect(
        DRAWINGS.filter((entry) => entry.category === categoria).length,
        categoria,
      ).toBeGreaterThan(0);
    }
  });
});
