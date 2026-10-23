import { describe, expect, it } from "vitest";

import { chipAtCaret, chipMatches, removeChip, replaceChip } from "@/lib/journal/chip-edit";

const PAD = " ";
const chip = (type: string, id: string, label: string, indicator = "§") =>
  `<mention indicator="${indicator}" type="${type}" id="${id}">${PAD}${label}${PAD}</mention>`;

// "Prueba" (6) + salto (1) + chip de 12 unidades: ocupa [7, 19).
const doc = `<p>Prueba</p><p>${chip("list", "l-1", "📋 Mudanza")}</p>`;

describe("chipMatches", () => {
  it("da donde cae cada chip en el texto plano, con un salto por parrafo", () => {
    const [primero] = chipMatches(doc);
    expect(primero).toMatchObject({ type: "list", id: "l-1" });
    expect(primero?.plainStart).toBe(7);
    expect(primero?.plainEnd).toBe(7 + `${PAD}📋 Mudanza${PAD}`.length);
  });

  it("sin chips no devuelve nada", () => {
    expect(chipMatches("<p>hola</p>")).toEqual([]);
  });

  it("cuenta el texto de antes del chip dentro del mismo parrafo", () => {
    const html = `<p>ir a ${chip("note", "n-1", "📝 Idea")} hoy</p>`;
    expect(chipMatches(html)[0]?.plainStart).toBe("ir a ".length);
  });

  it("los acentos y las entidades cuentan como un caracter", () => {
    const html = `<p>caf&eacute; &amp; ${chip("note", "n-1", "📝 Idea")}</p>`;
    expect(chipMatches(html)[0]?.plainStart).toBe("café & ".length);
  });
});

describe("entidades numericas, que es como el editor nativo escribe los emojis", () => {
  const nativo = (antes: string) =>
    `<p>${antes}<mention indicator="§" type="list" id="l-1">&#8194;&#128203; Mudanza&#8194;</mention></p>`;

  it("el texto del chip sale decodificado, no con &#128203;", () => {
    expect(chipMatches(nativo(""))[0]?.text).toBe(`${PAD}📋 Mudanza${PAD}`);
  });

  it("un emoji antes del chip cuenta como sus dos unidades, no como nueve caracteres", () => {
    // "😀 hola " = 2 + 1 + 4 + 1 = 8 unidades UTF-16.
    expect(chipMatches(nativo("&#128512; hola "))[0]?.plainStart).toBe(8);
  });

  it("tambien las hexadecimales", () => {
    const html = `<p>&#x1F600; <mention indicator="§" type="list" id="l-1">x</mention></p>`;
    expect(chipMatches(html)[0]?.plainStart).toBe(3);
  });
});

describe("chipAtCaret", () => {
  it("un cursor dentro del chip lo encuentra", () => {
    expect(chipAtCaret(doc, 12)?.id).toBe("l-1");
  });

  it("en los bordes no: tocar justo antes o despues del chip es escribir al lado, no tocarlo", () => {
    expect(chipAtCaret(doc, 7)).toBeNull();
    const fin = chipMatches(doc)[0]!.plainEnd;
    expect(chipAtCaret(doc, fin)).toBeNull();
  });

  it("el relleno de cada lado tampoco cuenta: tocar el hueco bajo el texto deja el cursor ahi", () => {
    // Visto en Android: tocar bajo un texto que termina en un chip dejaba el cursor pegado a su
    // relleno final y abria el menu cada vez que se queria seguir escribiendo.
    const { plainStart, plainEnd } = chipMatches(doc)[0]!;
    expect(chipAtCaret(doc, plainStart + 1)).toBeNull();
    expect(chipAtCaret(doc, plainEnd - 1)).toBeNull();
  });

  it("el cuerpo visible del chip, si", () => {
    const { plainStart, plainEnd } = chipMatches(doc)[0]!;
    expect(chipAtCaret(doc, plainStart + 2)?.id).toBe("l-1");
    expect(chipAtCaret(doc, plainEnd - 2)?.id).toBe("l-1");
  });

  it("fuera del chip no hay nada", () => {
    expect(chipAtCaret(doc, 3)).toBeNull();
  });

  it("con dos chips elige el que contiene el cursor", () => {
    const dos = `<p>${chip("list", "a", "📋 Uno")} ${chip("note", "b", "📝 Dos")}</p>`;
    const [a, b] = chipMatches(dos);
    expect(chipAtCaret(dos, a!.plainStart + 3)?.id).toBe("a");
    expect(chipAtCaret(dos, b!.plainStart + 3)?.id).toBe("b");
  });
});

describe("removeChip", () => {
  it("deja su nombre como texto normal, sin icono ni relleno", () => {
    const quitado = removeChip(doc, chipMatches(doc)[0]!);
    expect(quitado).toBe("<p>Prueba</p><p>Mudanza</p>");
  });

  it("no toca los demas chips", () => {
    const dos = `<p>${chip("list", "a", "📋 Uno")}${chip("note", "b", "📝 Dos")}</p>`;
    const sin = removeChip(dos, chipMatches(dos)[0]!);
    expect(sin).toContain('id="b"');
    expect(sin).not.toContain('id="a"');
  });

  it("escapa lo que se vuelve texto", () => {
    const html = `<p>${chip("note", "n", "📝 a<b & c")}</p>`;
    expect(removeChip(html, chipMatches(html)[0]!)).toBe("<p>a&lt;b &amp; c</p>");
  });
});

describe("replaceChip", () => {
  it("cambia a donde apunta y como se llama, en el mismo sitio", () => {
    const nuevo = replaceChip(doc, chipMatches(doc)[0]!, {
      indicator: "§teal",
      text: `${PAD}📝 Idea${PAD}`,
      type: "note",
      id: "n-9",
    });
    expect(nuevo).toBe(
      `<p>Prueba</p><p><mention text="${PAD}📝 Idea${PAD}" indicator="§teal" type="note" id="n-9">${PAD}📝 Idea${PAD}</mention></p>`,
    );
  });
});
