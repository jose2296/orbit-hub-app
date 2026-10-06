import { ICON_COLORS, iconColorHex } from "@/theme/tokens";
import { describe, expect, it } from "vitest";

/**
 * The colours an icon is drawn in, as theme tokens.
 *
 * They used to live as twelve hexes in `lib/lists/item-icons.ts`, outside the
 * theme and with no dark mode. A hex stored nowhere near the scheme it is drawn
 * on is a colour that cannot be read on half the screens, so they moved here:
 * every token has its light hex and its dark one, and the renderer asks for the
 * one of the scheme that is on.
 */

describe("los colores de los iconos", () => {
  it("tiene los doce de siempre más auto", () => {
    expect(Object.keys(ICON_COLORS)).toHaveLength(13);
    expect(ICON_COLORS.auto).toBeDefined();
  });

  it("da dos hex distintos en claro y en oscuro", () => {
    // A stored hex has no dark mode: it draws the same over a dark surface.
    // A token does, and that is why the colour travels as a name.
    for (const key of Object.keys(ICON_COLORS)) {
      const light = iconColorHex(key, "light");
      const dark = iconColorHex(key, "dark");
      expect(light, key).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(dark, key).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(light, key).not.toBe(dark);
    }
  });

  it("pinta el mismo token distinto según el esquema", () => {
    expect(iconColorHex("rose", "light")).not.toBe(iconColorHex("rose", "dark"));
  });

  it("cae en neutral cuando el nombre no lo conoce", () => {
    // A row from a future build, or a text edited by hand, still comes out.
    expect(iconColorHex("chartreuse", "light")).toBe(iconColorHex("neutral", "light"));
    expect(iconColorHex(null, "light")).toBe(iconColorHex("neutral", "light"));
    expect(iconColorHex(undefined, "dark")).toBe(iconColorHex("neutral", "dark"));
  });

  it("no confunde un color con un nombre de propiedad", () => {
    // ICON_COLORS is a plain object: ICON_COLORS["toString"] is a function and
    // not a colour. The gate is on the caller, like in tagColorHex.
    expect(iconColorHex("toString", "light")).toBe(iconColorHex("neutral", "light"));
    expect(iconColorHex("__proto__", "light")).toBe(iconColorHex("neutral", "light"));
  });

  it("es auto el color que hereda la entidad", () => {
    expect(iconColorHex("auto", "light")).toBeDefined();
    expect(iconColorHex("auto", "dark")).toBeDefined();
  });
});
