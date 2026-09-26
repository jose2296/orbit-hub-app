import type { ListItem } from '@orbit-hub/contracts';

/**
 * What a list item knows about its provider.
 *
 * A poster, a cover and a year are all stored in the same `metadata` blob, so
 * this is the one place that knows how to read them back. Everything that
 * renders a media card goes through here, and a hand written item simply has
 * nothing to show, which is why these lists fall back to a text row.
 */

export interface MediaCard {
  /** Poster for a film, cover for a book. */
  imageUrl: string | null;
  /** Year or publication year, as the provider spelled it. */
  released: string | null;
  /** 'tmdb' or 'google-books'. */
  provider: string | null;
  /** 'movie', 'tv' or 'books'. */
  mediaKind: string | null;
}

/** Reads the provider record off an item, or reports that there is none. */
export function mediaCardOf(item: ListItem): MediaCard | null {
  if (!item.externalId) return null;

  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  const imageUrl = typeof metadata.imageUrl === 'string' ? metadata.imageUrl : null;
  const year = typeof metadata.year === 'string' ? metadata.year : null;
  const released =
    typeof metadata.releaseDate === 'string'
      ? metadata.releaseDate.slice(0, 4)
      : typeof metadata.publishedDate === 'string'
        ? metadata.publishedDate.slice(0, 4)
        : year;

  // A media item with no image at all is not worth a card: the card is the
  // picture. The caller falls back to a text row.
  if (!imageUrl) return null;

  return {
    imageUrl,
    released,
    provider: typeof metadata.provider === 'string' ? metadata.provider : null,
    mediaKind: typeof metadata.type === 'string' ? metadata.type : null,
  };
}

/**
 * Whether a list shows its items as media cards.
 *
 * A tasks list never does: a poster next to "buy milk" helps nobody, which is
 * exactly the mixing the design is trying to avoid.
 */
export function isMediaList(kind: string | null | undefined): boolean {
  return kind === 'movies' || kind === 'series' || kind === 'movies_and_series' || kind === 'books';
}
