import glyphMap from "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json";
import { ITEM_ICON_CATEGORIES, ITEM_ICON_GROUP, ITEM_ICONS } from "@orbit-hub/contracts";
import { describe, expect, it } from "vitest";

import { ITEM_GLYPHS, outlineOf } from "@/lib/lists/item-glyphs";
import {
  ICON_COLOR_KEYS,
  ICON_COLOR_LABEL,
  ICON_GROUP_LABEL,
  glyphOf,
  iconColor,
  iconLabel,
  iconsOf,
  searchIcons,
} from "@/lib/lists/item-icons";

// El mapa de Ionicon tal cual, del fichero de la fuente y no del componente: la
// pregunta es "lo tiene Ionicons", y el componente necesita React para responder.
const GLYPHS = glyphMap as Record<string, unknown>;

describe("the icons the app can draw", () => {
  it("has both drawings for every icon", () => {
    // The one thing a cast cannot check: `cafe` implies `cafe-outline` by
    // convention, not by rule the compiler knows. An icon with no outline would
    // make the filled/outlined switch do nothing, and nothing would say so —
    // so it is asked here, one icon at a time, by name.
    const missing: string[] = [];

    for (const icon of ITEM_ICONS) {
      const filled = ITEM_GLYPHS[icon];
      if (!GLYPHS[filled]) missing.push(`${icon}: no "${filled}"`);
      if (!GLYPHS[outlineOf(filled)]) missing.push(`${icon}: no "${outlineOf(filled)}"`);
    }

    expect(missing).toEqual([]);
  });

  it("draws the two ways differently", () => {
    expect(glyphOf("pan", "fill")).toBe(ITEM_GLYPHS.pan);
    expect(glyphOf("pan", "outline")).toBe(outlineOf(ITEM_GLYPHS.pan));
    expect(glyphOf("pan", "fill")).not.toBe(glyphOf("pan", "outline"));
  });

  it("puts every icon in exactly one group, and fills every group", () => {
    // A group with nothing in it is a tab you tap and see an empty grid, and a
    // hundred and thirty pictures on a single tab is the wall the groups exist
    // to break up.
    for (const category of ITEM_ICON_CATEGORIES) {
      expect(iconsOf(category).length).toBeGreaterThan(0);
    }

    const grouped = ITEM_ICON_CATEGORIES.flatMap(iconsOf).sort();
    expect(grouped).toEqual([...ITEM_ICONS].sort());
  });

  it("has a name for every group and every colour", () => {
    for (const category of ITEM_ICON_CATEGORIES) {
      expect(ICON_GROUP_LABEL[category]).toBeTruthy();
    }
    for (const color of ICON_COLOR_KEYS) {
      expect(ICON_COLOR_LABEL[color]).toBeTruthy();
    }
  });

  it("paints each icon colour differently", () => {
    // Two colours that come out the same are one colour with two names, and the
    // picker offers both as if they were a choice.
    const painted = ICON_COLOR_KEYS.map(iconColor);
    expect(new Set(painted).size).toBe(ICON_COLOR_KEYS.length);
  });

  it("paints an unknown colour key in the neutral one", () => {
    // The column is free text. A row from a future build that names a colour
    // this one does not have still comes out, and not invisible.
    expect(iconColor("chartreuse")).toBe(iconColor("neutral"));
    expect(iconColor(null)).toBe(iconColor("neutral"));
    expect(iconColor(undefined)).toBe(iconColor("neutral"));
  });
});

