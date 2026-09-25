import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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

  return (
    <Screen>
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
      </View>

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
      ) : (
        <>
          {pending.length === 0 ? (
            <Card variant="muted">
              <AppText variant="callout" tone="success" align="center">
                {t('lists.allDone')}
              </AppText>
            </Card>
          ) : (
            <View style={{ gap: theme.spacing.sm }}>
              {pending.map((item, index) => (
                <DraggableRow
                  key={item.id}
                  id={item.id}
                  index={index}
                  total={pending.length}
                  onReorder={(movedId, toIndex) => {
                    const from = pending.findIndex((row) => row.id === movedId);
                    // The drag already knows where the row landed, so the write
                    // is one reorder and not a chain of single steps.
                    if (from !== -1) void moveItemTo(movedId, toIndex - from);
                  }}
                >
                  <TaskRow
                    item={item}
                    onToggle={() => void toggleCompleted(item)}
                    onRemove={() => void removeItem(item)}
                  />
                </DraggableRow>
              ))}
            </View>
          )}

          {/*
            Completed tasks live in their own section, off the way, with a
            counter. Long lists are mostly history and this keeps the pending
            ones readable.
          */}
          {completed.length > 0 ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Checkbox
                checked={showCompleted}
                onToggle={() => setShowCompleted((value) => !value)}
                label={t('lists.completedSection', { count: completed.length })}
              />
              {showCompleted ? (
                <View style={{ gap: theme.spacing.sm }}>
                  {completed.map((item, index) => (
                    <DraggableRow
                      key={item.id}
                      id={item.id}
                      index={index}
                      total={completed.length}
                      onReorder={(movedId, toIndex) => {
                        const from = completed.findIndex((row) => row.id === movedId);
                        if (from !== -1) void moveItemTo(movedId, toIndex - from);
                      }}
                    >
                      <TaskRow
                        item={item}
                        onToggle={() => void toggleCompleted(item)}
                        onRemove={() => void removeItem(item)}
                      />
                    </DraggableRow>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      )}

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
    </Screen>
  );
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
