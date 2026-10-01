import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type {
  Folder,
  List,
  ListItem,
  Share,
  Workspace,
} from "@orbit-hub/contracts";

import { PlaceShareSheet } from "@/components/shares/place-share-sheet";
import { SyncBadge } from "@/components/sync/sync-badge";
import { SyncRow } from "@/components/sync/sync-row";
import { useA11yHint } from "@/components/ui/a11y-hint";
import { useLongPressText } from "@/hooks/use-long-press-text";
import { expandedProps, selectedProps } from "@/components/ui/a11y-state";
import { AppText } from "@/components/ui/text";
import { SpaceDot } from "@/components/ui/wash";
import { useListItems } from "@/hooks/use-lists";
import { useSession } from "@/hooks/use-session";
import { useShares } from "@/hooks/use-shares";
import { useSpacesTree } from "@/hooks/use-spaces-tree";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { drawerWidth } from "@/lib/layout/measure";
import { useTheme } from "@/theme";

import type { SpacesTree } from "@/hooks/use-spaces-tree";

/**
 * The three destinations, with **two** addresses each.
 *
 * `route` is where pressing it goes, and it is a router href: it says which
 * screen, groups included. `path` is what the browser's address bar shows, and it
 * is what `usePathname` hands back.
 *
 * They are not the same string, and comparing one against the other is how the
 * row for the panel stopped saying where you are: the href for the index screen
 * of a group is `/(app)`, the path is `/`, and `"/" === "/(app)"` is false. The
 * row was never marked while you were on it and there was no way to tell whether
 * that was intended. Two fields, compared to the right one.
 */
const DESTINATIONS = [
  { route: "/(app)", path: "/", icon: "home", labelKey: "tabs.home" },
  {
    /*
     * Notes, between the panel and the search.
     *
     * They were not here at all, and the screen existed: `/notes` was reachable
     * by nothing, so the `+` that creates a note from a template — and the one
     * that creates a blank one — were on a screen nobody could get to. A feature
     * that is one tap away from a menu entry and zero taps away from any is not
     * finished, it is filed.
     *
     * It is here and not inside a space because it is not inside one: it is every
     * note the person has written, which is the same reason the templates follow
     * them rather than sitting in a folder.
     */
    route: "/(app)/notes",
    path: "/notes",
    icon: "document-text-outline",
    labelKey: "notes.title",
  },
  {
    route: "/(app)/search",
    path: "/search",
    icon: "search",
    labelKey: "tabs.search",
  },
  {
    /*
     * People, between search and settings.

     * It is a destination of its own and not a section inside settings, because the
     * thing it is for is sharing, and sharing is not something anybody goes to
     * settings to do. It sits above settings because everything else in this menu
     * is about your own things and this is the only row that is about somebody
     * else's.
     *
     * It is a directory and not a friends list: see ADR 0032.
     */
    route: "/(app)/people",
    path: "/people",
    icon: "people-outline",
    labelKey: "people.title",
  },
  {
    route: "/(app)/settings",
    path: "/settings",
    icon: "settings",
    labelKey: "tabs.settings",
  },
] as const;

const LIST_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  tasks: "checkbox-outline",
  movies: "film-outline",
  series: "tv-outline",
  movies_and_series: "film-outline",
  books: "book-outline",
};

/** How many rows of items a list shows before it says how many are left. */
const ITEMS_SHOWN = 12;

