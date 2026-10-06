import { EMOJI_GROUPS } from "@/lib/icons/emoji-catalog.generated";
import { EMOJI_GROUP_LABELS, emojiGroupLabel } from "@/lib/icons/emoji-group-labels";
import { describe, expect, it } from "vitest";

/**
 * The names of the emoji groups, in the language of the app.
 *
 * They come from `unicode-emoji-json` in English, and they are the labels of the
 * category bar. A bar that says "Food & Drink" in a Spanish app is a bar half the
 * people cannot read, and it is worse than no bar because it looks finished.
 */

describe("los nombres de las categorías de emojis", () => {
  it("todos los grupos tienen nombre en español", () => {
    for (const group of EMOJI_GROUPS) {
      expect(EMOJI_GROUP_LABELS[group], group).toBeDefined();
    }
  });

  it("y ninguno se queda con el nombre en inglés", () => {
    // La comprobación que de verdad importa: una entrada que se cuele sin
    // traducir enseña el nombre de arriba en medio de la barra en español.
    for (const group of EMOJI_GROUPS) {
      expect(emojiGroupLabel(group), group).not.toBe(group);
    }
  });

  it("no sobra ninguna entrada: un grupo que ya no existe no se nota", () => {
    for (const group of Object.keys(EMOJI_GROUP_LABELS)) {
      expect(EMOJI_GROUPS, group).toContain(group);
    }
  });

  it("un grupo desconocido enseña su propio nombre, no un hueco", () => {
    expect(emojiGroupLabel("Grupo futuro")).toBe("Grupo futuro");
    expect(emojiGroupLabel("")).toBe("");
  });

  it("los nombres no se repiten, que en una barra es ilegible", () => {
    const nombres = EMOJI_GROUPS.map(emojiGroupLabel);
    expect(new Set(nombres).size).toBe(nombres.length);
  });
});
