import {
  ITEM_ICONS,
  VECTOR_ICON_CATALOG,
  VECTOR_ICON_CATEGORIES,
  iconColorSchema,
  iconSchema,
  isVectorIcon,
  sanitiseIconRef,
  vectorGlyph,
} from "@orbit-hub/contracts";
import { describe, expect, it } from "vitest";
import type { IconRef } from "@orbit-hub/contracts";

/**
 * The icon is one object in one column, and this is the shape of it.
 *
 * These tests are about the edges, because that is where an icon stops being
 * one: an emoji with a library on it, a vector without one, a colour that is a
 * hex, a key from a build that does not exist. None of those may throw, and none
 * may take the row around them down.
 */

describe("IconRef", () => {
  it("takes an emoji with its colour", () => {
    expect(iconSchema.parse({ type: "emoji", value: "🍎", color: "rose" })).toEqual({
      type: "emoji",
      value: "🍎",
      color: "rose",
    });
  });

  it("takes an emoji of several code points", () => {
    // A family is four people and three joiners. Capping at one code point would
    // have thrown away most of the emojis people actually use.
    expect(iconSchema.safeParse({ type: "emoji", value: "👨‍👩‍👧‍👦" }).success).toBe(true);
  });

  it("has no library nor style on an emoji", () => {
    // The reason for the union is that the TYPE says so: there is no `library`
    // in the emoji shape for a consumer to read. Zod strips an unknown key
    // instead of failing on it, which is the other half of the guarantee — the
    // field does not survive the parse, so there is nothing to misuse.
    const withLibrary = iconSchema.parse({ type: "emoji", value: "🍎", library: "ionicons" });
    expect(withLibrary).toEqual({ type: "emoji", value: "🍎", color: "auto" });
    expect("library" in withLibrary).toBe(false);

    const withStyle = iconSchema.parse({ type: "emoji", value: "🍎", style: "fill" });
    expect("style" in withStyle).toBe(false);

    // And the parsed type is what keeps a compiler honest: `library` is not a
    // property of an IconRef whose type is "emoji", so the mistake will not
    // compile at all.
    const icon: IconRef = withLibrary;
    expect(icon.type).toBe("emoji");
  });

  it("needs a library on a vector, and defaults the style", () => {
    expect(iconSchema.parse({ type: "vector", value: "pan", library: "ionicons" })).toEqual({
      type: "vector",
      value: "pan",
      library: "ionicons",
      style: "outline",
      color: "auto",
    });
    expect(iconSchema.safeParse({ type: "vector", value: "pan" }).success).toBe(false);
  });

  it("refuses a hex as a colour", () => {
    // A hex in the database has no dark mode. That is the reason this is a key.
    expect(iconSchema.safeParse({ type: "emoji", value: "🍎", color: "#FF6B6B" }).success).toBe(false);
  });

  it("takes the twelve colours and auto", () => {
    for (const colour of ["auto", "neutral", "accent", "rose", "teal", "brown"]) {
      expect(iconColorSchema.safeParse(colour).success, colour).toBe(true);
    }
  });

  it("refuses an empty value", () => {
    expect(iconSchema.safeParse({ type: "emoji", value: "" }).success).toBe(false);
    expect(iconSchema.safeParse({ type: "vector", value: "", library: "ionicons" }).success).toBe(false);
  });

  it("refuses an emoji that is really a phrase", () => {
    expect(iconSchema.safeParse({ type: "emoji", value: "hola que tal" }).success).toBe(false);
    expect(iconSchema.safeParse({ type: "emoji", value: "a".repeat(40) }).success).toBe(false);
  });
});

describe("sanitiseIconRef", () => {
  it("keeps an emoji it can draw", () => {
    expect(sanitiseIconRef({ type: "emoji", value: "🏠" })).toEqual({
      type: "emoji",
      value: "🏠",
      color: "auto",
    });
  });

  it("keeps a vector with the style and the colour it had", () => {
    expect(
      sanitiseIconRef({ type: "vector", value: "pan", library: "ionicons", style: "fill", color: "rose" }),
    ).toEqual({ type: "vector", value: "pan", library: "ionicons", style: "fill", color: "rose" });
  });

  it("answers null instead of throwing when it does not know", () => {
    // Nothing here may throw: this runs where a row is read and written, and a
    // row from a future build still has to open.
    expect(sanitiseIconRef(null)).toBeNull();
    expect(sanitiseIconRef(undefined)).toBeNull();
    expect(sanitiseIconRef("pan")).toBeNull();
    expect(sanitiseIconRef(42)).toBeNull();
    expect(sanitiseIconRef({})).toBeNull();
    expect(sanitiseIconRef({ type: "vector", value: "no-existe", library: "ionicons" })).toBeNull();
    expect(sanitiseIconRef({ type: "vector", value: "pan" })).toBeNull();
  });

  it("falls back to auto for a colour it does not know", () => {
    expect(sanitiseIconRef({ type: "emoji", value: "🍎", color: "chartreuse" })).toEqual({
      type: "emoji",
      value: "🍎",
      color: "auto",
    });
  });

  it("puts the outline back on a vector that arrived without a style", () => {
    expect(sanitiseIconRef({ type: "vector", value: "pan", library: "ionicons", color: "teal" })).toEqual({
      type: "vector",
      value: "pan",
      library: "ionicons",
      style: "outline",
      color: "teal",
    });
  });
});

