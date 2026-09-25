import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { List, ListKind } from '@orbit-hub/contracts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { useFolders, useWorkspaces } from '@/hooks/use-workspaces';
import { useLists } from '@/hooks/use-lists';
import { pluralKey, useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

const KIND_ORDER: ListKind[] = ['tasks', 'movies', 'books'];

const KIND_ICON: Record<ListKind, keyof typeof Ionicons.glyphMap> = {
  tasks: 'checkbox-outline',
  movies: 'film-outline',
  books: 'book-outline',
};

interface FolderNode {
  id: string;
  name: string;
  emoji: string | null;
  parentId: string | null;
  depth: number;
}

/**
 * Builds the tree on screen from a flat list. Children are indented under their
 * parent, and anything whose parent is missing is treated as a root, so a
 * partially synced tree still renders instead of losing rows.
 */
function buildTree(
  folders: { id: string; name: string; emoji: string | null; parentId: string | null }[],
): FolderNode[] {
  const byParent = new Map<string | null, typeof folders>();
  for (const folder of folders) {
    const list = byParent.get(folder.parentId) ?? [];
    list.push(folder);
    byParent.set(folder.parentId, list);
  }

  const nodes: FolderNode[] = [];
  const walk = (parentId: string | null, depth: number, seen: Set<string>) => {
    if (depth > 8) return; // Guard against a cycle the server should have rejected.

    for (const folder of byParent.get(parentId) ?? []) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      nodes.push({ ...folder, depth });
      walk(folder.id, depth + 1, seen);
    }
  };

  walk(null, 0, new Set());
  for (const folder of folders) {
    if (!nodes.some((node) => node.id === folder.id)) {
      nodes.push({ ...folder, depth: 0 });
    }
  }

  return nodes;
}

