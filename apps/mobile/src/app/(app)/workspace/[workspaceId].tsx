import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { useFolders, useWorkspaces } from '@/hooks/use-workspaces';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

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

  const [folderName, setFolderName] = useState('');
  const [creating, setCreating] = useState(false);

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );
  const tree = useMemo(() => buildTree(folders), [folders]);

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
              {t('workspaces.members', { count: workspace.memberCount })}
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={{ gap: theme.spacing.md }}>
        <View>
          <AppText variant="heading">{t('folders.title')}</AppText>
          <AppText variant="caption" tone="muted">
            {t('folders.count', { count: folders.length })}
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
          <AppText variant="caption" tone="subtle">
            {t('workspaces.renameHint')}
          </AppText>
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
