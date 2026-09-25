import { useCallback, useState } from 'react';

import type { CatalogKind, CatalogResult } from '@orbit-hub/contracts';

import { api, toApiError } from '@/lib/api';

/**
 * Catalog search from the app.
 *
 * The providers are behind the API, so this holds no key: that is the whole
 * reason the search goes through OrbitHub instead of straight to the provider.
 * A catalog needs the network, so this hook is the one part of list building
 * that is not local first, and it says so through `isAvailable`.
 */

const DEBOUNCE_MS = 350;
const MIN_QUERY = 2;

export interface CatalogSearch {
  results: CatalogResult[];
  isSearching: boolean;
  /** False when the server has no provider key, which is not a failure. */
  isAvailable: boolean;
  error: string | null;
  search: (kind: CatalogKind, query: string) => Promise<void>;
  clear: () => void;
}

export function useCatalogSearch(): CatalogSearch {
  const [results, setResults] = useState<CatalogResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isAvailable, setIsAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clear = useCallback(() => {
    setResults([]);
    setError(null);
    setIsSearching(false);
  }, []);

  const search = useCallback(async (kind: CatalogKind, rawQuery: string) => {
    const query = rawQuery.trim();
    if (query.length < MIN_QUERY) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    setError(null);
    try {
      const response = await api.get<{ items: CatalogResult[]; configured: boolean }>(
        `/catalog/search?kind=${kind}&q=${encodeURIComponent(query)}`,
      );
      setIsAvailable(response.configured);
      setResults(response.items);
    } catch (caught) {
      const apiError = toApiError(caught);
      setError(apiError.message);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  return { results, isSearching, isAvailable, error, search, clear };
}

export const CATALOG_DEBOUNCE_MS = DEBOUNCE_MS;
export const CATALOG_MIN_QUERY = MIN_QUERY;
