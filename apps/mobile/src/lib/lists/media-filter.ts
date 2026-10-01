import type { ListItem } from "@orbit-hub/contracts";

import { normaliseToCompare } from "@/lib/lists/done-match";

/**
 * The filter of a list of films, **and the rules that answer it**.
 *
 * This is in `lib` and not in the sheet because it is a rule and not a picture of
 * one. It was written inside `media-filters-sheet.tsx`, which is a component that
 * imports `Sheet`, and `Sheet` reaches `expo-sqlite`, and `expo-sqlite` cannot be
 * loaded by the test runner: the first test for this file failed to even start
 * with a module error, so the predicates that decide what the user sees had no
 * test at all. A rule that cannot be tested belongs somewhere it can be.
 *
 * **The sheet counts the chips with the same function the screen filters with.**
 * Two copies of a rule is how a chip says "3" and the list shows five, with
 * neither copy wrong on its own.
 */

/** What the media list is showing. */
export interface MediaFilter {
  /** `'movie' | 'tv'`, and `null` is both. Only offered when the list allows. */
  type: "movie" | "tv" | null;
  /** The decade a thing came out in, or `null` for every decade. */
  decade: number | null;
  /** Free labels, the same ones the other lists filter by. */
  tags: string[];
  /** Text over the title. */
  text: string;
  /**
   * Whether it has a picture, or `null` for both.
   *
   * This is the one axis that exists because of **how the list got its rows**. A
   * film added from the catalogue arrives with a poster, and a film typed in by
   * hand arrives without one, so "the ones I still have to look up" is a real
   * question about a list of things to watch and there is no other way to ask it:
   * the poster is on the item and the genre is not, so this is answerable offline
   * and a genre filter is not.
   */
  artwork: boolean | null;
  /**
   * When it was added: this month, this year, or before that.
   *
   * A list of films is mostly the last two years of wanting to see things, so
   * "what did I add in the last month" is a real question and the only other thing
   * on the row that is a date. It is three buckets and not a date picker, because
   * picking a day to filter a list you are looking at is a different question from
   * the one anybody asks.
   */
  added: "month" | "year" | "older" | null;
}

export const EMPTY_MEDIA_FILTER: MediaFilter = {
  type: null,
  decade: null,
  tags: [],
  text: "",
  artwork: null,
  added: null,
};

/** Only these can be filtered, because only these are on the item. */
export function mediaFilterCount(filter: MediaFilter): number {
  return (
    (filter.type ? 1 : 0) +
    (filter.decade !== null ? 1 : 0) +
    filter.tags.length +
    (filter.text.length > 0 ? 1 : 0) +
    (filter.artwork !== null ? 1 : 0) +
    (filter.added !== null ? 1 : 0)
  );
}

/**
 * The media kind of an item, as the two the app knows.
 *
 * Read off the same `metadata` the poster comes from, which stores the provider's
 * own `type`: `movie`, `tv` or `books`. A hand written item has no metadata and
 * therefore no type, and it is left out of both groups rather than guessed into
 * one — an item that was typed in is not a film or a series, and saying it is
 * would be a lie the filter is built on.
 */
export function mediaTypeOf(item: ListItem): "movie" | "tv" | null {
  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  const type = typeof metadata.type === "string" ? metadata.type : null;
  if (type === "movie") return "movie";
  if (type === "tv") return "tv";
  return null;
}

/** How wide a decade is, and the only rounding this filter does to a year. */
export const DECADE = 10;

export function yearOf(item: ListItem): number | null {
  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  const crudo =
    typeof metadata.releaseDate === "string"
      ? metadata.releaseDate
      : typeof metadata.publishedDate === "string"
        ? metadata.publishedDate
        : typeof metadata.year === "string"
          ? metadata.year
          : null;
  if (!crudo) return null;
  const n = Number.parseInt(crudo.slice(0, 4), 10);
  return Number.isNaN(n) ? null : n;
}

/** Whether the row has something to draw, which is the artwork axis. */
export function hasArtwork(item: ListItem): boolean {
  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  const url =
    typeof metadata.imageUrl === "string"
      ? metadata.imageUrl
      : typeof metadata.poster === "string"
        ? metadata.poster
        : null;
  return typeof url === "string" && url.trim().length > 0;
}

/** Which of the three "added" buckets a row falls in, from when it was added. */
export function addedBucket(item: ListItem, now: Date): MediaFilter["added"] {
  const cuando = Date.parse(item.createdAt);
  if (Number.isNaN(cuando)) return null;
  const dias = (now.getTime() - cuando) / 86_400_000;
  if (dias <= 31) return "month";
  if (dias <= 366) return "year";
  return "older";
}

/**
 * Whether a row survives the filter, **and it is the same code the sheet counts
 * with**.
 *
 * It used to live in the screen, in a `useMemo` of about thirty lines, while the
 * sheet counted the chips from its own idea of the axes. Two copies of a rule is
 * how a chip says "3" and the list shows five, and neither of them is wrong on
 * its own.
 *
 * The text is `includes` and not `compare`: a comparator says how two strings
 * *order*, not whether one contains the other, and a filter built on one filters
 * everything or nothing. Both sides go through the same normalization, so the
 * case and the accents do not decide it.
 *
 * **Every axis is its own "no" and not a choice between them**, so turning on two
 * of them narrows by both, which is what turning on two of them says.
 */
export function matchesMediaFilter(
  item: ListItem,
  filter: MediaFilter,
  now: Date = new Date(),
): boolean {
  if (filter.text.length > 0) {
    const aguja = normaliseToCompare(filter.text);
    if (!normaliseToCompare(item.title).includes(aguja)) return false;
  }
  if (filter.decade !== null) {
    const anio = yearOf(item);
    if (anio === null || Math.floor(anio / DECADE) * DECADE !== filter.decade) return false;
  }
  if (filter.type !== null && mediaTypeOf(item) !== filter.type) return false;
  if (filter.artwork !== null && hasArtwork(item) !== filter.artwork) return false;
  if (filter.added !== null && addedBucket(item, now) !== filter.added) return false;
  if (filter.tags.length > 0 && !filter.tags.every((tag) => item.tags.includes(tag))) {
    return false;
  }
  return true;
}
