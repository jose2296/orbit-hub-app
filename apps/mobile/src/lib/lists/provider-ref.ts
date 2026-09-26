import type { ListItem } from '@orbit-hub/contracts';

/**
 * Which provider a title came from, and which id it has there.
 *
 * The detail screen asks a provider for a record. Which provider, and with what
 * id, has to come from the item and not from the list it happens to be in: a
 * list of films and series holds both, a list of tasks is also where a book
 * somebody typed by hand ends up, and asking the film provider for the id of a
 * book is a request that comes back with nothing and a screen that says so.
 *
 * So it is decided here, from the item alone, and it can also say "this row has
 * no provider record at all", which is the case the detail screen has to handle
 * without pretending something went wrong.
 */

export type MediaProvider = 'tmdb' | 'google-books';

/** The three kinds of record a catalog holds. */
export type MediaKind = 'movies' | 'tv' | 'books';

export interface ProviderRef {
  provider: MediaProvider;
  kind: MediaKind;
  externalId: string;
}

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const readMetadata = (item: ListItem | null): Record<string, unknown> => {
  const raw = item?.metadata;
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
};

/**
 * The provider record of a row, or `null` when it has none.
 *
 * A row written by hand has no id, and saying so is not a failure: the detail
 * screen shows what the row itself knows and offers to look the title up.
 */
export function providerRefOf(item: ListItem | null): ProviderRef | null {
  const externalId = readString(item?.externalId);
  if (!item || !externalId) return null;

  // The id of a film or a series carries its own type, which is the record's
  // own claim about what it is and not a guess from the list.
  if (externalId.startsWith('tv:')) {
    return { provider: 'tmdb', kind: 'tv', externalId };
  }
  if (externalId.startsWith('movie:')) {
    return { provider: 'tmdb', kind: 'movies', externalId };
  }

  const metadata = readMetadata(item);
  const declared = readString(metadata['type']);
  const provider = readString(metadata['provider']);

  if (declared === 'book' || provider === 'google-books') {
    return { provider: 'google-books', kind: 'books', externalId };
  }
  if (declared === 'tv' || declared === 'series') {
    return { provider: 'tmdb', kind: 'tv', externalId };
  }
  if (declared === 'movie' || declared === 'film') {
    return { provider: 'tmdb', kind: 'movies', externalId };
  }

  // A bare id with nothing to say what it is: the list is the last thing to
  // listen to, and only when there is nothing better. A bare id from Google
  // Books is a twelve character volume id and a bare id from TMDB never happens,
  // so the length is what tells them apart.
  return externalId.length >= 10
    ? { provider: 'google-books', kind: 'books', externalId }
    : { provider: 'tmdb', kind: 'movies', externalId };
}

/**
 * Whether a title is one a catalog knows about.
 *
 * A hand written row in a list of films is still a film as far as the person is
 * concerned, and the detail of it is worth showing with a poster when there is
 * one. The absence of a provider record is a fact about the record, not about
 * what the row is.
 */
export function looksLikeMedia(item: ListItem | null, listKind: string | undefined): boolean {
  if (providerRefOf(item)) return true;
  return listKind === 'movies' || listKind === 'series' || listKind === 'books' || listKind === 'movies_and_series';
}
