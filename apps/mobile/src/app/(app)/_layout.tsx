import { Redirect, Stack } from "expo-router";
import { View } from "react-native";

import {
  Drawer,
  DrawerButton,
  DrawerProvider,
} from "@/components/layout/drawer";
import { SideDrawer } from "@/components/layout/side-drawer";
import { BackButton } from "@/components/ui/breadcrumbs";
import { useTranslation } from "@/lib/i18n";
import { useIsWide } from "@/lib/layout/width";
import { useSession } from "@/hooks/use-session";
import { useTheme } from "@/theme";

/**
 * Auth guard, and the navigation on both sides of the same idea.
 *
 * On a wide screen the navigation is a column that is always there, drawn here so
 * it wraps the whole stack: the tabs are three of the screens this app has, and
 * a navigation that exists on three of them is missing on the other nine.
 *
 * On a phone it is a panel that comes from the left edge, opened by the button in
 * the header, with the same menu and the same spaces inside it. A thumb cannot
 * reach the left edge of a phone, which is why this one opens from a button
 * instead of from a swipe.
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
        //
        // On a phone the menu of the spaces goes first and the back button
        // next to it, both on the left, because that is where the thumb and the
        // eye already look for them. A screen where you can go back but not
        // sideways is half a navigation.
        headerLeft: () =>
          wide ? (
            <BackButton />
          ) : (
            <View style={styles.headerLeft}>
              <DrawerButton />
              <BackButton />
            </View>
          ),
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

  return (
    <DrawerProvider>
      {/* On a phone the menu pushes the app instead of covering it, so the
          screen you interrupted is still there and still lit. On a wide screen
          there is room for both, and the column is always there. */}
      {wide ? (
        <View style={styles.row}>
          <SideDrawer />
          <View style={styles.flex}>{stack}</View>
        </View>
      ) : (
        <Drawer>{stack}</Drawer>
      )}
    </DrawerProvider>
  );
}

const styles = {
  headerLeft: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 2,
  },
  row: {
    flex: 1,
    flexDirection: "row" as const,
  },
  flex: {
    flex: 1,
  },
};
