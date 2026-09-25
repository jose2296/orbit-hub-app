import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { CatalogResultRow } from '@/components/catalog/catalog-result-row';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { TextField } from '@/components/ui/text-field';
import { AppText } from '@/components/ui/text';
import { CATALOG_MIN_QUERY, useCatalogSearch } from '@/hooks/use-catalog-search';
import { useListItems, useLists } from '@/hooks/use-lists';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

import type { CatalogKind } from '@orbit-hub/contracts';

/**
 * Search an external catalog and add what you find to a list.
 *
 * This is the only part of building a list that needs the network: the provider
 * keys live on the server, so a list built on a plane gets its titles typed in
 * and the catalog fills in once there is a connection. Items still go through
 * the same local first outbox as a hand written one.
 */
export default function CatalogSearchScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { listId } = useLocalSearchParams<{ listId: string }>();

  const { lists } = useLists({});
  const list = useMemo(() => lists.find((item) => item.id === listId) ?? null, [lists, listId]);
  const { addItem } = useListItems(listId);
  const { results, isSearching, isAvailable, error, search, clear } = useCatalogSearch();

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<CatalogKind>('movies');
  const [addingId, setAddingId] = useState<string | null>(null);

  // A films or books list suggests its own catalog, which is the one the user
  // almost always wants.
  useEffect(() => {
    if (list?.kind === 'books') setKind('books');
    else if (list?.kind === 'movies') setKind('movies');
  }, [list?.kind]);

  useEffect(() => {
    if (query.trim().length < CATALOG_MIN_QUERY) {
      clear();
      return;
    }
    const timer = setTimeout(() => {
      void search(kind, query);
    }, 350);
    return () => clearTimeout(timer);
  }, [clear, kind, query, search]);

  async function onAdd(externalId: string) {
    const hit = results.find((item) => item.externalId === externalId);
    if (!hit) return;

    setAddingId(externalId);
    try {
      await addItem({
        title: hit.title,
        externalId: hit.externalId,
        // The provider record travels with the item: poster, year, authors.
        metadata: { ...hit.metadata, provider: hit.provider, imageUrl: hit.imageUrl },
      });
      setQuery('');
      clear();
      // Back to the list. router.back() is wrong here: this screen can be opened
      // directly from a deep link, and then there is nothing to go back to.
      if (router.canGoBack()) router.back();
      else router.replace(`/(app)/list/${listId}`);
    } finally {
      setAddingId(null);
    }
  }

  const kinds: { value: CatalogKind; label: string }[] = [
    { value: 'movies', label: t('catalog.kindMovies') },
    { value: 'tv', label: t('catalog.kindTv') },
    { value: 'books', label: t('catalog.kindBooks') },
  ];

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="title">{t('catalog.title')}</AppText>
        <AppText variant="callout" tone="muted">
          {list ? t('catalog.subtitle', { list: list.title }) : t('catalog.subtitleNoList')}
        </AppText>
      </View>

      <Card variant="muted" style={{ gap: theme.spacing.md }}>
        <TextField
          label={t('catalog.searchLabel')}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          placeholder={t('catalog.searchPlaceholder')}
        />
        <Segmented options={kinds} value={kind} onChange={setKind} />
      </Card>

      {!isAvailable ? (
        <Card variant="outlined" style={{ gap: theme.spacing.xs }}>
          <AppText variant="bodyStrong">{t('catalog.unavailableTitle')}</AppText>
          <AppText variant="caption" tone="muted">
            {t('catalog.unavailableBody')}
          </AppText>
        </Card>
      ) : null}

      {error ? (
        <AppText variant="caption" tone="danger" align="center">
          {error}
        </AppText>
      ) : null}

      {isSearching ? (
        <AppText variant="caption" tone="subtle" align="center">
          {t('catalog.searching')}
        </AppText>
      ) : null}

      {results.length > 0 ? (
        <Card padded={false} style={{ paddingHorizontal: theme.spacing.md }}>
          {results.map((hit, index) => (
            <View key={hit.externalId}>
              {index > 0 ? <Divider /> : null}
              <CatalogResultRow
                result={hit}
                disabled={addingId !== null}
                onPress={(selected) => void onAdd(selected.externalId)}
              />
            </View>
          ))}
        </Card>
      ) : null}

      {query.trim().length >= CATALOG_MIN_QUERY && !isSearching && results.length === 0 && !error ? (
        <EmptyState icon="search-outline" title={t('catalog.emptyTitle')} />
      ) : null}

      {query.trim().length < CATALOG_MIN_QUERY ? (
        <Button
          label={t('catalog.back')}
          variant="ghost"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else if (listId) router.replace(`/(app)/list/${listId}`);
            else router.replace('/(app)/(tabs)');
          }}
        />
      ) : null}
    </Screen>
  );
}
