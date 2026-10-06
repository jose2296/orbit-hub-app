import {
  VECTOR_ICON_CATALOG,
  labelOf,
  type VectorIconCategory,
} from "@orbit-hub/contracts";

/**
 * Without accents and in lower case.
 *
 * The keys are written without them and the person types with them: a search
 * that only finds one of the two spellings is broken for every Spanish
 * keyboard with the accent key.
 */
function normalise(word: string): string {
  return word.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export interface SearchVectorsOptions {
  category?: VectorIconCategory | null;
  limit?: number;
}

/**
 * The catalogue keys for what was typed, best match first.
 *
 * The same rules the old row-icon search had, because they are the rules of
 * typing half-remembered words: "pasti" finds "pastilla". An exact key wins
 * over a word that only starts like it, and a word that only starts like it
 * wins over a word that merely contains it. Nothing typed is everything; a word
 * nobody has is an empty grid with a line in it, and not the whole wall.
 */
export function searchVectors(query: string, opts: SearchVectorsOptions = {}): string[] {
  const { category = null, limit } = opts;
  const pool = category
    ? VECTOR_ICON_CATALOG.filter((entry) => entry.category === category)
    : VECTOR_ICON_CATALOG;

  const terms = normalise(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    const all = pool.map((entry) => entry.key);
    return limit ? all.slice(0, limit) : all;
  }

  const scored: Array<{ key: string; score: number }> = [];
  for (const entry of pool) {
    const words = normalise(`${entry.key.replace(/_/g, " ")} ${labelOf(entry.key)}`).split(/\s+/);
    let score = 0;
    let matches = true;

    for (const term of terms) {
      if (entry.key === term) {
        score += 3;
        continue;
      }
      if (words.some((word) => word.startsWith(term))) {
        score += 2;
        continue;
      }
      if (words.some((word) => word.includes(term))) {
        score += 1;
        continue;
      }
      matches = false;
      break;
    }

    if (matches) scored.push({ key: entry.key, score });
  }

  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const keys = scored.map((entry) => entry.key);
  return limit ? keys.slice(0, limit) : keys;
}
