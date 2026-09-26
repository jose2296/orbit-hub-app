import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { SyncStatusCard } from "@/components/sync/sync-status-card";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow, SectionHeader } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { AppText } from "@/components/ui/text";
import { Checkbox } from "@/components/ui/checkbox";
import { useTaskPreview } from "@/hooks/use-dashboard-preview";
import { useSession } from "@/hooks/use-session";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { colorOf } from "@/lib/workspace/color";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * The home screen: what there is to do, and the spaces it is in.
 *
 * Two questions and nothing else: what is left to do, and where my things are.
 * A row of widgets that say "tasks" and "recent lists" answers neither, and it
 * is what was here before: the panel is where the arrangement of lists lives, and
 * this is where you find out what is waiting.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { user } = useSession();
  const { workspaces, isLoading } = useWorkspaces();
  const tasks = useTaskPreview(3, 3);

  const recent = workspaces.slice(0, 4);

  return (
    <Screen>
      <View style={styles.header}>
        <View style={{ gap: theme.spacing.xxs }}>
          <AppText variant="title">
            {t("home.greeting", { name: user?.displayName ?? "" })}
          </AppText>
          <AppText variant="callout" tone="muted">
            {user?.email}
          </AppText>
        </View>
      </View>

      <SyncStatusCard onPress={() => router.push("/(app)/sync")} />

      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader
          title={t("home.pending.title")}
          actionLabel={t("home.pending.all")}
          onAction={() => router.push("/(app)/panel")}
        />

        {isLoading ? (
          <Card variant="muted">
            <AppText variant="callout" tone="muted" align="center">
              {t("common.loading")}
            </AppText>
          </Card>
        ) : tasks.rows.length === 0 ? (
          <EmptyState
            compact
            title={t("home.pending.empty")}
            description={t("home.pending.emptyHint")}
          />
        ) : (
          <Card padded={false}>
            {tasks.rows.map((row) => (
              <Pressable
                key={`${row.listId}:${row.item.id}`}
                accessibilityRole="button"
                accessibilityLabel={row.item.title}
                onPress={() => router.push(`/(app)/list/${row.listId}`)}
                style={({ pressed }) => [
                  styles.taskRow,
                  {
                    borderTopColor: theme.colors.border,
                    backgroundColor: pressed
                      ? theme.colors.surfaceMuted
                      : "transparent",
                  },
                ]}
              >
                <Checkbox checked={false} onToggle={() => undefined} label="" />
                <View style={styles.flex}>
                  <AppText variant="body" numberOfLines={1}>
                    {row.item.title}
                  </AppText>
                  {/* Which list it is in, in the colour of the space: the only
                      place the home says where a thing came from. */}
                  <AppText variant="caption" tone="subtle" numberOfLines={1}>
                    {row.listTitle}
                  </AppText>
                </View>
              </Pressable>
            ))}
          </Card>
        )}
      </View>

      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader
          title={t("home.workspaces.title")}
          actionLabel={t("home.workspaces.all")}
          onAction={() => router.push("/(app)/workspaces")}
        />

        {isLoading ? (
          <Card variant="muted">
            <AppText variant="callout" tone="muted" align="center">
              {t("common.loading")}
            </AppText>
          </Card>
        ) : recent.length === 0 ? (
          <EmptyState
            compact
            title={t("home.workspaces.empty.title")}
            description={t("home.workspaces.empty.body")}
          />
        ) : (
          <Card padded={false}>
            {recent.map((workspace) => (
              <ListRow
                key={workspace.id}
                title={workspace.name}
                subtitle={t(
                  pluralKey("workspaces.members", workspace.memberCount),
                  {
                    count: workspace.memberCount,
                  },
                )}
                chevron
                // The colour of the space, as a dot beside its name: it is how a
                // space is told apart from another one at a glance, and the cards
                // it makes on the panel are painted with it.
                leading={
                  <View
                    style={[
                      styles.spaceDot,
                      { backgroundColor: colorOf(workspace.color) },
                    ]}
                  />
                }
                onPress={() => router.push(`/(app)/workspace/${workspace.id}`)}
              />
            ))}
          </Card>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("home.dashboard.customise")}
        accessibilityHint={t("dashboard.addCardHint")}
        onPress={() => router.push("/(app)/dashboard")}
        style={({ pressed }) => [
          styles.panelLink,
          {
            backgroundColor: theme.colors.surfaceMuted,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.lg,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Ionicons
          name="apps-outline"
          size={18}
          color={theme.colors.textMuted}
        />
        <AppText variant="bodyStrong" style={styles.flex}>
          {t("home.dashboard.customise")}
        </AppText>
        <Ionicons
          name="chevron-forward"
          size={16}
          color={theme.colors.textSubtle}
        />
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 8,
  },
  flex: {
    flex: 1,
  },
  spaceDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  panelLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderWidth: 1,
  },
});
