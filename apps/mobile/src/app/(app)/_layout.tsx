import { Redirect, Stack } from "expo-router";
import { View } from "react-native";

import {
  Drawer,
  DrawerButton,
  DrawerProvider,
} from "@/components/layout/drawer";
import { BackButton } from "@/components/ui/breadcrumbs";
import { AppHeader } from "@/components/ui/app-header";
import { HeaderOwnsTopInset } from "@/components/ui/header-inset";
import {
  HeaderActionProvider,
  useHeaderActionSlot,
} from "@/components/ui/header-action";
import { useTranslation } from "@/lib/i18n";
import { useIsWide } from "@/lib/layout/width";
import { useSession } from "@/hooks/use-session";
import { useTheme } from "@/theme";

/**
 * Auth guard, and the navigation on both sides of the same idea.
 *
 * One menu, and the screen decides where it goes. On a phone it is a panel that
 * comes from the left edge and pushes the app, opened by the button in the
 * header. On a wide screen it is a column that is there, closed and opened by the
 * same button. Same rows, same order, same spaces, same sync row — because it is
 * the same component in both, not two that were meant to match.
 *
 * A thumb cannot reach the left edge of a phone, which is why the phone one
 * opens from a button and not from a swipe. It is in the header of every screen
 * and not only of the three destinations, because the three destinations are
 * inside the menu: close the menu and the way back into them goes with it, so the
 * button that opens it has to be where you are standing.
 */
export default function AppLayout() {
  /*
    Two components, and the split is not tidiness.

    The header's right slot is filled by whatever the current screen publishes,
    and that value lives in a context. A component cannot both provide a context
    and read it: it is **outside** the provider it renders, so `useContext` here
    would return the default — an empty slot and a setter that does nothing —
    and the button would be measured as a 297px space that stays empty however
    many times a screen tries to fill it. So the provider is one component and
    the navigation is another, and the reading happens below the providing.
  */
  return (
    <HeaderActionProvider>
      <AppNavigation />
    </HeaderActionProvider>
  );
}