describe("the vector catalogue", () => {
  it("is big enough to be a catalogue and not a shortlist", () => {
    expect(VECTOR_ICON_CATALOG.length).toBeGreaterThanOrEqual(400);
  });

  it("puts every entry in a group that exists, with a name and a glyph", () => {
    for (const entry of VECTOR_ICON_CATALOG) {
      expect(VECTOR_ICON_CATEGORIES, entry.key).toContain(entry.category);
      expect(entry.label.length, entry.key).toBeGreaterThan(0);
      expect(entry.glyph.length, entry.key).toBeGreaterThan(0);
    }
  });

  it("gives every group something in it", () => {
    // A group with nothing in it is a chip somebody taps and sees an empty grid.
    for (const category of VECTOR_ICON_CATEGORIES) {
      expect(
        VECTOR_ICON_CATALOG.filter((e) => e.category === category).length,
        category,
      ).toBeGreaterThan(0);
    }
  });

  it("never repeats a key", () => {
    const keys = VECTOR_ICON_CATALOG.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the 131 that already existed, so nobody loses the one they chose", () => {
    for (const icon of ITEM_ICONS) {
      expect(isVectorIcon(icon), icon).toBe(true);
    }
  });

  it("leaves the 35 app-system glyphs out", () => {
    // Those are the note type, the widget type and the delete button. Offered as
    // a choice, a type's own glyph would be one more thing to pick wrongly.
    for (const glyph of ["document-text-outline", "albums-outline", "trash-outline", "tv-outline"]) {
      expect(isVectorIcon(glyph), glyph).toBe(false);
    }
  });

  it("names an entry after its own key, in the language the app is in", () => {
    const pan = VECTOR_ICON_CATALOG.find((e) => e.key === "pan");
    expect(pan?.label).toBe("Pan");
    const pasta = VECTOR_ICON_CATALOG.find((e) => e.key === "pasta_dientes");
    expect(pasta?.label).toBe("Pasta de dientes");
  });
});

describe("vectorGlyph", () => {
  it("draws both ways from one key", () => {
    // The key is the word somebody types and the glyph is the drawing: `pan` is
    // typed, `cafe` is drawn, and `pan-outline` is not a glyph.
    expect(vectorGlyph("pan", "fill")).toBe("cafe");
    expect(vectorGlyph("pan", "outline")).toBe("cafe-outline");
    expect(vectorGlyph("pan", "fill")).not.toBe(vectorGlyph("pan", "outline"));
  });

  it("answers null for a key with no drawing, not a made-up name", () => {
    // A name that does not exist makes Ionicons render an empty Text and say
    // nothing, which is the failure this whole file is arranged against.
    expect(vectorGlyph("no-existe", "fill")).toBeNull();
    expect(vectorGlyph("no-existe", "outline")).toBeNull();
  });

  it("draws a glyph that exists for every key in the catalogue", () => {
    for (const entry of VECTOR_ICON_CATALOG) {
      expect(vectorGlyph(entry.key, "fill"), entry.key).toBe(entry.glyph);
      expect(vectorGlyph(entry.key, "outline"), entry.key).toBe(`${entry.glyph}-outline`);
    }
  });
});
/**
 * Every key the picker offers has both drawings in the real font.
 *
 * This is the check that cannot be written any other way: `cafe` implies
 * `cafe-outline` by naming convention, and no compiler knows that. An icon with
 * only one drawing makes the outline/filled switch do nothing, and an icon with
 * neither renders an empty Text and says nothing at all. So it is asked here, one
 * icon at a time, against the glyphmap file rather than the component — the
 * question is "does Ionicons have this", and the component needs React to answer.
 */
describe("every key is a glyph Ionicons really has", () => {
  it("has the filled drawing and the outline drawing for all of them", async () => {
    const { default: glyphMap } = await import(
      "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json"
    );
    const glyphs = glyphMap as Record<string, unknown>;
    const missing: string[] = [];

    for (const entry of VECTOR_ICON_CATALOG) {
      if (!glyphs[entry.glyph]) missing.push(`${entry.key}: no "${entry.glyph}"`);
      if (!glyphs[`${entry.glyph}-outline`]) missing.push(`${entry.key}: no "${entry.glyph}-outline"`);
    }

    expect(missing).toEqual([]);
  });
});