/**
 * The menu of the left, and what it does to the app beside it.
 *
 * **One component and two placements, not two menus.** A phone and a wide screen
 * show the same rows in the same order because they are the same panel,
 * `DrawerPanel`, in the same order. A menu that lists a space on a phone and also
 * lists its folders on a laptop is a menu you have to learn twice, and it is a
 * menu that silently stops being the navigation on whichever screen somebody
 * forgets — which is how every folder, list and item ended up reachable only on
 * a phone, the one place you cannot have a sidebar.
 *
 * **The difference is only what happens to the app next to it.** On a phone the
 * menu *pushes*: it comes in from the left and the screen moves to the right, so
 * the app you were looking at is still there, still lit, and one tap away. A
 * drawer that covers what you opened it to see is a drawer you have to close
 * again before you learn anything, and a curtain over a screen you are in a hurry
 * to leave is one more thing between you and the thing you came for. On a wide
 * screen there is room for both, so nothing moves and the app takes what the
 * column is not using.
 *
 * That also means the menu is not a modal. It is part of the app, always mounted,
 * sliding — so it is there in a frame when you tap the button instead of appearing
 * out of nothing, and a screen reader is in it before you ask.
 *
 * It is a file tree: a space, its folders inside folders as deep as they go, the
 * lists in the folder they are in, and the items in their list. A menu that
 * lists a space and stops there makes you go in, look, come back and go into the
 * other one: four taps to reach a film that is in the second folder of the
 * second list.
 */
export function Drawer({
  wide,
  children,
}: {
  /** Whether there is room to leave the app where it is instead of pushing it. */
  wide: boolean;
  children: React.ReactNode;
}) {

  const t = useTranslation();
  const { width } = useWindowDimensions();
  const { open, setOpen } = useDrawer();
  const closeLabel = t("drawer.closeByTapping");

  // One width for both placements, so the row you aim at on a phone is the same
  // row on a laptop. Two menus that are nearly the same are two menus: the
  // indentation of the tree stops lining up with the edge of the column and the
  // column is a few pixels somewhere else than the muscle memory says.
  //
  // The numbers behind the fraction are in `drawerWidth`, in `lib/layout/measure`.
  const menuWidth = drawerWidth(width);
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: open ? 260 : 200,
      // Out fast, in slower. A drawer that takes the same time both ways feels
      // slow to open and reluctant to close.
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      // Without the driver nativo, and on purpose: what moves is the *width* of
      // a column and not a displacement, and the width cannot be drawn by the
      // interface thread. It is one view and 260 milliseconds.
      useNativeDriver: false,
    }).start();
  }, [open, progress]);

  // The same column either way: it grows from nothing to the width of the menu.
  // What sits next to it is the only thing that decides what that means.
  const columnWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, menuWidth],
  });

  return (
    <View style={styles.root}>
      {/*
        The menu takes the space it needs and the app takes the rest, in a row, so
        on a phone the app really is pushed: it is narrower and to the right, and
        every pixel of it is still on the screen.

        Sliding the app sideways instead — a transform — was the obvious thing and
        it is wrong twice over: the app goes off the right edge, and it ends up
        *over* the menu, so the last thing in the menu, the arrow that opens a
        space, ends up under the screen you were reading.
      */}
      <Animated.View style={[styles.column, { width: columnWidth }]}>
        {/* A fixed width inside, so the lines of the menu do not re-wrap sixty
            times while the column grows. */}
        <View style={[styles.columnInner, { width: menuWidth }]}>
          {/*
            Navigating closes the menu on a phone and not on a wide screen, and
            that is the whole difference between a panel and a column.

            On a phone you opened the menu, you tapped where you wanted to go, and
            the menu is in the way of the thing you asked for. On a wide screen
            the column is not in the way of anything: it is beside the app, the
            app is still there, and closing it means that going from one folder
            to another — or from one space to another and back — takes two clicks
            every time, because the first one takes the navigation away. A sidebar
            that closes when you use it is not a sidebar.
          */}
          <DrawerPanel onNavigate={wide ? undefined : () => setOpen(false)} />
        </View>
      </Animated.View>

      <Animated.View
        testID="drawer-app"
        style={[
          wide
            ? // What is left over, and nothing moves: on a wide screen the menu is
              // a column *beside* the app, so collapsing it hands the space back
              // rather than sliding the app off the right edge. The app is not
              // given a hard width here, and that is the point: see `app` for why
              // the opposite is what a push needs.
              styles.appWide
            : {
                // Su propio ancho, siempre, y no el que le sobra: al empujar, la
                // app se desplaza y su derecha se sale de la pantalla.
                // Estrecharla es lo que hacia que todo dentro se reordenara para
                // caber en un trozo —la fila apilada, la cabecera partida— y
                // una app cortada se lee mejor que una app encogida.
                //
                // `minWidth: 0` y no es un detalle. Un hijo de un `flex` no baja
                // de su contenido por defecto, y con el menu abierto la app se
                // negaba a estrecharse: las filas seguian midiendo 366 px dentro
                // de una columna de 284, y lo que se veia era una franja de 146
                // px de una pantalla entera. Eso es lo de "se queda todo en una
                // linea fea", y no era un problema de ancho del menu.
                ...styles.app,
                width,
                // This is an `Animated.View` and not a `View`, and that is the
                // whole fix for the crash this used to be. `progress.interpolate`
                // hands back an animated node, not a number, and a plain `View`
                // passes style straight to the native layer, which reads the node
                // as a transform value and refuses it:
                // `Transform with key of "translateX" must be number or a
                // percentage. Passed value: {"translateX":0}`. The object in the
                // message is the animated node itself. Only `Animated.View`
                // resolves the node to the number the transform needs, and the
                // app is unwrappable on a phone — this screen is where the whole
                // app lives.
                transform: [
                  {
                    translateX: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, menuWidth],
                    }),
                  },
                ],
              },
        ]}
      >
        {children}
        {/* It is there to be pressed and not to be seen: closing by tapping the
            screen you interrupted, which is what a push means.

            Nothing on a wide screen. The menu is beside the app there, not over
            it, so a curtain would be a layer of nothing on top of content that
            is already fully visible — and a transparent `Pressable` over it
            eats every tap under it, which is a worse bug than the one this
            would be fixing. The hamburger is the way out, and it is on every
            screen. */}
        {open && !wide ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            onPress={() => setOpen(false)}
            style={styles.scrim}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}