export default function WorkspaceScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>();

  const { workspaces, deleteWorkspace } = useWorkspaces();
  const { folders, isLoading, createFolder } = useFolders(workspaceId);
  const { lists, createList } = useLists({ workspaceId });

  const [folderName, setFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newListTitle, setNewListTitle] = useState('');
  const [newKind, setNewKind] = useState<ListKind>('tasks');
  const [creatingList, setCreatingList] = useState(false);

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );
  const tree = useMemo(() => buildTree(folders), [folders]);

  /**
   * The lists grouped by folder, in the order the folders appear, with the ones
   * that have no folder last. Sorting by name inside a group keeps the tree
   * stable while a title is being typed elsewhere.
   */
  const listGroups = useMemo(() => {
    const nameById = new Map(folders.map((folder) => [folder.id, folder.name]));
    const groups = new Map<string, { id: string; folderName: string | null; lists: List[] }>();

    for (const list of lists) {
      const folderName = list.folderId ? (nameById.get(list.folderId) ?? null) : null;
      const id = list.folderId ?? 'sin-carpeta';
      const group = groups.get(id) ?? { id, folderName, lists: [] };
      group.lists.push(list);
      groups.set(id, group);
    }

    const order = [...tree.map((folder) => folder.id), 'sin-carpeta'];
    return [...groups.values()].sort(
      (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
    );
  }, [lists, folders, tree]);

  async function onCreateList() {
    const trimmed = newListTitle.trim();
    if (trimmed.length === 0 || !workspaceId) return;

    setCreatingList(true);
    try {
      const id = await createList({ workspaceId, title: trimmed, kind: newKind });
      setNewListTitle('');
      router.push(`/(app)/list/${id}`);
    } finally {
      setCreatingList(false);
    }
  }

  async function onCreateFolder() {
    const trimmed = folderName.trim();
    if (trimmed.length === 0) return;

    setCreating(true);
    try {
      await createFolder({ name: trimmed });
      setFolderName('');
    } finally {
      setCreating(false);
    }
  }

  if (!workspaceId) {
    return (
      <Screen>
        <EmptyState title={t('workspaces.notFound')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="title">{workspace?.name ?? t('workspaces.title')}</AppText>
        {workspace ? (
          <View style={[styles.meta, { gap: theme.spacing.sm }]}>
            <Badge label={t(`workspaces.role.${workspace.role}`)} tone="accent" />
            <AppText variant="caption" tone="muted">
              {t(pluralKey('workspaces.members', workspace.memberCount), { count: workspace.memberCount })}
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={{ gap: theme.spacing.md }}>
        <View>
          <AppText variant="heading">{t('folders.title')}</AppText>
          <AppText variant="caption" tone="muted">
            {t(pluralKey('folders.count', folders.length), { count: folders.length })}
          </AppText>
        </View>

        {isLoading ? (
          <Card variant="muted">
            <AppText variant="callout" tone="muted" align="center">
              {t('common.loading')}
            </AppText>
          </Card>
        ) : tree.length === 0 ? (
          <Card padded={false}>
            <EmptyState title={t('folders.empty.title')} description={t('folders.empty.body')} />
          </Card>
        ) : (
          <Card padded={false}>
            {tree.map((folder, index) => (
              <View key={folder.id}>
                {index > 0 ? <Divider inset={16} /> : null}
                <View
                  style={[
                    styles.row,
                    {
                      gap: theme.spacing.md,
                      paddingVertical: theme.spacing.md,
                      paddingHorizontal: theme.spacing.lg + folder.depth * 16,
                    },
                  ]}
                >
                  <AppText variant="body">{folder.emoji ?? (folder.depth > 0 ? '└─' : '📁')}</AppText>
                  <AppText variant="body" style={styles.flex}>
                    {folder.name}
                  </AppText>
                </View>
              </View>
            ))}
          </Card>
        )}
      </View>

      {/*
        The lists of the space, under the folder they are in. A space whose
        lists live on another screen is a space you cannot see, and the whole
        point of a space is what is inside it.
      */}
      <View style={{ gap: theme.spacing.md }}>
        <View>
          <AppText variant="heading">{t('lists.title')}</AppText>
          <AppText variant="caption" tone="muted">
            {t(pluralKey('lists.itemCount', lists.length), { count: lists.length })}
          </AppText>
        </View>

        {lists.length === 0 ? (
          <Card padded={false}>
            <EmptyState title={t('lists.empty.title')} description={t('lists.empty.body')} />
          </Card>
        ) : (
          listGroups.map((group) => (
            <View key={group.id} style={{ gap: theme.spacing.xs }}>
              <View style={[styles.meta, { gap: theme.spacing.xs }]}>
                <Ionicons name="folder-outline" size={13} color={theme.colors.textMuted} />
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                  {/* Without this the lists that belong to no folder read as if
                      they were under the folder above them. */}
                  {group.folderName ?? t('lists.noFolder')}
                </AppText>
              </View>
              <Card padded={false}>
                {group.lists.map((list, index) => (
                  <View key={list.id}>
                    {index > 0 ? <Divider inset={16} /> : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={list.title}
                      onPress={() => router.push(`/(app)/list/${list.id}`)}
                      style={({ pressed }) => [
                        styles.row,
                        {
                          gap: theme.spacing.md,
                          paddingVertical: theme.spacing.md,
                          paddingHorizontal: theme.spacing.lg,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <Ionicons
                        name={KIND_ICON[list.kind]}
                        size={18}
                        color={theme.colors.textMuted}
                      />
                      <View style={styles.flex}>
                        <AppText variant="body" numberOfLines={1}>
                          {list.title}
                        </AppText>
                        <AppText variant="caption" tone="subtle">
                          {t(pluralKey('lists.itemCount', list.itemCount), { count: list.itemCount })}
                        </AppText>
                      </View>
                      {list.favorite ? (
                        <Ionicons name="bookmark" size={14} color={theme.colors.accent} />
                      ) : null}
                      <Ionicons name="chevron-forward" size={14} color={theme.colors.textSubtle} />
                    </Pressable>
                  </View>
                ))}
              </Card>
            </View>
          ))
        )}
      </View>

      <Card variant="muted" style={{ gap: theme.spacing.md }}>
        <AppText variant="callout" tone="muted">
          {t('lists.createHint')}
        </AppText>
        <Segmented
          value={newKind}
          onChange={setNewKind}
          options={KIND_ORDER.map((kind) => ({ value: kind, label: t(`lists.kind.${kind}`) }))}
        />
        <TextField
          label={t('lists.titleLabel')}
          value={newListTitle}
          onChangeText={setNewListTitle}
          placeholder={t('lists.titlePlaceholder')}
          autoCapitalize="sentences"
          returnKeyType="done"
          onSubmitEditing={() => void onCreateList()}
        />
        <Button
          label={t('lists.create')}
          icon="add"
          onPress={() => void onCreateList()}
          loading={creatingList}
          disabled={newListTitle.trim().length === 0}
        />
      </Card>

      <Card variant="muted" style={{ gap: theme.spacing.md }}>
        <AppText variant="callout" tone="muted">
          {t('folders.createHint')}
        </AppText>
        <TextField
          label={t('folders.nameLabel')}
          value={folderName}
          onChangeText={setFolderName}
          placeholder={t('folders.namePlaceholder')}
          autoCapitalize="sentences"
          returnKeyType="done"
          onSubmitEditing={() => {
            void onCreateFolder();
          }}
        />
        <Button
          label={t('folders.create')}
          icon="add"
          onPress={() => void onCreateFolder()}
          loading={creating}
          disabled={folderName.trim().length === 0}
        />
      </Card>

      {workspace ? (
        <Card variant="outlined" style={{ gap: theme.spacing.md }}>
          <AppText variant="callout" tone="muted">
            {t('workspaces.dangerZone')}
          </AppText>
          <Button
            label={t('workspaces.delete')}
            variant="danger"
            icon="trash-outline"
            onPress={() => {
              void deleteWorkspace(workspace);
              router.replace('/(app)/workspaces');
            }}
          />
        </Card>
      ) : null}
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
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
