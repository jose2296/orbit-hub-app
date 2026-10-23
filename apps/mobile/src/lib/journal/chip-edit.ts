/**
 * Tocar un chip mientras se edita: encontrarlo, y quitarlo o cambiarlo.
 *
 * El editor nativo no tiene un evento de "pulsaste un chip", pero si avisa de donde esta el
 * cursor (`onChangeSelection`, un desplazamiento en el texto plano) y de que chip tiene debajo
 * (`onMentionDetected`). Con el HTML del editor se sabe donde cae cada chip en ese texto, y un
 * cursor **dentro** de uno es "se le toco". Todo esto es texto: se prueba sin editor.
 */

const MENTION = /<mention\b([^>]*)>([\s\S]*?)<\/mention>/g;
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
const PAD = / /g;

export interface ChipMatch {
  /** Donde empieza el `<mention>` en el HTML, y cuanto mide. */
  index: number;
  length: number;
  type: string;
  id: string;
  /** El texto que dibuja el chip, con su relleno e icono. */
  text: string;
  /** Donde empieza y acaba en el texto plano que ve el editor. */
  plainStart: number;
  plainEnd: number;
}

function decode(text: string): string {
  return text
    // Numericas, que es como el editor nativo escribe los emojis y el relleno de un chip
    // (`&#128203;`, `&#8194;`): cada una es un caracter, y contarlas como nueve descuadra todo lo
    // que va despues. Las hexadecimales igual.
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&eacute;/g, "é")
    .replace(/&amp;/g, "&");
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * El texto plano de un trozo de HTML, como lo cuenta el editor: un salto por cada parrafo o
 * elemento de lista que se cierra, y las entidades como un solo caracter.
 */
function plainLength(html: string): number {
  const text = html
    .replace(/<\/(p|li|h[1-6]|blockquote|pre)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decode(text).length;
}

function attributesOf(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR.exec(raw)) !== null) out[match[1]!.toLowerCase()] = match[2]!;
  return out;
}

/** Todos los chips de un documento, en orden, con su posicion en el texto plano. */
export function chipMatches(html: string): ChipMatch[] {
  const out: ChipMatch[] = [];
  MENTION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION.exec(html)) !== null) {
    const attributes = attributesOf(match[1] ?? "");
    const text = decode(match[2] ?? "");
    const plainStart = plainLength(html.slice(0, match.index));
    out.push({
      index: match.index,
      length: match[0].length,
      type: attributes["type"] ?? "",
      id: attributes["id"] ?? "",
      text,
      plainStart,
      plainEnd: plainStart + text.length,
    });
  }
  return out;
}

/**
 * El chip que tiene el cursor **dentro**. En los bordes no: poner el cursor justo antes o justo
 * despues de un chip es escribir a su lado, y abrir un menu cada vez que se hace seria
 * insoportable.
 */
export function chipAtCaret(html: string, caret: number): ChipMatch | null {
  // El chip lleva un caracter de relleno a cada lado (que es parte de su fondo). Un cursor pegado a
  // esos rellenos no es "tocar el chip": es lo que queda tras tocar el hueco bajo el texto, y abrir
  // un menu cada vez que se quiere seguir escribiendo despues de un chip es insoportable. Solo
  // cuenta el cuerpo visible.
  return (
    chipMatches(html).find((c) => caret > c.plainStart + 1 && caret < c.plainEnd - 1) ?? null
  );
}

/** El nombre de un chip sin su relleno ni su icono: lo que queda al quitarle el enlace. */
function plainName(text: string): string {
  return text
    .replace(PAD, "")
    .trim()
    .replace(/^\p{Extended_Pictographic}️?\s+/u, "");
}

/** Quita el enlace y deja el nombre como texto normal. */
export function removeChip(html: string, chip: ChipMatch): string {
  return html.slice(0, chip.index) + escape(plainName(chip.text)) + html.slice(chip.index + chip.length);
}

/** Cambia a donde apunta un chip, en el mismo sitio. `text` ya lleva su relleno e icono. */
export function replaceChip(
  html: string,
  chip: ChipMatch,
  next: { indicator: string; text: string; type: string; id: string },
): string {
  // El editor nativo exige el atributo `text` (es lo que escribe su propio `getHTML`): sin el, el
  // `<mention>` no se reconoce como chip y queda como texto suelto.
  const textAttr = next.text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const nuevo = `<mention text="${textAttr}" indicator="${next.indicator}" type="${next.type}" id="${next.id}">${escape(next.text)}</mention>`;
  return html.slice(0, chip.index) + nuevo + html.slice(chip.index + chip.length);
}