/**
 * The contents of the menu. All of it, and it is the same contents everywhere.
 *
 * This is the panel on a phone and the column on a wide screen, one component
 * and not two that were meant to match. It used to be two: a phone got the file
 * tree, and a desktop got a flat list of the spaces with their dots, which meant
 * that every folder, every list and every item was reachable only on the one
 * screen where you cannot have a sidebar — and the two of them drifted, because
 * two lists of rows that are supposed to look alike are two lists to keep in step.
 *
 * It also carries its own surface and its own right-hand edge, for the same
 * reason. A column that is transparent over the app is a column you cannot read
 * where the two surfaces happen to be the same colour, and the hairline is what
 * says "this is a separate thing" without a shadow.
 */
export function DrawerPanel({ onNavigate }: { onNavigate?: () => void }) {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { workspaces } = useWorkspaces();
  const { status } = useSession();
  const tree = useSpacesTree();

  // What has been shared with this person and not filed yet. The section is in
  // the menu and not on its own screen because the thing to do with it is
  // one tap away from where you are already looking: a list that arrived in a
  // place you have to remember to visit is a list you never file.
  const { inbox, load: reloadInbox } = useShares();
  const [colocando, setColocando] = useState<Share | null>(null);

  // Asked only once there is a session to ask with.
  //
  // The menu is mounted from the first frame, including the frames where the
  // session is still being restored, and the inbox is a network call that needs a
  // token. Asking before the token exists is a 401 on every drawer open, forever,
  // and it was the only thing the browser console had to say when this screen was
  // verified for the first time.
  useEffect(() => {
    if (status !== "authenticated") return;
    void reloadInbox();
  }, [reloadInbox, status]);

  const go = (href: string) => {
    onNavigate?.();
    router.push(href as never);
  };

  return (
    <View
      testID="drawer-panel"
      style={[
        styles.panel,
        {
          backgroundColor: theme.colors.tabBar,
          borderRightColor: theme.colors.border,
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 8,
        },
      ]}
    >
      <View style={[styles.top, { padding: theme.spacing.md }]}>
        <View style={{ gap: 2, flex: 1 }}>
          <AppText variant="heading">{t("app.name")}</AppText>
          <AppText variant="caption" tone="subtle">
            {t("app.tagline")}
          </AppText>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.sm,
          paddingBottom: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        {DESTINATIONS.map((destination) => {
          const focused = pathname === destination.path;
          const tint = focused ? theme.colors.accent : theme.colors.textMuted;
          return (
            <Pressable
              key={destination.route}
              accessibilityRole="button"
              {...selectedProps(focused)}
              accessibilityLabel={t(destination.labelKey)}
              onPress={() => go(destination.route)}
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
              <Ionicons
                name={destination.icon as never}
                size={18}
                color={tint}
              />
              <AppText variant="body" style={{ color: tint }}>
                {t(destination.labelKey)}
              </AppText>
            </Pressable>
          );
        })}

        <View style={[styles.rule, { backgroundColor: theme.colors.border }]} />

        {/*
          The sync centre goes here, above the spaces, and it used to be at the
          bottom of the list of spaces.

          Below the spaces it was invisible: a drawer with three or four of them
          is taller than the screen, and the row that the dot on the menu button
          is pointing at was the one thing you had to scroll to find. A control
          that an alert sends you to has to be where the alert sends you, and not
          at the end of a list whose length you do not control.
        */}
        <SyncRow onPress={() => go("/(app)/sync")} />

        <View style={[styles.rule, { backgroundColor: theme.colors.border }]} />

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
          <SpaceBranch
            key={workspace.id}
            workspace={workspace}
            tree={tree}
            pathname={pathname}
            onOpen={go}
          />
        ))}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("workspaces.allOfThem")}
          onPress={() => go("/(app)/workspaces")}
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

        {/*
          Only when there is something. An empty "compartido conmigo" heading with
          a sentence explaining that it is empty is a thing the menu spends two
          lines on, forever, to say nothing — and a heading that is always there
          stops being something you read.
        */}
        {inbox.length > 0 ? (
          <>
            <View style={[styles.rule, { backgroundColor: theme.colors.border }]} />
            <AppText
              variant="caption"
              tone="subtle"
              style={{
                paddingHorizontal: theme.spacing.sm,
                paddingBottom: theme.spacing.xs,
              }}
            >
              {t(pluralKey("drawer.sharedWithMeCount", inbox.length), {
                count: inbox.length,
              })}
            </AppText>
            {inbox.map((share) => (
              <InboxRow
                key={share.id}
                share={share}
                onPress={() => setColocando(share)}
              />
            ))}
          </>
        ) : null}
      </ScrollView>

      {/*
        The panel that asks where it goes, and it lives with the menu that
        offered it. Mounted only while there is one to place, so opening the
        menu does not leave a hidden modal behind it.
      */}
      <PlaceShareSheet
        share={colocando}
        onClose={() => setColocando(null)}
        onPlaced={() => void reloadInbox()}
      />
    </View>
  );
}

