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
import { useTranslation } from '@/lib/i18n';
import { routeForList } from '@/lib/lists/route';
import { useTheme } from '@/theme';
import type { SearchResult } from '@orbit-hub/contracts';

const SCOPE_ICON: Record<SearchResult['scope'], keyof typeof Ionicons.glyphMap> = {
  workspace: 'albums-outline',
  folder: 'folder-outline',
  list: 'list-outline',
  list_item: 'document-text-outline',
  note: 'document-text-outline',
};

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

  function open(result: SearchResult) {
    if (result.scope === 'workspace') {
      router.push(`/(app)/workspace/${result.id}`);
      return;
    }
    if (result.scope === 'list' || result.scope === 'list_item') {
      // The hit carries the kind of the list it lives in, so a board opens as a
      // board. It is null only for a row whose list is not in the local cache — the
      // search read the row and not its parent — and `tasks` is the screen that
      // link opened before, which is where a board hit lands until the task
      // screen sends it on.
      router.push(
        routeForList({ id: result.listId ?? result.id, kind: result.kind ?? 'tasks' }),
      );
      return;
    }
    if (result.scope === 'note') {
      // Straight to the note. A hit you cannot open is a search that found
      // something it will not show you.
      router.push(`/(app)/note/${result.id}`);
      return;
    }
    if (result.workspaceId) {
      router.push(`/(app)/workspace/${result.workspaceId}`);
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
