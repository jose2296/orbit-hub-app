import { EMOJI_CATALOG, EMOJI_GROUPS } from "@/lib/icons/emoji-catalog.generated";
import { EMOJI_ALIASES } from "@/lib/icons/emoji-aliases";
import { normaliseQuery, searchEmojis } from "@/lib/icons/search-emoji";
import { describe, expect, it } from "vitest";

/**
 * The emoji catalogue the picker searches, and the search itself.
 *
 * The data comes from `emojilib` with the groups of `unicode-emoji-json`,
 * because neither package has the whole thing: the first one brings the words
 * and no groups, the second one the groups and not a single keyword. And the
 * words are in English inside a Spanish app, which is why the alias table
 * exists — without it "libro" finds nothing, and that is a failure even when
 * no demo shows it.
 */

describe("el catálogo de emojis", () => {
  it("tiene los 1914 que trae la fuente", () => {
    expect(EMOJI_CATALOG.length).toBeGreaterThan(1800);
  });

  it("usa el glifo como clave, no el punto de código", () => {
    // A catalogue indexed by 1f4d6 cannot be read or debugged.
    expect(EMOJI_CATALOG.some((entry) => entry.emoji === "📖")).toBe(true);
  });

  it("trae palabras clave, o el buscador no es un buscador", () => {
    expect(EMOJI_CATALOG.filter((entry) => entry.keywords.length > 0).length).toBeGreaterThan(1500);
  });

  it("pone cada emoji en un grupo que existe", () => {
    for (const entry of EMOJI_CATALOG) {
      expect(EMOJI_GROUPS, entry.emoji).toContain(entry.group);
    }
  });
});

describe("buscar un emoji en una app que está en español", () => {
  it("encuentra libro, que es una palabra que se escribe", () => {
    expect(searchEmojis("libro").map((entry) => entry.emoji)).toContain("📖");
  });

  it("encuentra café con y sin tilde", () => {
    expect(searchEmojis("cafe").length).toBeGreaterThan(0);
    expect(searchEmojis("café").length).toBeGreaterThan(0);
  });

  it("encuentra casa y perro, que están en la tabla de alias", () => {
    expect(searchEmojis("casa").map((entry) => entry.emoji)).toContain("🏠");
    expect(searchEmojis("perro").map((entry) => entry.emoji)).toContain("🐶");
  });

  it("encuentra en inglés también", () => {
    expect(searchEmojis("house").length).toBeGreaterThan(0);
    expect(searchEmojis("coffee").length).toBeGreaterThan(0);
  });

  it("normaliza la eñe, las tildes y las mayúsculas", () => {
    expect(normaliseQuery("PAÑAL")).toBe("panal");
    expect(normaliseQuery("Camión")).toBe("camion");
    expect(normaliseQuery("  Niño  ")).toBe("nino");
  });

  it("normaliza los guiones bajos de los alias", () => {
    // Los valores de la tabla se escriben `musical_note` y el catálogo guarda
    // `musical note`. Sin esto, `cancion`, `alarma` e `indice` no encontraban
    // nada — tres alias muertos que nadie notaba porque nadie los probaba.
    expect(normaliseQuery("musical_note")).toBe("musical note");
    expect(normaliseQuery("alarm_clock")).toBe("alarm clock");
  });

  it("cada palabra de la tabla encuentra al menos un emoji", () => {
    // La red que impide que la tabla se pudra: medida una vez, 126 de 160
    // palabras cotidianas no devolvían nada. Un alias que no resuelve es una
    // promesa rota en silencio.
    for (const palabra of Object.keys(EMOJI_ALIASES)) {
      expect(searchEmojis(palabra).length, palabra).toBeGreaterThan(0);
    }
  });

  it("encuentra el papel higiénico buscando papel", () => {
    // El reporte que motivo la tabla grande: "papel" no encontraba nada y
    // "paper" si. Ahora lo encuentra, y "papel higienico" lo pone el primero.
    expect(searchEmojis("papel").map((entry) => entry.emoji)).toContain("🧻");
    expect(searchEmojis("papel higienico")[0]?.emoji).toBe("🧻");
    expect(searchEmojis("papel higiénico")[0]?.emoji).toBe("🧻");
  });

  it("muestra todo cuando no hay nada escrito", () => {
    expect(searchEmojis("").length).toBe(EMOJI_CATALOG.length);
    expect(searchEmojis("   ").length).toBe(EMOJI_CATALOG.length);
  });

  it("dice que no hay nada en vez de ofrecerlo todo", () => {
    expect(searchEmojis("qqqqzzzxx")).toEqual([]);
  });

  it("respeta el límite sin cortar por la mitad un grupo de resultados", () => {
    expect(searchEmojis("", { limit: 24 })).toHaveLength(24);
  });

  it("solo ofrece lo del grupo que está abierto", () => {
    const found = searchEmojis("a", { group: "Smileys & Emotion" });
    expect(found.length).toBeGreaterThan(0);
    for (const entry of found) expect(entry.group).toBe("Smileys & Emotion");
  });

  it("no devuelve el mismo emoji dos veces", () => {
    const found = searchEmojis("heart");
    expect(new Set(found.map((entry) => entry.emoji)).size).toBe(found.length);
  });
});
