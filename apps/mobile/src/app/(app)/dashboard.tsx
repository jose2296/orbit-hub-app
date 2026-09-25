import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import type { DashboardWidget } from '@orbit-hub/contracts';

import { IconAction, WIDGET_ICON, widgetBody } from '@/components/dashboard/widget-presentation';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { DraggableRow } from '@/components/ui/draggable-row';
import { Masonry } from '@/components/ui/masonry';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { useDashboard } from '@/hooks/use-dashboard';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { WIDGET_CATALOG } from '@/lib/dashboard/layout';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';
import type { TranslationKey } from '@/lib/i18n';

export default function DashboardScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { layout, isLoading, add, remove, pin, move, reset } = useDashboard();
  const { workspaces } = useWorkspaces();

  const availableKinds = (Object.keys(WIDGET_CATALOG) as DashboardWidget['kind'][]).filter(
    (kind) => !layout.some((widget) => widget.kind === kind),
  );

  return (
    <Screen>
      {/* The stack header already says "Tu panel"; a second title under it just
          repeats it. */}
      <AppText variant="callout" tone="muted">
        {t('dashboard.subtitle')}
      </AppText>

      {isLoading ? (
        <Card variant="muted">
          <AppText variant="callout" tone="muted" align="center">
            {t('common.loading')}
          </AppText>
        </Card>
      ) : (
        <Masonry>
          {layout.map((widget) => (
            <DraggableRow
              key={widget.id}
              id={widget.id}
              index={layout.findIndex((w) => w.id === widget.id)}
              total={layout.length}
              onReorder={(_, toIndex) => {
                // El dashboard se ordena por flechas; el arrastre reutiliza esa
                // misma acción para que no haya dos caminos al mismo orden.
                if (toIndex < layout.findIndex((w) => w.id === widget.id)) {
                  void move(widget.id, 'up');
                } else if (toIndex > layout.findIndex((w) => w.id === widget.id)) {
                  void move(widget.id, 'down');
                }
              }}
            >
            <Card style={{ gap: theme.spacing.md }} kind={widget.kind}>
              <View style={[styles.row, { gap: theme.spacing.md }]}>
                <View
                  style={[
                    styles.icon,
                    { backgroundColor: theme.colors.accentSoft, borderRadius: theme.radius.md },
                  ]}
                >
                  <Ionicons
                    name={WIDGET_ICON[widget.kind]}
                    size={18}
                    color={theme.colors.accentSoftText}
                  />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">
                    {t(WIDGET_CATALOG[widget.kind].labelKey as TranslationKey)}
                  </AppText>
                  {widget.pinned ? <Badge label={t('dashboard.pinned')} tone="accent" /> : null}
                </View>
              </View>

              <AppText variant="caption" tone="subtle">
                {widgetBody(t, widget.kind, workspaces.length)}
              </AppText>

              <View style={[styles.actions, { gap: theme.spacing.sm }]}>
                <IconAction
                  icon="arrow-up"
                  label={t('dashboard.moveUp')}
                  onPress={() => void move(widget.id, 'up')}
                />
                <IconAction
                  icon="arrow-down"
                  label={t('dashboard.moveDown')}
                  onPress={() => void move(widget.id, 'down')}
                />
                <IconAction
                  icon={widget.pinned ? 'bookmark' : 'bookmark-outline'}
                  label={widget.pinned ? t('dashboard.unpin') : t('dashboard.pin')}
                  onPress={() => void pin(widget.id)}
                />
                <IconAction
                  icon="trash-outline"
                  label={t('dashboard.remove')}
                  destructive
                  onPress={() => void remove(widget.id)}
                />
              </View>
            </Card>
            </DraggableRow>
          ))}
        </Masonry>
      )}

      <View style={{ gap: theme.spacing.md }}>
        <AppText variant="heading">{t('dashboard.addWidget')}</AppText>
        {availableKinds.length === 0 ? (
          <EmptyState compact title={t('dashboard.allWidgets')} />
        ) : (
          <View style={[styles.row, { gap: theme.spacing.sm, flexWrap: 'wrap' }]}>
            {availableKinds.map((kind) => (
              <Pressable
                key={kind}
                accessibilityRole="button"
                onPress={() => void add(kind)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: theme.colors.accentSoft,
                    borderRadius: theme.radius.pill,
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.sm,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <AppText variant="callout" style={{ color: theme.colors.accentSoftText }}>
                  + {t(WIDGET_CATALOG[kind].labelKey as TranslationKey)}
                </AppText>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <Card variant="muted" style={{ gap: theme.spacing.md }}>
        <AppText variant="caption" tone="subtle">
          {t('dashboard.hint')}
        </AppText>
        <View style={[styles.actions, { gap: theme.spacing.sm }]}>
          <IconAction icon="refresh" label={t('dashboard.reset')} onPress={() => void reset()} />
          <IconAction
            icon="albums-outline"
            label={t('workspaces.title')}
            onPress={() => router.push('/(app)/workspaces')}
          />
        </View>
      </Card>
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
  icon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  chip: {
    alignSelf: 'flex-start',
  },
});