function AppNavigation() {
  const theme = useTheme();
  const t = useTranslation();
  const { status } = useSession();
  const wide = useIsWide();
  /**
   * What goes in the header's right slot, read once and closed over.
   *
   * The layout draws the header, so the layout fills its slots. A screen cannot:
   * anything it declares is replaced the next time this component renders, which
   * is why the pencil on the panel was measured as a 297px empty space. See
   * `header-action.tsx`.
   */
  const headerRight = useHeaderActionSlot();

  if (status === "loading") {
    return null;
  }

  if (status === "anonymous") {
    return <Redirect href="/(onboarding)/welcome" />;
  }

  const stack = (
    <Stack
      screenOptions={{
        /*
          La cabecera es nuestra, y por una razon que no es de estilo: la del
          navegador solo admite un `backgroundColor` plano, y el color del espacio
          va degradado — el mismo par con el que se pintan las tarjetas del panel.
          Ponerlo plano aquieria decir que un espacio es de un color en el panel y
          de otro en la cabecera, que es exactamente lo que se pretendia evitar.
          `AppHeader` pinta el lavado y deja que el navegador mida el alto.
        */
        header: (props) => <AppHeader {...props} />,
        headerRight,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.background },
        // The browser bar is not a navigation control: on the web there is no
        // swipe back, and the header is the only place a person looks for one.
        //
        // The menu of the spaces goes first and the back button next to it, both
        // on the left, because that is where the thumb and the eye already look
        // for them. A screen where you can go back but not sideways is half a
        // navigation. And both of them are here on a wide screen too, where the
        // menu is a column that can be collapsed: the button is then the only
        // way to bring the column back, and a hamburger that only exists on
        // three of the twelve screens is a hamburger that leaves you stuck.
        //
        //
        // The number is `xs + lg` and not a round 12 because the slot does not
        // start at zero: measured, `headerLeft` places this container at x = -8,
        // so the padding has to make up 8 px of overhang plus the margin wanted.
        // With `xs + lg` the button lands at x = 12, and at that point **all eight
        // screens measured the same** — the three destinations and the five stack
        // routes, which is the whole claim: one header, one margin.
        headerLeft: () => (
          <View
            style={[
              styles.headerLeft,
              { paddingLeft: theme.spacing.xs + theme.spacing.lg },
            ]}
          >
            <DrawerButton />
            <BackButton />
          </View>
        ),
      }}
    >
      {/* Every screen below the tabs keeps the header. It is the back button
          and the name of the thing you are looking at, and a screen without it
          is a dead end: the only way out is the browser bar or a gesture. The
          titles that come from data are set by the screen itself.

          The three destinations used to draw their own header, and that is why
          the button was at x = 8 on one screen and x = -8 on the next: two
          implementations of the same idea, one per family of routes. They now use
          this one, so the margin, the title and the place for a screen's actions
          are the same everywhere. */}
      {/* The three destinations are screens of this stack now, and not tabs.

          The bar at the bottom is gone because the menu already holds all three:
          it was a permanent strip of three icons on every screen, in a bar that
          never changed, for a phone where the thumb is at the bottom and the bar
          was the easiest thing in the way of the content.

          What it bought was a second navigator between the header and the screen
          you are looking at, and that is the part that was costing more than the
          bar was worth: a title set from inside a tab lands on the tab and not on
          the header, and a `headerRight` set the same way disappears. With one
          stack there is nothing between the two and nothing to get wrong.
      */}
      {/*
        The panel is **not** declared here, and that is deliberate.

        A `Stack.Screen` carrying any `options` re-applies them on every render of
        this layout, and re-applying replaces the screen's whole options object —
        so a declaration for the panel and a screen that wants to say what its
        own header says cannot both exist. The panel sets its title and publishes
        its corner button, and the only thing this layout says about it is
        nothing, which leaves the header shown by default.
      */}
<Stack.Screen name="search" options={{ title: t("tabs.search") }} />
      <Stack.Screen name="settings" options={{ title: t("tabs.settings") }} />
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
      {/*
        The detail of a title, **and it is the one screen in the app that cross
        fades.**

        Everywhere else the stack slides, which is right: a slide says "here is
        another screen in the same building" and it keeps the screen you came from
        underneath you so you know where you are. The title's detail is not another
        room, it is **the same poster opened up** — the cover you tapped is the
        cover at the top of it, a few points larger. Sliding to it moves the thing
        that was on top of the stack off to one side and brings this one in from
        the other, which is two movements and a relationship that does not exist
        between a card in a carousel and a page.

        So it fades, in a fifth of a second, and the rise is left to the content:
        the blocks on the page arrive staggered by twenty-five milliseconds each,
        which is the movement that says "this is being read now". A fade for the
        screen and a settle for the text, and neither of them pretending to be the
        other.
      */}
      <Stack.Screen
        name="item/[itemId]"
        options={{ title: "", animation: "fade", animationDuration: 180 }}
      />
      <Stack.Screen name="notes" options={{ title: t("notes.title") }} />
      <Stack.Screen name="habits" options={{ title: t("habits.title") }} />
      <Stack.Screen name="people" options={{ title: t("people.title") }} />
      <Stack.Screen name="templates" options={{ title: t("note.templates") }} />
      {/* The template's own name, not the route: this screen draws it under the
          header, where a note draws its title, and a caption of
          "templates/[templateId]" is developer text in a person's face. */}
      <Stack.Screen name="templates/[templateId]" options={{ title: "" }} />
      <Stack.Screen name="note/[noteId]" options={{ title: "" }} />
    </Stack>
  );

  return (
    <DrawerProvider wide={wide}>
      {/* One shell for both screens, and the only thing that changes between them
          is what happens to the app beside the menu: on a phone it is pushed to
          the right, on a wide screen it stays where it is and takes what the
          column is not using. See `Drawer`. */}
      <Drawer wide={wide}>
        {/*
          This stack's screens all have the header, and the header has already
          taken the status bar's height so its buttons are not under the clock.
          Saying so here is how `Screen` knows not to take it a second time: the gap
          would otherwise be measured twice on a phone with a notch. See
          `header-inset.tsx`.
        */}
        <HeaderOwnsTopInset>{stack}</HeaderOwnsTopInset>
      </Drawer>
    </DrawerProvider>
  );
}

const styles = {
  headerLeft: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 2,
  },
};
