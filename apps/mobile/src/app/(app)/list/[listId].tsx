import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import type { ListItem } from '@orbit-hub/contracts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { DraggableRow } from '@/components/ui/draggable-row';
import { MediaCarousel } from '@/components/ui/media-carousel';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { useListItems, useLists } from '@/hooks/use-lists';
import { useTranslation } from '@/lib/i18n';
import { isMediaList, mediaCardOf } from '@/lib/lists/media-card';
import { useTheme } from '@/theme';

const PRIORITY_TONE = {
  none: 'neutral',
  low: 'info',
  medium: 'warning',
  high: 'danger',
} as const;

export default function ListScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { listId } = useLocalSearchParams<{ listId: string }>();

  const { lists, deleteList, duplicateList, toggleFavorite } = useLists({});
  const list = useMemo(() => lists.find((item) => item.id === listId) ?? null, [lists, listId]);
  const {
    items,
    isLoading,
    showCompleted,
    setShowCompleted,
    addItem,
    toggleCompleted,
    moveItemTo,
    removeItem,
  } = useListItems(listId);

  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  /**
   * Tasks are split into pending and completed rather than filtered, so the
   * shape of the list says what is left to do. A media list never mixes in a
   * hand written row: the carousel is the list.
   */
  const media = isMediaList(list?.kind);
  const pending = useMemo(() => items.filter((item) => !item.completed), [items]);
  const completed = useMemo(() => items.filter((item) => item.completed), [items]);

  /**
   * One flat array for the list, with the heading of the completed section as an
   * entry of its own.
   *
   * Two sections in one scroller is what a list of a few hundred rows needs and
   * a FlatList is the only thing that renders a fraction of it. The heading is a
   * row rather than a second list, because two lists in one scroll view means
   * two windows to keep in step, and the completed rows are simply the tail of
   * the same one.
   */
  const entries = useMemo<ListEntry[]>(() => {
    const rows: ListEntry[] = pending.map((item, index) => ({ kind: 'row', item, index }));
    if (completed.length > 0) {
      rows.push({ kind: 'completedHeading' });
      if (showCompleted) {
        completed.forEach((item, index) => rows.push({ kind: 'row', item, index }));
      }
    }
    return rows;
  }, [pending, completed, showCompleted]);

  /** Media lists show the carousel; anything else shows the task rows. */
  const carouselItems = useMemo(
    () =>
      media
        ? items.map((item) => {
            const card = mediaCardOf(item);
            return {
              key: item.id,
              title: item.title,
              imageUrl: card?.imageUrl ?? null,
              released: card?.released ?? null,
              badge:
                list?.kind === 'books'
                  ? t('itemDetails.book')
                  : card?.mediaKind === 'tv'
                    ? t('itemDetails.series')
                    : t('itemDetails.movie'),
              completed: item.completed,
              onPress: () => openDetails(item.externalId as string, item.title),
              onLongPress: () => void toggleCompleted(item),
            };
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, media, list?.kind, t, toggleCompleted],
  );

  function openDetails(externalId: string, itemTitle: string) {
    router.push({
      pathname: '/(app)/item/[itemId]',
      params: {
        itemId: listId,
        kind: list?.kind === 'books' ? 'books' : 'movies',
        externalId,
        title: itemTitle,
      },
    });
  }

  async function onAdd() {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;

    setAdding(true);
    try {
      await addItem({ title: trimmed });
      setTitle('');
    } finally {
      setAdding(false);
    }
  }

  if (!listId) {
    return (
      <Screen>
        <EmptyState title={t('lists.notFound')} />
      </Screen>
    );
  }

  /**
   * One row of the flat list.
   *
   * A task carries its own index inside its own section, because that is the
   * number a drag needs: the completed rows are the tail of the same array, so
   * the index in the array would be off by however many tasks are already done.
   */
  const renderEntry = ({ item: entry }: { item: ListEntry }) => {
    if (entry.kind === 'completedHeading') {
      return (
        <View style={{ paddingVertical: theme.spacing.xs }}>
          <Checkbox
            checked={showCompleted}
            onToggle={() => setShowCompleted((value) => !value)}
            label={t('lists.completedSection', { count: completed.length })}
          />
        </View>
      );
    }

    const { item, index } = entry;
    return (
      <DraggableRow
        id={item.id}
        index={index}
        total={entry.item.completed ? completed.length : pending.length}
        onReorder={(movedId, toIndex) => {
          const section = completed.some((row) => row.id === movedId) ? completed : pending;
          const from = section.findIndex((row) => row.id === movedId);
          // The drag already knows where the row landed, so the write is one
          // reorder and not a chain of single steps.
          if (from !== -1) void moveItemTo(movedId, toIndex - from);
        }}
      >
        <TaskRow
          item={item}
          onToggle={() => void toggleCompleted(item)}
          onRemove={() => void removeItem(item)}
        />
      </DraggableRow>
    );
  };

  /**
   * Everything above the rows, and the state that decides what the rows are.
   *
   * A FlatList owns the scroll, so the page cannot also be a ScrollView: two
   * vertical scrollers in one screen fight each other, and the list would have
   * to guess where it sits inside the other one. The header and the actions
   * below the rows are its header and its footer, which is the only arrangement
   * that keeps the page reading as one screen.
   */
  const header = (
    <View style={[styles.header, { gap: theme.spacing.xs }]}>
      <View style={styles.headerTop}>
        <View style={styles.flex}>
          <AppText variant="title">{list?.title ?? t('lists.notFound')}</AppText>
          <AppText variant="caption" tone="muted">
            {t(
              list?.kind === 'movies'
                ? 'lists.kindMovies'
                : list?.kind === 'books'
                  ? 'lists.kindBooks'
                  : 'lists.kindTasks',
            )}
          </AppText>
        </View>
        {list ? (
          <Button
            label={list.favorite ? t('lists.unfavorite') : t('lists.favorite')}
            variant="ghost"
            size="sm"
            icon={list.favorite ? 'bookmark' : 'bookmark-outline'}
            fullWidth={false}
            onPress={() => void toggleFavorite(list)}
          />
        ) : null}
      </View>

      {items.length > 0 ? (
        <View style={styles.badges}>
          {completed.length > 0 ? (
            <Badge
              label={t('lists.completedCount', { count: completed.length })}
              tone="success"
            />
          ) : null}
          <Badge label={t('lists.pendingCount', { count: pending.length })} />
        </View>
      ) : null}

      {isLoading ? (
        <Card variant="muted">
          <AppText variant="callout" tone="muted" align="center">
            {t('common.loading')}
          </AppText>
        </Card>
      ) : items.length === 0 ? (
        <Card padded={false}>
          <EmptyState title={t('items.empty.title')} description={t('items.empty.body')} />
        </Card>
      ) : media ? (
        /* Films and books: a carousel of covers, never mixed with plain rows. */
        <MediaCarousel items={carouselItems} />
      ) : null}

      {!media && !isLoading && items.length > 0 && pending.length === 0 ? (
        <Card variant="muted">
          <AppText variant="callout" tone="success" align="center">
            {t('lists.allDone')}
          </AppText>
        </Card>
      ) : null}
    </View>
  );

  const footer = (
    <View style={{ gap: theme.spacing.lg }}>
      {/* A media list has nothing to type: its items come from a catalog, so the
          form would only invite a title that then has no poster. */}
      {!media ? (
        <Card variant="muted" style={{ gap: theme.spacing.md }}>
          <AppText variant="callout" tone="muted">
            {t('items.createHint')}
          </AppText>
          <TextField
            label={t('items.titleLabel')}
            value={title}
            onChangeText={setTitle}
            placeholder={t('items.titlePlaceholder')}
            autoCapitalize="sentences"
            returnKeyType="done"
            onSubmitEditing={() => void onAdd()}
          />
          <Button
            label={t('items.add')}
            icon="add"
            onPress={() => void onAdd()}
            loading={adding}
            disabled={title.trim().length === 0}
          />
        </Card>
      ) : null}

      {/* The catalog needs the network, so this is the one way of adding a
          title that does not work on a plane. Type it by hand there and search
          once you land. */}
      <Button
        label={t('catalog.addFromCatalog')}
        variant={media ? 'primary' : 'secondary'}
        icon="search-outline"
        onPress={() => router.push(`/(app)/catalog?listId=${listId}`)}
      />

      {list ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={t('lists.duplicate')}
            variant="secondary"
            icon="copy-outline"
            loading={duplicating}
            onPress={() => {
              setDuplicating(true);
              void duplicateList(list)
                .then((newId) => {
                  // Straight into the copy: the point of duplicating is to work
                  // on it, not to go looking for it.
                  router.replace(`/(app)/list/${newId}`);
                })
                .finally(() => setDuplicating(false));
            }}
          />
          <Button
            label={t('lists.delete')}
            variant="danger"
            icon="trash-outline"
            onPress={() => {
              void deleteList(list);
              router.back();
            }}
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen scroll={false}>
      <FlatList
        data={entries}
        keyExtractor={entryKey}
        renderItem={renderEntry}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={[
          styles.content,
          { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl, gap: theme.spacing.sm },
        ]}
        // Rows are measured rather than assumed, and a row is not tall: a few
        // screens of rows is plenty, and rendering more of them is what makes a
        // long list feel heavy.
        initialNumToRender={14}
        windowSize={7}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={60}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

/** One row of the flat list: a task, or the heading of the completed section. */
type ListEntry =
  | { kind: 'row'; item: ListItem; index: number }
  | { kind: 'completedHeading' };

const COMPLETED_HEADING_KEY = 'completed-heading';

function entryKey(entry: ListEntry): string {
  return entry.kind === 'row' ? entry.item.id : COMPLETED_HEADING_KEY;
}

/** One task row, shared by the pending and the completed sections. */
function TaskRow({
  item,
  onToggle,
  onRemove,
}: {
  item: import('@orbit-hub/contracts').ListItem;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  return (
    <View style={[styles.item, { gap: theme.spacing.md, padding: theme.spacing.lg }]}>
      <Checkbox checked={item.completed} onToggle={onToggle} label="" />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.title}
        onPress={onRemove}
        style={styles.flex}
      >
        <AppText
          variant="body"
          tone={item.completed ? 'subtle' : 'default'}
          style={item.completed ? styles.strike : undefined}
        >
          {item.title}
        </AppText>
      </Pressable>

      {item.priority !== 'none' ? (
        <Badge label={t(`items.priority.${item.priority}`)} tone={PRIORITY_TONE[item.priority]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
  header: {},
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  badges: {
    flexDirection: 'row',
    gap: 6,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reorder: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hidden: {
    opacity: 0,
  },
  flex: {
    flex: 1,
  },
  strike: {
    textDecorationLine: 'line-through',
  },
});
