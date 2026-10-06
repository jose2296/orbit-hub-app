import { iconChange, mismoIcono } from "@/lib/icons/icon-change";
import { parseRecentEmojis, withRecentEmoji } from "@/lib/icons/recent-emojis";
import { searchVectors } from "@/lib/icons/search-vectors";
import { describe, expect, it } from "vitest";

/**
 * What the picker returns, without rendering the picker.
 *
 * No test in this repo renders a component, so `iconChange` — the diff between
 * the icon there was and the one there is now — lives in `lib`, where it can
 * be asked. The panel cannot be asked, but this is the whole of what the panel
 * decides.
 */

describe("lo que el selector devuelve", () => {
  it("el primer cambio manda el icono entero", () => {
    expect(iconChange(null, { type: "emoji", value: "🍎", color: "auto" })).toEqual({
      icon: { type: "emoji", value: "🍎", color: "auto" },
    });
  });

  it("cambiar el color NO borra el icono", () => {
    // The bug that was paid for once: the picker sent the whole icon on every
    // change with the value it thought the row had, which was the one from
    // before the icon was chosen.
    const elegido = {
      type: "vector",
      value: "pan",
      library: "ionicons",
      style: "outline",
      color: "auto",
    } as const;
    const conColor = iconChange(elegido, { ...elegido, color: "rose" });
    expect(conColor.color).toBe("rose");
    expect(conColor.icon).toBeUndefined();
  });

  it("cambiar el icono manda el icono y no toca el color", () => {
    const conColor = { type: "emoji", value: "🍎", color: "rose" } as const;
    const change = iconChange(conColor, {
      type: "vector",
      value: "pan",
      library: "ionicons",
      style: "outline",
      color: "rose",
    });
    expect(change.icon).toEqual({
      type: "vector",
      value: "pan",
      library: "ionicons",
      style: "outline",
      color: "rose",
    });
    expect(change.color).toBeUndefined();
  });

  it("cambiar el dibujo manda el icono", () => {
    const contorno = {
      type: "vector",
      value: "pan",
      library: "ionicons",
      style: "outline",
      color: "auto",
    } as const;
    const change = iconChange(contorno, { ...contorno, style: "fill" });
    expect(change.icon).toBeDefined();
    expect(change.color).toBeUndefined();
  });

  it("no manda nada cuando no cambió nada", () => {
    const icono = { type: "emoji", value: "🍎", color: "auto" } as const;
    expect(iconChange(icono, { ...icono })).toEqual({});
  });

  it("quitar el icono es null y no un objeto vacío", () => {
    const change = iconChange({ type: "emoji", value: "🍎", color: "auto" }, null);
    expect(change.icon).toBeNull();
  });
});

describe("buscar un dibujo por la palabra que se escribe", () => {
  it("muestra todo cuando no hay nada escrito", () => {
    expect(searchVectors("").length).toBeGreaterThan(400);
    expect(searchVectors("   ").length).toBeGreaterThan(400);
  });

  it("pone el icono que ES la palabra antes que los que empiezan como ella", () => {
    const found = searchVectors("pan");
    expect(found[0]).toBe("pan");
  });

  it("encuentra con tilde lo que está escrito sin ella", () => {
    // Las claves van sin tildes y la persona escribe con ellas: la búsqueda que
    // solo encuentra una de las dos formas está rota para cada teclado español.
    expect(searchVectors("panal")).toContain("panal");
    expect(searchVectors("pañal")).toContain("panal");
    expect(searchVectors("bebe")).toContain("comida_bebe");
    expect(searchVectors("bebé")).toContain("comida_bebe");
  });

  it("encuentra por el principio de una palabra, no solo por la clave entera", () => {
    expect(searchVectors("pasti")).toContain("pastilla");
  });

  it("solo ofrece lo del grupo que está abierto", () => {
    const found = searchVectors("", { category: "naturaleza" });
    expect(found.length).toBeGreaterThan(0);
    expect(found).toContain("perro");
    expect(found).not.toContain("pan");
  });

  it("dice que no hay nada en vez de ofrecerlo todo", () => {
    expect(searchVectors("qqqqzzz")).toEqual([]);
  });

  it("nunca ofrece el mismo icono dos veces", () => {
    expect(new Set(searchVectors("a")).size).toBe(searchVectors("a").length);
  });
});

describe("los emojis recientes", () => {
  it("empiezan vacíos y ponen el último primero sin repetir", () => {
    expect(parseRecentEmojis(null)).toEqual([]);
    expect(parseRecentEmojis("no es un array")).toEqual([]);
    expect(parseRecentEmojis(["🍎", 42, null])).toEqual(["🍎"]);
    expect(withRecentEmoji([], "🍎")).toEqual(["🍎"]);
    expect(withRecentEmoji(["🍎", "🏠"], "🏠")).toEqual(["🏠", "🍎"]);
  });

  it("no pasan de dieciséis", () => {
    const llenos = Array.from({ length: 16 }, (_, i) => `e${i}`);
    expect(withRecentEmoji(llenos, "nuevo")).toHaveLength(16);
    expect(withRecentEmoji(llenos, "nuevo")[0]).toBe("nuevo");
  });
});

describe("mismoIcono", () => {
  it("dos objetos diciendo lo mismo son lo mismo aunque no sean el mismo", () => {
    // El borrador guarda lo elegido y la fila guarda lo que tiene: comparar por
    // referencia encenderia Guardar en cada apertura.
    expect(
      mismoIcono(
        { type: "vector", value: "pan", library: "ionicons", style: "outline", color: "auto" },
        { type: "vector", value: "pan", library: "ionicons", style: "outline", color: "auto" },
      ),
    ).toBe(true);
  });

  it("distingue estilo, color, libreria y tipo", () => {
    const base = {
      type: "vector",
      value: "pan",
      library: "ionicons",
      style: "outline",
      color: "auto",
    } as const;
    expect(mismoIcono(base, { ...base, style: "fill" })).toBe(false);
    expect(mismoIcono(base, { ...base, color: "rose" })).toBe(false);
    expect(mismoIcono(base, { ...base, library: "material" })).toBe(false);
    expect(mismoIcono(base, { type: "emoji", value: "🍎", color: "auto" })).toBe(false);
  });

  it("sin icono contra sin icono es lo mismo, y contra icono no", () => {
    expect(mismoIcono(null, null)).toBe(true);
    expect(mismoIcono(undefined, null)).toBe(true);
    expect(mismoIcono(null, { type: "emoji", value: "🍎", color: "auto" })).toBe(false);
    expect(mismoIcono({ type: "emoji", value: "🍎", color: "auto" }, null)).toBe(false);
  });
});