/**
 * One thing shared with this person that is not filed yet, in its own component
 * so the hint hook is not called once per share inside a map.
 */
function InboxRow({
  share,
  onPress,
}: {
  share: Share;
  onPress: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  const pista = useA11yHint(t("place.chooseSpaceHint"));

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t("drawer.sharedWithMe")}: ${share.title}`}
        {...pista.props}
        onPress={onPress}
        style={({ pressed }) => [
          styles.item,
          {
            borderRadius: theme.radius.md,
            backgroundColor: pressed
              ? theme.colors.surfaceMuted
              : "transparent",
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: 7,
          },
        ]}
      >
        <Ionicons
          name="people-outline"
          size={15}
          color={theme.colors.accent}
        />
        <View style={{ flex: 1 }}>
          <AppText variant="callout" numberOfLines={1}>
            {share.title}
          </AppText>
          <AppText variant="caption" tone="subtle" numberOfLines={1}>
            {share.ownerName ?? ""}
          </AppText>
        </View>
        <Ionicons
          name="chevron-forward"
          size={14}
          color={theme.colors.textSubtle}
        />
      </Pressable>
      {pista.node}
    </>
  );
}

/** A space, with everything under it. It is open when you are standing in it. */
function SpaceBranch({
  workspace,
  tree,
  pathname,
  onOpen,
}: {
  workspace: Workspace;
  tree: SpacesTree;
  pathname: string;
  onOpen: (href: string) => void;
}) {
  /** The whole of this row's name on a long press, on the row's own press. */
  const nombreLargo = useLongPressText(workspace.name);

  const theme = useTheme();
  const t = useTranslation();
  const inside = pathname.includes(workspace.id);
  const [open, setOpen] = useState(inside);

  useEffect(() => {
    // Opening the menu shows the space you are in, so it is never a list of
    // closed doors when you are standing inside one of them.
    if (inside) setOpen(true);
  }, [inside]);

  const pista = useA11yHint(
    workspace.shared
      ? t("drawer.sharedBadgeHint")
      : t(pluralKey("workspaces.members", workspace.memberCount), {
          count: workspace.memberCount,
        }),
  );

  return (
    <View>
      <View style={[styles.item, { gap: 2 }]}>
        <Pressable
          accessibilityRole="button"
          {...expandedProps(open)}
          accessibilityLabel={workspace.name}
          {...pista.props}
          onLongPress={nombreLargo.onLongPress}
          onPress={() => onOpen(`/(app)/workspace/${workspace.id}`)}
          style={({ pressed }) => [
            styles.item,
            styles.flex,
            {
              borderRadius: theme.radius.md,
              backgroundColor: pressed
                ? theme.colors.surfaceMuted
                : inside
                  ? theme.colors.accentSoft
                  : "transparent",
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: theme.spacing.sm,
            },
          ]}
        >
          {/* The dot is a small copy of the space, so it takes the chosen end
              colour too: without it the menu paints a derived pair beside the
              picker preview of the same space. */}
          <SpaceDot
            colorKey={workspace.color}
            colorToKey={workspace.colorTo}
            wash={workspace.wash}
            size={14}
          />

                    <AppText variant="body" numberOfLines={1} style={styles.flex}>
            {workspace.name}
          </AppText>
          {/*
            The mark on a space you were given rather than invited to.

            A symbol and not a colour or a different dot, because the difference
            that matters is a fact about *who owns this* and not about how it looks,
            and a recoloured dot would say it to nobody who is not already looking
            for it.
          */}
          {workspace.shared ? (
            <Ionicons
              name="people"
              size={13}
              color={theme.colors.textSubtle}
              accessibilityLabel={t("drawer.sharedBadge")}
            />
          ) : null}
        </Pressable>
        {pista.node}
        {nombreLargo.sheet}

        <BranchToggle
          open={open}
          what={workspace.name}
          empty={tree.isEmpty(workspace.id)}
          onPress={() => setOpen((value) => !value)}
        />
      </View>

      {open ? (
        <View style={styles.branch}>
          <Children
            workspaceId={workspace.id}
            parentId={null}
            tree={tree}
            onOpen={onOpen}
          />
          {tree.isEmpty(workspace.id) ? (
            <AppText
              variant="caption"
              tone="subtle"
              style={{
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: 7,
              }}
            >
              {t("drawer.emptySpace")}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * What is inside a folder, or inside a space when there is no folder.
 *
 * The same component for both, and it calls itself for the folders inside a
 * folder, so a tree of any depth is the same code once. A menu that knows about
 * two levels is a menu that goes wrong on the third.
 */
function Children({
  workspaceId,
  parentId,
  tree,
  onOpen,
  depth = 1,
}: {
  workspaceId: string;
  parentId: string | null;
  tree: SpacesTree;
  onOpen: (href: string) => void;
  depth?: number;
}) {
  const folders = tree.foldersOf(workspaceId, parentId);
  const lists = tree.listsOf(workspaceId, parentId);

  return (
    <View style={depth > 1 ? { paddingLeft: 12 } : null}>
      {folders.map((folder) => (
        <FolderBranch
          key={folder.id}
          folder={folder}
          tree={tree}
          onOpen={onOpen}
          depth={depth}
        />
      ))}
      {lists.map((list) => (
        <ListBranch key={list.id} list={list} onOpen={onOpen} />
      ))}
    </View>
  );
}

/** A folder, and what is inside it, and what is inside that. */
function FolderBranch({
  folder,
  tree,
  onOpen,
  depth,
}: {
  folder: Folder;
  tree: SpacesTree;
  onOpen: (href: string) => void;
  depth: number;
}) {
  /** The whole of this row's name on a long press, on the row's own press. */
  const nombreLargo = useLongPressText(folder.name);

  const theme = useTheme();
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const empty = tree.isFolderEmpty(folder.id);
  const pista = useA11yHint(t("drawer.opensFolder", { name: folder.name }));

  return (
    <View>
      <View style={[styles.item, { gap: 2 }]}>
        <Pressable
          accessibilityRole="button"
          {...expandedProps(open)}
          accessibilityLabel={folder.name}
          {...pista.props}
          onLongPress={nombreLargo.onLongPress}
          onPress={() =>
            onOpen(`/(app)/workspace/${folder.workspaceId}/folder/${folder.id}`)
          }
          style={({ pressed }) => [
            styles.item,
            styles.flex,
            {
              borderRadius: theme.radius.md,
              backgroundColor: pressed
                ? theme.colors.surfaceMuted
                : "transparent",
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: 7,
            },
          ]}
        >
          <Ionicons
            name={open ? "folder-open-outline" : "folder-outline"}
            size={15}
            color={theme.colors.textSubtle}
          />

                    <AppText variant="callout" numberOfLines={1} style={styles.flex}>
            {folder.emoji ? `${folder.emoji} ` : ""}
            {folder.name}
          </AppText>
        </Pressable>
        {pista.node}
        {nombreLargo.sheet}

        <BranchToggle
          open={open}
          what={folder.name}
          empty={empty}
          onPress={() => setOpen((value) => !value)}
        />
      </View>

      {open ? (
        <View style={styles.branch}>
          <Children
            workspaceId={folder.workspaceId}
            parentId={folder.id}
            tree={tree}
            onOpen={onOpen}
            depth={depth + 1}
          />
          {empty ? (
            <AppText
              variant="caption"
              tone="subtle"
              style={{
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: 7,
              }}
            >
              {t("drawer.emptyFolder")}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A list, and the things in it.
 *
 * The items are read only when the list is opened, and by this component and
 * not by the drawer: a hook cannot be called in a loop, and reading every item
 * of every list to draw a menu is a menu that takes a second to appear on a
 * phone with a few thousand rows in it.
 */
function ListBranch({
  list,
  onOpen,
}: {
  list: List;
  onOpen: (href: string) => void;
}) {
  /** The whole of this row's name on a long press, on the row's own press. */
  const nombreLargo = useLongPressText(list.title);

  const theme = useTheme();
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const { items } = useListItems(open ? list.id : undefined);

  const shown = items.slice(0, ITEMS_SHOWN);
  const left = items.length - shown.length;

  const pista = useA11yHint(
    t(pluralKey("lists.itemCount", list.itemCount), {
      count: list.itemCount,
    }),
  );

  return (
    <View>
      <View style={[styles.item, { gap: 2 }]}>
        <Pressable
          accessibilityRole="button"
          {...expandedProps(open)}
          accessibilityLabel={list.title}
          {...pista.props}
          onLongPress={nombreLargo.onLongPress}
          onPress={() => onOpen(`/(app)/list/${list.id}`)}
          style={({ pressed }) => [
            styles.item,
            styles.flex,
            {
              borderRadius: theme.radius.md,
              backgroundColor: pressed
                ? theme.colors.surfaceMuted
                : "transparent",
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: 7,
            },
          ]}
        >
          <Ionicons
            name={LIST_ICON[list.kind] ?? "list-outline"}
            size={15}
            color={theme.colors.textSubtle}
          />

                    <AppText variant="callout" numberOfLines={1} style={styles.flex}>
            {list.title}
          </AppText>
          {list.itemCount > 0 ? (
            <AppText variant="caption" tone="subtle">
              {list.itemCount}
            </AppText>
          ) : null}
        </Pressable>
        {pista.node}
        {nombreLargo.sheet}

        <BranchToggle
          open={open}
          what={list.title}
          empty={list.itemCount === 0}
          onPress={() => setOpen((value) => !value)}
        />
      </View>

      {open ? (
        <View style={styles.branch}>
          {shown.length === 0 ? (
            <AppText
              variant="caption"
              tone="subtle"
              style={{
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: 7,
              }}
            >
              {t("drawer.emptyList")}
            </AppText>
          ) : (
            shown.map((item) => (
              <ListItemRow
                key={item.id}
                item={item}
                onOpen={() =>
                  onOpen(
                    `/(app)/item/${item.externalId ?? item.id}?kind=${list.kind}&itemKey=${item.id}&itemId=${list.id}&title=${encodeURIComponent(item.title)}`,
                  )
                }
              />
            ))
          )}

          {left > 0 ? (
            <AppText
              variant="caption"
              tone="subtle"
              style={{
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: 6,
              }}
            >
              {t("drawer.andMore", { count: left })}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * One row of a list opened from the drawer, in its own component so the hint
 * hook is not called once per row inside a map.
 */
function ListItemRow({
  item,
  onOpen,
}: {
  item: ListItem;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  const pista = useA11yHint(t("drawer.opensItem"));

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.title}
        {...pista.props}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.item,
          {
            borderRadius: theme.radius.md,
            backgroundColor: pressed
              ? theme.colors.surfaceMuted
              : "transparent",
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: 6,
          },
        ]}
      >
        <View
          style={[
            styles.tick,
            {
              borderColor: item.completed
                ? theme.colors.accent
                : theme.colors.borderStrong,
              backgroundColor: item.completed
                ? theme.colors.accent
                : "transparent",
            },
          ]}
        />
        <AppText
          variant="caption"
          tone={item.completed ? "subtle" : "muted"}
          numberOfLines={1}
          style={[styles.flex, item.completed ? styles.done : null]}
        >
          {item.title}
        </AppText>
      </Pressable>
      {pista.node}
    </>
  );
}

/** The arrow that opens a branch, or says there is nothing to open. */
function BranchToggle({
  open,
  what,
  empty,
  onPress,
}: {
  open: boolean;
  what: string;
  empty: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  if (empty) {
    return <View style={styles.arrow} />;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        open
          ? t("drawer.hide", { name: what })
          : t("drawer.show", { name: what })
      }
      {...expandedProps(open)}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.arrow, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons
        name={open ? "chevron-down" : "chevron-forward"}
        size={16}
        color={theme.colors.textMuted}
      />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ the tree -- */

export type { SpacesTree } from "@/hooks/use-spaces-tree";
export { useSpacesTree } from "@/hooks/use-spaces-tree";

/**
 * Whether the menu is open, and who opens it.
 *
 * The button is in a header and the menu is at the left of the whole app, and
 * they are in different parts of the tree, so the flag lives between them. A
 * module-level `let` would also connect them and would also let one screen's
 * state leak into another, which only shows up when two things happen in the
 * wrong order.
 *
 * `wide` is passed in and not read from `window` here, so there is one answer to
 * "is this a wide layout" in the app and not one per hook that needs it.
 */
const DrawerContext = createContext<{
  open: boolean;
  setOpen: (value: boolean) => void;
  toggle: () => void;
}>({ open: false, setOpen: () => undefined, toggle: () => undefined });

export function DrawerProvider({
  wide,
  children,
}: {
  /** Whether there is room for the column to be there in the first place. */
  wide: boolean;
  children: React.ReactNode;
}) {
  // Open on a wide screen, closed on a phone. The same flag for both, because the
  // flag is "is the menu showing", and the two screens disagree about what the
  // answer should be before anybody has asked.
  const [open, setOpenState] = useState(wide);

  // The breakpoint owns the state only while it is moving. Growing the window
  // into a wide layout brings the column in, and shrinking it back out closes
  // the menu, because a column that is suddenly 146 px of a phone screen is the
  // push again and the push is supposed to start closed. In between, the person
  // owns it: collapse the drawer and drag the window a few pixels, and it stays
  // collapsed, because a panel that reopens itself while you are reading is a
  // panel you cannot get rid of.
  useEffect(() => {
    setOpenState(wide);
  }, [wide]);

  const setOpen = useCallback((value: boolean) => {
    setOpenState(value);
  }, []);

  const toggle = useCallback(() => {
    setOpenState((value) => !value);
  }, []);

  const value = useMemo(
    () => ({ open, setOpen, toggle }),
    [open, setOpen, toggle],
  );

  return (
    <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>
  );
}

export function useDrawer() {
  return useContext(DrawerContext);
}

/**
 * The button that opens and closes it.
 *
 * The same control in the five places it goes — a header on the right, or the
 * left of a screen's own title — so it is one component with one look and one
 * name, and a person recognises it everywhere they find it.
 *
 * It **toggles**, and it is the only way out of the menu on a wide screen. That
 * is why the hamburger is in the header of the screens that are not the three
 * destinations, and not only in those three: collapse the column and then walk
 * into an item, and a button that only existed on the tabs is a menu you cannot
 * open again from where you are standing.
 *
 * The glyph is the same either way, and that is deliberate. A hamburger that
 * turns into an X is a hamburger you have to look at twice to know what it does,
 * and the two states are also two things that a screen reader announces with two
 * different names for a button that does the same thing. What changes is what it
 * *says*: the label and the hint follow the state, and `expanded` is what tells a
 * screen reader it is a disclosure rather than a plain button.
 */
export function DrawerButton() {
  const theme = useTheme();
  const t = useTranslation();
  const { open, toggle } = useDrawer();

  const pista = useA11yHint(
    open ? t("drawer.closeHint") : t("drawer.openHint"),
  );

  return (
    <>
      <Pressable
        accessibilityRole="button"
        testID="drawer-button"
        accessibilityLabel={open ? t("drawer.close") : t("drawer.open")}
        {...expandedProps(open)}
        {...pista.props}
        onPress={toggle}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: pressed
              ? theme.colors.surfaceMuted
              : "transparent",
            borderRadius: theme.radius.pill,
          },
        ]}
      >
        <Ionicons name="menu" size={22} color={theme.colors.text} />
        {/*
          The dot, and why it is on this button and not on a card in the middle
          of the screen: the sync centre used to be one, and it said itself out
          loud on every visit whether anything had happened or not. By the third
          visit it was furniture. Here it only appears when there is genuinely
          something the app cannot do by itself, and the menu is already the way
          into everything else that needs looking at.
        */}
        <SyncBadge />
      </Pressable>
      {pista.node}
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: "row",
    // Y recorta. La app se sale por la derecha a proposito, y sin esto la pagina
    // crece a 714 en un movil de 430 y sale una barra de scroll horizontal: el
    //menu empujando te dejaader arrastrar la pantalla de lado.
    overflow: "hidden",
  },
  flex: {
    flex: 1,
  },
  app: {
    // Sin encogerse. `flex: 1` gana al ancho que se le pone, porque su base es 0,
    // asi que la app se quedaba en lo que le sobraba —146 px— en vez de salirse
    // por la derecha. Lo que se quiere es que mida lo mismo que la pantalla y que
    // su derecha se salga, no que se encoja para caber.
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
  },
  // The other half of `app`, for a wide screen where the app is not pushed: it
  // takes the width the column is not using, and it changes it when the column
  // is collapsed. `flexGrow: 1` with a `0` basis and no `flexShrink`, which is
  // what the opposite rule above is undoing — there the app must keep its width
  // and be allowed off the screen, and here there is no off the screen to be.
  appWide: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
  },
  column: {
    overflow: "hidden",
  },
  columnInner: {
    flex: 1,
  },
  panel: {
    flex: 1,
    // The panel's own right-hand edge, so the column reads as a column and not as
    // a tint over whatever happens to be behind it. The same hairline in both
    // placements.
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 34,
  },
  arrow: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  branch: {
    paddingLeft: 14,
  },
  tick: {
    width: 11,
    height: 11,
    borderRadius: 3,
    borderWidth: 1.5,
  },
  done: {
    textDecorationLine: "line-through",
  },
  button: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -8,
    // The dot is absolutely positioned inside this, and a button without a
    // position is not a containing block for one: the dot would land on the
    // screen's own corner instead of the button's.
    position: "relative",
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
    marginHorizontal: 8,
  },
});
