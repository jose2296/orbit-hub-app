import { EMOJI_ALIASES } from "./emoji-aliases";
import { EMOJI_CATALOG } from "./emoji-catalog.generated";
import type { EmojiEntry } from "./emoji-catalog.generated";

/**
 * Without accents and in lower case.
 *
 * The keywords are written without them and the person types with them, and a
 * search that finds only one of the two spellings is broken for every Spanish
 * keyboard with the accent key.
 */
export function normaliseQuery(query: string): string {
  return query.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export interface SearchEmojisOptions {
  group?: string;
  limit?: number;
}

/**
 * The emojis for what was typed, in catalogue order.
 *
 * Every word has to match: "pan" finds bread and not everything with a "pa" in
 * it. Each word matches the name or any keyword, through the alias table when
 * the word is Spanish — without it this is an English search inside a Spanish
 * app, and that is a failure even when no demo shows it.
 */
export function searchEmojis(query: string, opts: SearchEmojisOptions = {}): EmojiEntry[] {
  const { group, limit } = opts;
  const pool = group ? EMOJI_CATALOG.filter((entry) => entry.group === group) : EMOJI_CATALOG;

  const terms = normaliseQuery(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return limit ? pool.slice(0, limit) : [...pool];

  const matched = pool.filter((entry) => {
    const haystack = normaliseQuery(`${entry.name} ${entry.keywords.join(" ")}`);
    return terms.every((term) => {
      const alias = EMOJI_ALIASES[term];
      return haystack.includes(term) || (alias !== undefined && haystack.includes(normaliseQuery(alias)));
    });
  });

  return limit ? matched.slice(0, limit) : matched;
}
