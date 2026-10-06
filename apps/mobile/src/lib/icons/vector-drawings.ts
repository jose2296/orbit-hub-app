import {
  VECTOR_ICON_CATALOG,
  VECTOR_ICON_CATEGORIES,
  VECTOR_ICON_KEYWORDS,
  labelOf,
  vectorGlyph,
} from "@orbit-hub/contracts";
import type { IconLibrary, Locale, VectorIconCategory } from "@orbit-hub/contracts";

/**
 * One cell per drawing, with every word that finds it.
 *
 * The Ionicons half of the catalogue maps hundreds of keys onto far fewer
 * drawings — eleven words on one trail sign — and a grid with eleven cells
 * drawing the same picture reads as a catalogue full of mistakes. The Material
 * half names each glyph once, so it barely collapses at all.
 *
 * What collapses is the **view**, not the data. Every key stays in the contract
 * — `ITEM_ICONS` is the net that stops anybody removing an icon somebody already
 * chose — and every key is still searchable, because a drawing indexes all the
 * words that draw it. Typing `azucar`, `sal` or `caja` lands on the same cell.
 *
 * The identity of a drawing is the library **and** the outline glyph: two fonts
 * can draw alike, and `ionicons:cube` is not the same cell as `material:cube`
 * even if they rhymed. `test/vector-drawings.test.ts` checks the dedup rather
 * than assuming it.
 */

export interface VectorDrawing {
  /** The key stored when this cell is picked: the first of its aliases, always. */
  key: string;
  /** Every catalogue key that draws this same picture. */
  aliases: readonly string[];
  /**
   * What identifies the drawing, and what the cell is matched on: the library
   * and the outline glyph together. A row can hold any of the words that draw
   * it, so the key alone never identifies a cell.
   */
  id: string;
  /** The outline glyph, which is what the cell draws in outline style. */
  glyph: string;
  library: IconLibrary;
  category: VectorIconCategory;
  /** What the cell is called when a screen reads it out. */
  label: string;
  /** Every word that finds it, accents folded and lower case. */
  words: readonly string[];
  /**
   * The same, in English: the glyph name split into words (`food-apple` finds
   * `food` and `apple`). Always the fallback, never the primary — see
   * `searchDrawings`.
   */
  english: readonly string[];
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
  const porDibujo = new Map<string, string[]>();

  for (const entry of VECTOR_ICON_CATALOG) {
    const glyph = vectorGlyph(entry.key, "outline", entry.library);
    // A key this build cannot draw is not a cell. It stays in the catalogue and
    // in every search over it, but there is no picture to show.
    if (!glyph) continue;
    const id = `${entry.library}:${glyph}`;
    const aliases = porDibujo.get(id);
    if (aliases) aliases.push(entry.key);
    else porDibujo.set(id, [entry.key]);
  }

  const drawings: VectorDrawing[] = [];
  for (const category of VECTOR_ICON_CATEGORIES) {
    for (const entry of VECTOR_ICON_CATALOG) {
      if (entry.category !== category) continue;
      const glyph = vectorGlyph(entry.key, "outline", entry.library);
      if (!glyph) continue;
      const id = `${entry.library}:${glyph}`;
      const aliases = porDibujo.get(id);
      if (!aliases) continue;
      // Only the first key of a drawing creates it; the rest just joined the
      // list above. That is what makes `key` deterministic.
      if (aliases[0] !== entry.key) continue;

      const label = labelOf(entry.key);
      drawings.push({
        key: entry.key,
        aliases: [...aliases],
        id,
        glyph,
        library: entry.library,
        category,
        label,
        english: glyph
          .replace(/-outline$/, "")
          .split(/[-_]/)
          .map((part) => part.toLowerCase())
          .filter(Boolean),
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
 * How well one word matches a list of words: exact key first, then prefix, then
 * inside. Shared by both languages so the tiers stay comparable.
 */
function tierOf(term: string, key: string, words: readonly string[]): number {
  if (key === term) return 3;
  if (words.some((word) => word.startsWith(term))) return 2;
  if (words.some((word) => word.includes(term))) return 1;
  return 0;
}

/**
 * The drawings for what was typed, best match first — in the user's language,
 * with English always as the fallback.
 *
 * Every word has to match, and a match can be anywhere in a drawing's words: the
 * whole point of collapsing eleven keys into one cell is that all eleven of them
 * still find it. Nothing typed is everything, in catalogue order — the grid shows
 * the whole catalogue and the search narrows it.
 *
 * Two tiers, and the primary language always wins: with `es`, a Spanish score of
 * 1 outranks an English score of 3, because the person typed in Spanish. English
 * is the net underneath — "apple" finds the manzana even though no Spanish word
 * for it exists in the catalogue. With `en` it is the other way around. A query
 * mixing both languages matches neither tier on every word, and finds nothing:
 * half a query in each language is not a query in either.
 */
export function searchDrawings(query: string, locale: Locale = "es"): readonly VectorDrawing[] {
  const terms = normalise(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return DRAWINGS;

  const scored: Array<{ drawing: VectorDrawing; tier: number; score: number }> = [];
  for (const drawing of DRAWINGS) {
    // The key itself belongs to the primary language: it is the Spanish word.
    // In English locale the key still counts as primary — it is the drawing's
    // own name, and names are not translated.
    const primario = locale === "en" ? drawing.english : drawing.words;
    const respaldo = locale === "en" ? drawing.words : drawing.english;

    let puntos = 0;
    let enPrimario = true;
    for (const term of terms) {
      const tier = tierOf(term, drawing.key, primario);
      if (tier === 0) {
        enPrimario = false;
        break;
      }
      puntos += tier;
    }

    if (enPrimario) {
      scored.push({ drawing, tier: 1, score: puntos });
      continue;
    }

    let puntosRespaldo = 0;
    let enRespaldo = true;
    for (const term of terms) {
      const tier = tierOf(term, drawing.key, respaldo);
      if (tier === 0) {
        enRespaldo = false;
        break;
      }
      puntosRespaldo += tier;
    }
    if (enRespaldo) scored.push({ drawing, tier: 2, score: puntosRespaldo });
  }

  scored.sort(
    (a, b) => a.tier - b.tier || b.score - a.score || a.drawing.key.localeCompare(b.drawing.key),
  );
  return scored.map((entry) => entry.drawing);
}
