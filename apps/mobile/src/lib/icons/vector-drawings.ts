import {
  VECTOR_ICON_CATALOG,
  VECTOR_ICON_CATEGORIES,
  VECTOR_ICON_KEYWORDS,
  labelOf,
  vectorGlyph,
} from "@orbit-hub/contracts";
import type { VectorIconCategory } from "@orbit-hub/contracts";

/**
 * One cell per drawing, with every word that finds it.
 *
 * `VECTOR_ICON_CATALOG` has 487 keys and **181 distinct drawings**: 80 glyphs are
 * shared by several keys and the worst puts eleven words on one trail sign. In a
 * grid that is eleven cells drawing the same picture, and it reads as a catalogue
 * full of mistakes rather than as one word having several synonyms.
 *
 * What collapses is the **view**, not the data. Every key stays in the contract
 * — `ITEM_ICONS` is the net that stops anybody removing an icon somebody already
 * chose — and every key is still searchable, because a drawing indexes all the
 * words that draw it. Typing `azucar`, `sal` or `caja` lands on the same cell.
 *
 * Deduping by the outline glyph covers both styles: `vectorGlyph` derives the
 * fill from the outline on all 487 keys with no exception, so a picture is one
 * picture in outline and in fill. `test/vector-drawings.test.ts` checks it rather
 * than assuming it.
 */

export interface VectorDrawing {
  /** The key stored when this cell is picked: the first of its aliases, always. */
  key: string;
  /** Every catalogue key that draws this same picture. */
  aliases: readonly string[];
  /** The outline glyph, which identifies the drawing. */
  glyph: string;
  category: VectorIconCategory;
  /** What the cell is called when a screen reads it out. */
  label: string;
  /** Every word that finds it, accents folded and lower case. */
  words: readonly string[];
}

/**
 * Without accents and in lower case.
 *
 * The keys are written without them and the person types with them, so a search
 * that only finds one of the two spellings is broken for every Spanish keyboard
 * with the accent key.
 */
function normalise(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/_/g, " ");
}

/**
 * Every word that reaches a drawing: its aliases, its name, and its extra words.
 *
 * The aliases are what the drawing **is**. The extra words are what somebody
 * reaches for instead: "wifi" for the radio button, "cobertura" for the signal
 * bars. Without them the search is a dictionary of names, and a person who wants
 * the wifi icon has to guess that it is called "radio".
 */
function wordsOf(aliases: readonly string[], label: string, extra: readonly string[] = []): string[] {
  const words = new Set<string>();
  const add = (raw: string) => {
    for (const part of normalise(raw).split(/\s+/)) {
      if (part) words.add(part);
    }
  };
  for (const alias of aliases) add(alias);
  add(label);
  for (const word of extra) add(word);
  return [...words];
}

/**
 * The catalogue grouped by drawing, in category order.
 *
 * Categories come first because that is how the picker shows them, and inside a
 * category the order is the catalogue's — the order somebody walked when the keys
 * were written. Reordering here would change it for no reason.
 */
function groupByDrawing(): VectorDrawing[] {
  const porGlifo = new Map<string, string[]>();

  for (const entry of VECTOR_ICON_CATALOG) {
    const glyph = vectorGlyph(entry.key, "outline");
    // A key this build cannot draw is not a cell. It stays in the catalogue and
    // in every search over it, but there is no picture to show.
    if (!glyph) continue;
    const aliases = porGlifo.get(glyph);
    if (aliases) aliases.push(entry.key);
    else porGlifo.set(glyph, [entry.key]);
  }

  const drawings: VectorDrawing[] = [];
  for (const category of VECTOR_ICON_CATEGORIES) {
    for (const entry of VECTOR_ICON_CATALOG) {
      if (entry.category !== category) continue;
      const glyph = vectorGlyph(entry.key, "outline");
      if (!glyph) continue;
      const aliases = porGlifo.get(glyph);
      if (!aliases) continue;
      // Only the first key of a drawing creates it; the rest just joined the
      // list above. That is what makes `key` deterministic.
      if (aliases[0] !== entry.key) continue;

      const label = labelOf(entry.key);
      drawings.push({
        key: entry.key,
        aliases: [...aliases],
        glyph,
        category,
        label,
        // A drawing collects the extra words of **every** key that draws it: five
        // people can call the same picture and all five have to find it.
        words: wordsOf(
          aliases,
          label,
          aliases.flatMap((alias) => VECTOR_ICON_KEYWORDS[alias] ?? []),
        ),
      });
    }
  }

  return drawings;
}

export const DRAWINGS: readonly VectorDrawing[] = groupByDrawing();

/** The drawings of one category, in catalogue order. */
export function drawingsOf(category: VectorIconCategory): VectorDrawing[] {
  return DRAWINGS.filter((entry) => entry.category === category);
}

/**
 * The drawings for what was typed, best match first.
 *
 * Every word has to match, and a match can be anywhere in a drawing's words: the
 * whole point of collapsing eleven keys into one cell is that all eleven of them
 * still find it. Nothing typed is everything, in catalogue order — the grid shows
 * the whole catalogue and the search narrows it.
 */
export function searchDrawings(query: string): readonly VectorDrawing[] {
  const terms = normalise(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return DRAWINGS;

  const scored: Array<{ drawing: VectorDrawing; score: number }> = [];
  for (const drawing of DRAWINGS) {
    let score = 0;
    let matches = true;

    for (const term of terms) {
      if (drawing.key === term) {
        score += 3;
        continue;
      }
      // A whole word starting with it beats one that merely contains it, because
      // "pan" should find bread before it finds "campana".
      if (drawing.words.some((word) => word.startsWith(term))) {
        score += 2;
        continue;
      }
      if (drawing.words.some((word) => word.includes(term))) {
        score += 1;
        continue;
      }
      matches = false;
      break;
    }

    if (matches) scored.push({ drawing, score });
  }

  scored.sort((a, b) => b.score - a.score || a.drawing.key.localeCompare(b.drawing.key));
  return scored.map((entry) => entry.drawing);
}
