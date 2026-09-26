import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Platform } from "react-native";

import { useTranslation } from "@/lib/i18n";
import { useIsWide } from "@/lib/layout/width";
import { useTheme } from "@/theme";

/**
 * Where the three destinations live.
 *
 * Under the thumb on a phone, and in a column on the left when there is room.
 * Same three places, same order, same names: a navigation that moves is a
 * navigation you have to look for twice, and the only thing that changes is
 * which edge of the screen it is on.
 *
 * The bar at the bottom is the platform's own and is not reimplemented here. It
 * knows about the safe area, the home indicator and the keyboard, and a hand
 * written one of those is a bar that is a few pixels wrong on one of the three
 * platforms. The column on the wide screen is ours because the platform has no
 * equivalent and because it has to carry the spaces as well.
 *
 * The two branches repeat their three `<Tabs.Screen>` children on purpose. The
 * router reads its children *directly* to work out the routes and their names,
 * and a list of them shared through a variable arrives wrapped in a fragment,
 * which it does not see through: the bar came out saying "index", "search" and
 * "settings" with three missing-glyph triangles. Written out twice, with a
 * comment, is cheaper than that.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const t = useTranslation();
  const wide = useIsWide();

  // On a wide screen the column of navigation is drawn by the layout above, so
  // this one only has to get its own bar out of the way. The bar at the bottom
  // of a 1280px screen is a strip of three icons under a column of text, and it
  // is the one thing on the page that never changes.
  if (wide) {
    return (
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: theme.colors.background },
        }}
        tabBar={() => null}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t("tabs.home"),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: t("tabs.search"),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="search" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: t("tabs.settings"),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textSubtle,
        tabBarStyle: {
          backgroundColor: theme.colors.tabBar,
          borderTopColor: theme.colors.border,
          borderTopWidth: 0.5,
          height: Platform.select({ ios: 84, default: 64 }),
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "600",
        },
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.home"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: t("tabs.search"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("tabs.settings"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
