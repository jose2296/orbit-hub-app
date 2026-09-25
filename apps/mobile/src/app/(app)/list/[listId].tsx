import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Divider } from '@/components/ui/divider';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { useListItems, useLists } from '@/hooks/use-lists';
import { useTranslation } from '@/lib/i18n';
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

  const { lists, deleteList, toggleFavorite } = useLists({});
  const list = useMemo(() => lists.find((item) => item.id === listId) ?? null, [lists, listId]);
  const { items, isLoading, showCompleted, setShowCompleted, addItem, toggleCompleted, removeItem } =
    useListItems(listId);

  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);

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

  const pending = items.filter((item) => !item.completed).length;

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="title">{list?.title ?? t('lists.title')}</AppText>
        {list ? (
          <View style={[styles.meta, { gap: theme.spacing.sm }]}>
            <Badge label={t(`lists.kind.${list.kind}`)} tone="accent" />
            <AppText variant="caption" tone="muted">
              {t('lists.pendingCount', { count: pending })}
            </AppText>
          </View>
        ) : null}
      </View>

      {list ? (
        <View style={[styles.actions, { gap: theme.spacing.sm }]}>
          <Button
            label={list.favorite ? t('lists.unfavorite') : t('lists.favorite')}
            variant="ghost"
            size="sm"
            icon={list.favorite ? 'bookmark' : 'bookmark-outline'}
            fullWidth={false}
            onPress={() => void toggleFavorite(list)}
          />
        </View>
      ) : null}

      <Card variant="muted">
        <Checkbox
          checked={showCompleted}
          onToggle={() => setShowCompleted((value) => !value)}
          label={t('lists.showCompleted')}
        />
      </Card>

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
      ) : (
        <Card padded={false}>
          {items.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <Divider inset={16} /> : null}
              <View style={[styles.item, { gap: theme.spacing.md, padding: theme.spacing.lg }]}>
                <Checkbox
                  checked={item.completed}
                  onToggle={() => void toggleCompleted(item)}
                  label=""
                />

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.title}
                  onPress={() => void removeItem(item)}
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

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('items.remove')}
                  hitSlop={8}
                  onPress={() => void removeItem(item)}
                >
                  <Ionicons name="close" size={16} color={theme.colors.textSubtle} />
                </Pressable>
              </View>
            </View>
          ))}
        </Card>
      )}

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
        {/* The catalogs need the network, so this is the one way of adding a
            title that does not work on a plane. Type it by hand there and
            search once you land. */}
        <Button
          label={t('catalog.addFromCatalog')}
          variant="secondary"
          icon="search-outline"
          onPress={() => router.push(`/(app)/catalog?listId=${listId}`)}
        />
      </Card>

      {list ? (
        <Button
          label={t('lists.delete')}
          variant="danger"
          icon="trash-outline"
          onPress={() => {
            void deleteList(list);
            router.back();
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
  },
  strike: {
    textDecorationLine: 'line-through',
  },
});
