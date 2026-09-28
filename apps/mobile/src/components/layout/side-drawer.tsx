import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { WorkspaceColor } from "@orbit-hub/contracts";

import { useA11yHint } from "@/components/ui/a11y-hint";
import { AppText } from "@/components/ui/text";
import { useSyncStatus } from "@/hooks/use-sync-status";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { colorOf } from "@/lib/workspace/color";
import { useTheme } from "@/theme";

/** The three destinations, in the order they are in the bottom bar too. */
const DESTINATIONS = [
  {
    route: "/(app)/(tabs)" as const,
    name: "index",
    labelKey: "tabs.home",
    icon: "home",
  },
  {
    route: "/(app)/(tabs)/search" as const,
    name: "search",
    labelKey: "tabs.search",
    icon: "search",
  },
  {
    route: "/(app)/(tabs)/settings" as const,
    name: "settings",
    labelKey: "tabs.settings",
    icon: "settings",
  },
] as const;

/**
 * The navigation column for a screen with room for it.
 *
 * A phone keeps the bar at the bottom, under the thumb, because that is where a
 * thumb is and the top of the screen is out of reach. A screen with room for it
 * gets a column on the left, which is where navigation lives on every desktop
 * app ever made, and leaves the rest of the width to the content instead of to
 * four icons.
 *
 * The column carries the spaces too, each with its colour. That is the part that
 * is not the bottom bar turned on its side: on a phone, reaching your second
 * space means going to the home screen and looking for it; here it is a row you
 * can see, and the colour tells two spaces apart without reading the names.
 *
 * It navigates with the router and not through the tab navigator's own state,
 * for two reasons. It sits outside the navigator, so there is no state to read.
 * And a drawer with its own idea of where you are can disagree with the bar it
 * replaced, which is a navigation that lies.
 */
export function SideDrawer() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { workspaces } = useWorkspaces();
  const { status } = useSyncStatus();

  return (
    <View
      style={[
        styles.drawer,
        {
          backgroundColor: theme.colors.tabBar,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <View style={{ padding: theme.spacing.md, gap: 2 }}>
        <AppText variant="heading">{t("app.name")}</AppText>
        <AppText variant="caption" tone="subtle">
          {t("app.tagline")}
        </AppText>
      </View>

      <View style={{ padding: theme.spacing.sm, gap: 2 }}>
        {DESTINATIONS.map((destination) => (
          <DestinationRow
            key={destination.name}
            route={destination.route}
            labelKey={destination.labelKey}
            icon={destination.icon}
            focused={pathname === destination.route}
          />
        ))}
      </View>

      <View style={[styles.rule, { backgroundColor: theme.colors.border }]} />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={{
          padding: theme.spacing.sm,
          gap: 2,
          paddingBottom: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <AppText
          variant="caption"
          tone="subtle"
          style={{
            paddingHorizontal: theme.spacing.sm,
            paddingBottom: theme.spacing.xs,
          }}
        >
          {t("drawer.spaces")}
        </AppText>

        {workspaces.map((workspace) => (
          <WorkspaceRow
            key={workspace.id}
            id={workspace.id}
            name={workspace.name}
            color={workspace.color}
            memberCount={workspace.memberCount}
          />
        ))}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("workspaces.allOfThem")}
          onPress={() => router.push("/(app)/workspaces")}
          style={({ pressed }) => [
            styles.item,
            {
              borderRadius: theme.radius.md,
              backgroundColor: pressed
                ? theme.colors.surfaceMuted
                : "transparent",
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: theme.spacing.sm,
            },
          ]}
        >
          <Ionicons
            name="grid-outline"
            size={18}
            color={theme.colors.textMuted}
          />
          <AppText variant="body" tone="muted">
            {t("workspaces.allOfThem")}
          </AppText>
        </Pressable>
      </ScrollView>

      {/* The queue, at the bottom of the column where the eye already is on its
          way out. On a phone this is a tab you have to notice; here it is a line
          that says whether anything is waiting, because on a wide screen nothing
          is telling you otherwise. */}
      {status.pendingOperations > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            pluralKey("drawer.pending", status.pendingOperations),
            { count: status.pendingOperations },
          )}
          onPress={() => router.push("/(app)/sync")}
          style={({ pressed }) => [
            styles.item,
            {
              borderRadius: theme.radius.md,
              backgroundColor: pressed
                ? theme.colors.surfaceMuted
                : theme.colors.accentSoft,
              margin: theme.spacing.sm,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: theme.spacing.sm,
            },
          ]}
        >
          <Ionicons
            name="cloud-upload-outline"
            size={16}
            color={theme.colors.accent}
          />
          <AppText variant="caption" style={{ color: theme.colors.accent }}>
            {t(pluralKey("drawer.pending", status.pendingOperations), {
              count: status.pendingOperations,
            })}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One of the three destinations, in its own component so the hint hook is not
 * called once per destination inside a map.
 */
function DestinationRow({
  route,
  labelKey,
  icon,
  focused,
}: {
  route: (typeof DESTINATIONS)[number]["route"];
  labelKey: (typeof DESTINATIONS)[number]["labelKey"];
  icon: (typeof DESTINATIONS)[number]["icon"];
  focused: boolean;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();

  const pista = useA11yHint(
    t("drawer.goTo", {
      what: t(labelKey),
    }),
  );

  const tint = focused ? theme.colors.accent : theme.colors.textMuted;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={t(labelKey)}
        {...pista.props}
        onPress={() => router.push(route)}
        style={({ pressed }) => [
          styles.item,
          {
            borderRadius: theme.radius.md,
            backgroundColor: pressed
              ? theme.colors.surfaceMuted
              : focused
                ? theme.colors.accentSoft
                : "transparent",
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: theme.spacing.sm,
          },
        ]}
      >
        <Ionicons name={icon as never} size={18} color={tint} />
        <AppText variant="body" style={{ color: tint }}>
          {t(labelKey)}
        </AppText>
      </Pressable>
      {pista.node}
    </>
  );
}

/**
 * One space, in its own component so the hint hook is not called once per space
 * inside a map.
 */
function WorkspaceRow({
  id,
  name,
  color,
  memberCount,
}: {
  id: string;
  name: string;
  color: WorkspaceColor;
  memberCount: number;
}) {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();

  const pista = useA11yHint(
    t(pluralKey("workspaces.members", memberCount), { count: memberCount }),
  );

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        {...pista.props}
        onPress={() => router.push(`/(app)/workspace/${id}`)}
        style={({ pressed }) => [
          styles.item,
          {
            borderRadius: theme.radius.md,
            backgroundColor: pressed
              ? theme.colors.surfaceMuted
              : "transparent",
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: theme.spacing.sm,
          },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: colorOf(color) }]} />
        <AppText variant="body" numberOfLines={1} style={styles.flex}>
          {name}
        </AppText>
      </Pressable>
      {pista.node}
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 38,
  },
  drawer: {
    width: 264,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 12,
  },
});