describe("the name of an icon", () => {
  it("is the key in words", () => {
    // The key is the word somebody would type, so the label is that word and the
    // search finds it. A separate list of names is a second list to mistype.
    expect(iconLabel("pan")).toBe("Pan");
    expect(iconLabel("agua")).toBe("Agua");
    expect(iconLabel("calcetin")).toBe("Calcetin");
  });

  it("is spelled out when the words alone would be wrong", () => {
    // "Pasta dientes" is not a thing anybody says. Only the words that need
    // spelling out are in the dictionary, so it stays seven entries long instead
    // of a hundred and thirty.
    expect(iconLabel("pasta_dientes")).toBe("Pasta de dientes");
    expect(iconLabel("comida_bebe")).toBe("Comida de bebé");
    expect(iconLabel("bombilla_led")).toBe("Bombilla LED");
  });

  it("has no name that is only a prefix of its own key", () => {
    // Every label has to be findable: if the label is "Pasta" and the key is
    // "pasta_dientes", somebody reading "Pasta" has no way to type it.
    for (const icon of ITEM_ICONS) {
      expect(iconLabel(icon).toLowerCase().length).toBeGreaterThan(0);
    }
  });
});

describe("finding an icon by typing", () => {
  it("shows everything when nothing has been typed", () => {
    expect(searchIcons("")).toEqual([...ITEM_ICONS]);
    expect(searchIcons("   ")).toEqual([...ITEM_ICONS]);
  });

  it("finds it when the word is typed with the accent", () => {
    // The keys are written without accents; the person types with them. A search
    // that only finds one of the two spellings looks broken, and it is broken for
    // every Spanish keyboard with the accent key.
    expect(searchIcons("pañal")).toContain("panal");
    expect(searchIcons("cafe")).toContain("cafe");
    expect(searchIcons("bebé")).toContain("bebe");
  });

  it("matches the beginning of a word, not only the whole key", () => {
    // "pasti" is what somebody types who half-remembers "pastilla".
    expect(searchIcons("pasti")[0]).toBe("pastilla");
  });

  it("puts the icon that *is* the word before the ones that start like it", () => {
    // Otherwise the list is a wall of nearly-right answers and the thing you
    // meant is somewhere under your thumb.
    const found = searchIcons("pan");
    expect(found[0]).toBe("pan");
    expect(found).toContain("pantalon");
  });

  it("finds a word that is not the beginning of the key", () => {
    expect(searchIcons("dientes")).toContain("pasta_dientes");
  });

  it("only offers what is in the group that is open", () => {
    const found = searchIcons("", { category: "mascotas" });
    expect(found.length).toBeGreaterThan(0);
    for (const icon of found) {
      expect(ITEM_ICON_GROUP[icon]).toBe("mascotas");
    }
  });

  it("keeps the group when there is something to look for", () => {
    const found = searchIcons("comida", { category: "mascotas" });
    for (const icon of found) {
      expect(ITEM_ICON_GROUP[icon]).toBe("mascotas");
    }
  });

  it("says nothing found instead of offering everything", () => {
    // An empty grid with a line in it is the honest answer; showing the whole
    // wall because nothing matched is a search that does not work and does not
    // say so.
    expect(searchIcons("qqqqzzz")).toEqual([]);
  });

  it("never offers the same icon twice", () => {
    const found = searchIcons("a");
    expect(new Set(found).size).toBe(found.length);
  });
});
/**
 * Lo que `iconColor` pinta con cada clase de valor.
 *
 * Las claves van a la paleta, un hex va tal cual y lo demas cae al neutro: un
 * color libre que no se pintara es un estado que parece un bug en el tablero, y
 * un nombre desconocido que rompiera seria una fila de otra build que no sale.
 */
describe("the colour a key paints", () => {
  it("paints palette keys from the palette", () => {
    // A key is never painted as itself: it resolves to a hex of the theme, so a
    // test that only said "red paints red" would pass with the passthrough below
    // and prove nothing.
    expect(iconColor("red")).toMatch(/^#[0-9a-f]{6}$/i);
    expect(iconColor("red")).not.toBe("red");
  });
  it("paints a chosen hex as it is", () => {
    expect(iconColor("#a3e635")).toBe("#a3e635");
    expect(iconColor("#A3E635")).toBe("#A3E635");
  });
  it("falls back to neutral for anything else", () => {
    expect(iconColor("chartreuse")).toBe(iconColor("neutral"));
    expect(iconColor("#fff")).toBe(iconColor("neutral"));
    expect(iconColor(null)).toBe(iconColor("neutral"));
  });
});

