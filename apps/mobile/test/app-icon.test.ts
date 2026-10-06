import { resolveAppIcon } from "@/lib/icons/resolve-icon";
import { describe, expect, it } from "vitest";

/**
 * What `AppIcon` draws, decided without React.
 *
 * No test in this repo renders a component — the `react-native` stub answers
 * `Platform` and a handful of modules, and `useTheme` throws outside a
 * provider — so the decisions live in `resolveAppIcon`, where they can be
 * asked, and the component only draws what it answers. Every behaviour the
 * component has is a behaviour tested here.
 */

describe("AppIcon", () => {
  it("dibuja un emoji como texto, sin ninguna librería", () => {
    expect(resolveAppIcon({ type: "emoji", value: "🍎", color: "auto" }, "light")).toEqual({
      kind: "emoji",
      text: "🍎",
      color: expect.any(String),
    });
  });

  it("dibuja un vector con el glifo que toca según el estilo", () => {
    const outline = resolveAppIcon(
      { type: "vector", value: "pan", library: "ionicons", style: "outline", color: "auto" },
      "light",
    );
    const fill = resolveAppIcon(
      { type: "vector", value: "pan", library: "ionicons", style: "fill", color: "auto" },
      "light",
    );
    expect(outline).toEqual({ kind: "vector", glyph: "cafe-outline", color: expect.any(String), library: "ionicons" });
    expect(fill).toEqual({ kind: "vector", glyph: "cafe", color: expect.any(String), library: "ionicons" });
  });

  it("no tiene icono cuando no hay icono, para que el que llama ponga el respaldo", () => {
    // A space without an icon of its own is drawn with `folder-outline` and not
    // with the folder emoji — decided in roadmap.md:902 — and that decision is
    // the caller's, which is why this answers null instead of drawing it.
    expect(resolveAppIcon(null, "light")).toBeNull();
    expect(resolveAppIcon(undefined, "dark")).toBeNull();
  });

  it("pinta el color del icono cuando tiene uno elegido", () => {
    const resolved = resolveAppIcon(
      { type: "vector", value: "pan", library: "ionicons", style: "outline", color: "rose" },
      "light",
    );
    expect(resolved).toEqual({ kind: "vector", glyph: "cafe-outline", color: expect.stringMatching(/^#/), library: "ionicons" });
    expect(resolved?.color).not.toBe("rose");
  });

  it("hereda el color que le pasan cuando el suyo es auto", () => {
    const auto = resolveAppIcon({ type: "emoji", value: "🍎", color: "auto" }, "light", "#123456");
    const rose = resolveAppIcon({ type: "emoji", value: "🍎", color: "rose" }, "light", "#123456");
    expect(auto).toEqual({ kind: "emoji", text: "🍎", color: "#123456" });
    expect(rose?.color).not.toBe("#123456");
  });

  it("resuelve el auto contra el esquema que está encendido", () => {
    const light = resolveAppIcon({ type: "emoji", value: "🍎", color: "auto" }, "light");
    const dark = resolveAppIcon({ type: "emoji", value: "🍎", color: "auto" }, "dark");
    expect(light?.color).not.toBe(dark?.color);
  });

  it("resuelve en la libreria que trae el icono", () => {
    // La manzana es material: el glifo sale de su fuente y no de la otra.
    const manzana = resolveAppIcon(
      { type: "vector", value: "manzana", library: "material", style: "outline", color: "auto" },
      "light",
    );
    expect(manzana).toEqual({
      kind: "vector",
      glyph: "food-apple-outline",
      color: expect.any(String),
      library: "material",
    });
    // Y una clave de una libreria en la otra no dibuja nada.
    expect(
      resolveAppIcon(
        { type: "vector", value: "manzana", library: "ionicons", style: "outline", color: "auto" },
        "light",
      ),
    ).toBeNull();
  });

  it("devuelve null en vez de un glifo roto cuando no puede dibujar", () => {
    expect(
      resolveAppIcon({ type: "vector", value: "no-existe", library: "ionicons", style: "outline", color: "auto" }, "light"),
    ).toBeNull();
  });
});
