import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { useListItems, useLocalSearch } from '@/hooks/use-lists';
import type { BookmarkSearchResult } from '@/hooks/use-lists';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';
import type { SearchResult } from '@orbit-hub/contracts';

const SCOPE_ICON: Record<SearchResult['scope'] | 'bookmark', keyof typeof Ionicons.glyphMap> = {
  workspace: 'albums-outline',
  folder: 'folder-outline',
  list: 'list-outline',
  list_item: 'document-text-outline',
  note: 'document-text-outline',
  // El mismo icono que la lista y el drawer de bookmarks: el grupo se
  // reconoce sin aprender un dibujo nuevo.
  bookmark: 'bookmark-outline',
};

/**
 * A donde lleva un resultado, o nulo si no lleva a ningun lado.
 *
 * Separada para probarse sin montar: el bookmark trae `workspaceId` y sin su
 * rama propia el fallback lo mandaria al espacio, no al lector.
 */
export function rutaResultado(result: SearchResult | BookmarkSearchResult): string | null {
  if (result.scope === 'bookmark') {
    return `/(app)/bookmark/${result.id}`;
  }
  if (result.scope === 'workspace') {
    return `/(app)/workspace/${result.id}`;
  }
  if (result.scope === 'list' || result.scope === 'list_item') {
    return `/(app)/list/${result.listId ?? result.id}`;
  }
  if (result.scope === 'note') {
    // Directo a la nota. Un hit que no se puede abrir es una busqueda que
    // encuentra algo que no va a ensenar.
    return `/(app)/note/${result.id}`;
  }
  if (result.workspaceId) {
    return `/(app)/workspace/${result.workspaceId}`;
  }
  return null;
}

/**
 * Search runs against the local cache, so it answers with no connection. The
 * server search covers the online case and returns the same shape.
 */
export default function SearchScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { results, grouped, search, isSearching } = useLocalSearch();
  // Sin lista: la casilla solo necesita el id y si esta hecho, y la
  // busqueda se repite despues para que el resultado se entere.
  const { toggleCompleted } = useListItems(undefined);

  const [query, setQuery] = useState('');

  function onChange(value: string) {
    setQuery(value);
    void search(value);
  }

  function open(result: SearchResult | BookmarkSearchResult) {
    const ruta = rutaResultado(result);
    if (ruta) {
      router.push(ruta);
    }
  }

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        {/* No header of its own: the title and the menu button come from the
            header the layout above owns, which is the same one every other
            screen uses. */}
        <TextField
          value={query}
          onChangeText={onChange}
          placeholder={t('search.placeholder')}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        <AppText variant="caption" tone="subtle">
          {t('search.offlineNote')}
        </AppText>
      </View>

      {query.trim().length < 2 ? (
        <Card padded={false}>
          <EmptyState icon="search-outline" title={t('search.empty.title')} description={t('search.empty.body')} />
        </Card>
      ) : isSearching ? (
        <Card variant="muted">
          <AppText variant="callout" tone="muted" align="center">
            {t('common.loading')}
          </AppText>
        </Card>
      ) : results.length === 0 ? (
        <Card padded={false}>
          <EmptyState title={t('search.noResults.title')} description={t('search.noResults.body')} />
        </Card>
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          {(
            [
              ['workspaces', t('search.group.workspaces')],
              ['lists', t('search.group.lists')],
              ['items', t('search.group.items')],
              ['notes', t('search.group.notes')],
              // El grupo que faltaba: sin el, un query que solo casa en
              // bookmarks pintaba grupos vacios sin `EmptyState`. La etiqueta
              // es la misma que la lista y el drawer, sin copy nuevo.
              ['bookmarks', t('bookmarks.title')],
            ] as const
          ).map(([group, label]) => {
            const hits = grouped[group];
            if (hits.length === 0) return null;

            return (
              <View key={group} style={{ gap: theme.spacing.sm }}>
                <AppText variant="heading">{label}</AppText>
                <Card padded={false}>
                  {hits.map((result, index) => (
                    <View key={`${result.scope}-${result.id}`}>
                      {index > 0 ? <View style={styles.separator} /> : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={result.title}
                        onPress={() => open(result)}
                        style={({ pressed }) => [
                          styles.row,
                          {
                            gap: theme.spacing.md,
                            padding: theme.spacing.lg,
                            opacity: pressed ? 0.8 : 1,
                          },
                        ]}
                      >
                        <Ionicons
                          name={SCOPE_ICON[result.scope]}
                          size={18}
                          color={theme.colors.accentSoftText}
                        />
                        <View style={styles.flex}>
                          <AppText
                            variant="body"
                            tone={result.completed ? 'subtle' : 'default'}
                            style={result.completed ? styles.strike : undefined}
                          >
                            {result.title}
                          </AppText>
                          {result.subtitle ? (
                            <AppText variant="caption" tone="muted">
                              {result.subtitle}
                            </AppText>
                          ) : null}
                        </View>
                        {result.scope === 'list_item' && result.completed !== null ? (
                          <Checkbox
                            testID={`search-done-${result.id}`}
                            checked={result.completed}
                            label=""
                            onToggle={() => {
                              // La búsqueda se repite porque el resultado vive
                              // en memoria: sin esto la casilla se quedaría como
                              // estaba y la fila con ella.
                              void toggleCompleted({
                                id: result.id,
                                completed: result.completed ?? false,
                              }).then(() => void search(query));
                            }}
                          />
                        ) : null}
                      </Pressable>
                    </View>
                  ))}
                </Card>
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({

  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
  },
  strike: {
    textDecorationLine: 'line-through',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    backgroundColor: 'transparent',
  },
});
