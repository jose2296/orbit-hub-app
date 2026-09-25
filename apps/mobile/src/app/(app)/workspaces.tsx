import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import type { Workspace } from '@orbit-hub/contracts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/list-row';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

const ROLE_TONE: Record<Workspace['role'], 'accent' | 'neutral'> = {
  owner: 'accent',
  editor: 'accent',
  viewer: 'neutral',
};

export default function WorkspacesScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { workspaces, isLoading, refresh, createWorkspace } = useWorkspaces();

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  // Every visit syncs in the background; the list itself comes from the cache.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function onCreate() {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;

    setCreating(true);
    try {
      const id = await createWorkspace({ name: trimmed });
      setName('');
      router.push(`/(app)/workspace/${id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Screen>
      <View style={[styles.header, { gap: theme.spacing.xs }]}>
        <AppText variant="title">{t('workspaces.title')}</AppText>
        <AppText variant="callout" tone="muted">
          {t('workspaces.subtitle')}
        </AppText>
      </View>
      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader
          title={t('workspaces.yours')}
          subtitle={t('workspaces.count', { count: workspaces.length })}
        />

        {isLoading ? (
          <Card variant="muted">
            <AppText variant="callout" tone="muted" align="center">
              {t('common.loading')}
            </AppText>
          </Card>
        ) : workspaces.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              title={t('workspaces.empty.title')}
              description={t('workspaces.empty.body')}
            />
          </Card>
        ) : (
          <View style={{ gap: theme.spacing.sm }}>
            {workspaces.map((workspace) => (
              <Pressable
                key={workspace.id}
                accessibilityRole="button"
                accessibilityLabel={workspace.name}
                onPress={() => router.push(`/(app)/workspace/${workspace.id}`)}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
              >
                <Card style={[styles.row, { gap: theme.spacing.md }]}>
                  <View
                    style={[
                      styles.emoji,
                      { backgroundColor: theme.colors.accentSoft, borderRadius: theme.radius.md },
                    ]}
                  >
                    <AppText variant="title" style={{ color: theme.colors.accentSoftText }}>
                      {workspace.emoji ?? '📁'}
                    </AppText>
                  </View>

                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">{workspace.name}</AppText>
                    <View style={[styles.meta, { gap: theme.spacing.sm }]}>
                      <Badge
                        label={t(`workspaces.role.${workspace.role}`)}
                        tone={ROLE_TONE[workspace.role]}
                      />
                      <AppText variant="caption" tone="muted">
                        {t('workspaces.members', { count: workspace.memberCount })}
                      </AppText>
                    </View>
                  </View>

                  <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
                </Card>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <Card variant="muted" style={{ gap: theme.spacing.md }}>
        <AppText variant="callout" tone="muted">
          {t('workspaces.createHint')}
        </AppText>
        <TextField
          label={t('workspaces.nameLabel')}
          value={name}
          onChangeText={setName}
          placeholder={t('workspaces.namePlaceholder')}
          autoCapitalize="sentences"
          returnKeyType="done"
          onSubmitEditing={() => {
            void onCreate();
          }}
        />
        <Button
          label={t('workspaces.create')}
          icon="add"
          onPress={() => void onCreate()}
          loading={creating}
          disabled={name.trim().length === 0}
        />
      </Card>

      {Platform.OS === 'web' ? (
        <AppText variant="caption" tone="subtle" align="center">
          {t('workspaces.webHint')}
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
  },
  emoji: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
