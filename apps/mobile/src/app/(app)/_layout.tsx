import { Redirect, Stack } from "expo-router";
import { View } from "react-native";

import { BackButton } from "@/components/ui/breadcrumbs";
import { SideDrawer } from "@/components/layout/side-drawer";
import { useTranslation } from "@/lib/i18n";
import { useIsWide } from "@/lib/layout/width";
import { useSession } from "@/hooks/use-session";
import { useTheme } from "@/theme";

/**
 * Auth guard, and the column of navigation on a screen with room for one.
 *
 * The drawer is here and not in the tabs layout because the tabs are three of
 * the screens this app has, and a navigation that exists on three of them is a
 * navigation that is missing on the other nine: on a wide screen, opening a
 * list, a detail or the panel would take away the only way to get anywhere
 * without the back button and a list of guesses. Here it wraps the whole stack,
 * so wherever you are, your spaces are on the left.
 *
 * A phone does not get it, and does not get a drawer that opens over the
 * content either: a drawer over the content is a drawer you open to look at a
 * list and then cannot see the list, and a thumb cannot reach the left edge of a
 * phone anyway. It keeps the bar at the bottom, where the thumb is.
 */
export default function AppLayout() {
  const theme = useTheme();
  const t = useTranslation();
  const { status } = useSession();
  const wide = useIsWide();

  if (status === "loading") {
    return null;
  }

  if (status === "anonymous") {
    return <Redirect href="/(onboarding)/welcome" />;
  }

  const stack = (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { fontWeight: "600" },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.background },
        // The browser bar is not a navigation control: on the web there is no
        // swipe back, and the header is the only place a person looks for one.
        headerLeft: () => <BackButton />,
      }}
    >
      {/* Every screen below the tabs keeps the header. It is the back button
          and the name of the thing you are looking at, and a screen without it
          is a dead end: the only way out is the browser bar or a gesture. The
          titles that come from data are set by the screen itself. */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="dashboard"
        options={{ title: t("dashboard.title") }}
      />
      <Stack.Screen
        name="workspaces"
        options={{ title: t("workspaces.title") }}
      />
      <Stack.Screen name="workspace/[workspaceId]" options={{ title: "" }} />
      {/* One screen per folder level, so the back button leaves one level at a
          time instead of jumping out of the whole space. */}
      <Stack.Screen
        name="workspace/[workspaceId]/folder/[folderId]"
        options={{ title: "" }}
      />
      <Stack.Screen name="lists" options={{ title: t("lists.title") }} />
      <Stack.Screen name="list/[listId]" options={{ title: "" }} />
      <Stack.Screen name="sync" options={{ title: t("sync.title") }} />
      <Stack.Screen name="devices" options={{ title: t("settings.devices") }} />
      <Stack.Screen name="catalog" options={{ title: t("catalog.title") }} />
      <Stack.Screen name="item/[itemId]" options={{ title: "" }} />
    </Stack>
  );

  if (!wide) return stack;

  return (
    <View style={styles.row}>
      <SideDrawer />
      <View style={styles.flex}>{stack}</View>
    </View>
  );
}

const styles = {
  row: {
    flex: 1,
    flexDirection: "row" as const,
  },
  flex: {
    flex: 1,
  },
};
