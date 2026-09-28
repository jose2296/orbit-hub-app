import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import {
  createContext,
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
import { useA11yHint } from "@/components/ui/a11y-hint";
import { AppText } from "@/components/ui/text";
import { useListItems } from "@/hooks/use-lists";
import { useShares } from "@/hooks/use-shares";
import { useSpacesTree } from "@/hooks/use-spaces-tree";
import { useSyncStatus } from "@/hooks/use-sync-status";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { colorOf } from "@/lib/workspace/color";
import { useTheme } from "@/theme";

import type { SpacesTree } from "@/hooks/use-spaces-tree";

const DESTINATIONS = [
  { route: "/(app)/(tabs)", icon: "home", labelKey: "tabs.home" },
  { route: "/(app)/(tabs)/search", icon: "search", labelKey: "tabs.search" },
  {
    route: "/(app)/(tabs)/settings",
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
 * The menu of the left, and on a phone it *pushes* the app instead of covering
 * it.
 *
 * A push and not a curtain: the menu comes in from the left and the screen
 * moves to the right, so the app you were looking at is still there, still lit,
 * and one tap away. A drawer that covers what you opened it to see is a drawer
 * you have to close again before you learn anything, and a curtain over a screen
 * you are in a hurry to leave is one more thing between you and the thing you
 * came for.
 *
 * That also means the menu is not a modal. It is part of the app, always
 * mounted, sliding — so it is there in a frame when you tap the button instead
 * of appearing out of nothing, and a screen reader is in it before you ask.
 *
 * It is a file tree: a space, its folders inside folders as deep as they go, the
 * lists in the folder they are in, and the items in their list. A menu that
 * lists a space and stops there makes you go in, look, come back and go into the
 * other one: four taps to reach a film that is in the second folder of the
 * second list.
 */
export function Drawer({ children }: { children: React.ReactNode }) {
  const t = useTranslation();
  const { width } = useWindowDimensions();
  const { open, setOpen } = useDrawer();
  // Empuja siempre. Se midio que en un movil deja 146 px de app y que ahi los
  // nombres de los items no caben, y la respuesta fue que se quiere el empuje de
  // todos modos: se cambia entonces lo que se rompe, que es la fila al estrecharse
  // (ver `degrada`), y no el empuje.
  const push = true;
  const closeLabel = t("drawer.closeByTapping");

  // Two thirds, and medido: con tres cuartos la app se quedaba en 110 px de un
  // movil de 430, y en 90 de uno de 360. Una franja de 110 px no reconoce la
  // pantalla que interrumpes, y las filas se salen de ella.
  //
  // Que aun asi no haya una respuesta buena aqui: en un movil de 430, un menu de
  // 284 deja 146 de app, y 146 tampoco se lee. O el menu tapa, o la app se
  // estrecha de mas, y las dos son故答案为. En un movil el menu deberia tapar y
  // empujar solo en pantallas anchas, que es lo de la app vieja; esto es el
  // compromiso hasta que se decida, y esta medido para que se pueda decidir con
  // numeros y no de memoria.
  // Covering: the menu takes most of the screen because there is nothing to see
  // behind it. Pushing: a strip, so the screen you interrupted is still a screen.
  const drawerWidth = Math.min(288, Math.round(width * 0.66));
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

  // When the menu covers, the column it would push with is always zero: the app
  // is never narrowed, and what moves is the menu itself over the top of it.
  const columnWidth = push
    ? progress.interpolate({ inputRange: [0, 1], outputRange: [0, drawerWidth] })
    : 0;

  return (
    <View style={styles.root}>
      {/*
        The menu takes the space it needs and the app takes the rest, in a row.
        So the app really is pushed: it is narrower and to the right, and every
        pixel of it is still on the screen.

        Sliding the app sideways instead — a transform — was the obvious thing
        and it is wrong twice over: the app goes off the right edge, and it ends
        up *over* the menu, so the last thing in the menu, the arrow that opens
        a space, ends up under the screen you were reading.
      */}
      <Animated.View style={[styles.column, { width: columnWidth }]}>
        {/* A fixed width inside, so the lines of the menu do not re-wrap sixty
            times while the column grows. */}
        <View style={[styles.columnInner, { width: drawerWidth }]}>
          <DrawerPanel onNavigate={() => setOpen(false)} />
        </View>
      </Animated.View>

      {/*
        `minWidth: 0` y no es un detalle. Un hijo de un `flex` no baja de su
        contenido por defecto, y con el menu abierto la app se negaba a
        estrecharse: las filas seguian midiendo 366 px dentro de una columna de
        284, y lo que se veia era una franja de 146 px de una pantalla entera.
        Eso es lo de "se queda todo en una linea fea", y no era un problema de
        ancho del menu.
      */}
      <View
        testID="drawer-app"
        style={[
          styles.app,
          {
            // Su propio ancho, siempre, y no el que le sobra: al empujar, la app
            // se desplaza y su derecha se sale de la pantalla. Estrecharla es lo
            // que hacia que todo dentro se reordenara para caber en un trozo —la
            // fila apilada, la cabecera partida— y una app cortada se lee mejor
            // que una app encogida.
            width,
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, drawerWidth],
                }),
              },
            ],
          },
        ]}
      >
        {children}
        {/* It is there to be pressed and not to be seen: closing by tapping the
            screen you interrupted, which is what a push means. */}
        {open ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            onPress={() => setOpen(false)}
            style={styles.scrim}
          />
        ) : null}
      </View>
    </View>
  );
}

/** The panel's contents. The same ones the wide screen shows in its column. */
export function DrawerPanel({ onNavigate }: { onNavigate?: () => void }) {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { workspaces } = useWorkspaces();
  const { status } = useSyncStatus();
  const tree = useSpacesTree();

  // What has been shared with this person and not filed yet. The section is in
  // the menu and not on its own screen because the thing to do with it is
  // one tap away from where you are already looking: a list that arrived in a
  // place you have to remember to visit is a list you never file.
  const { inbox, load: reloadInbox } = useShares();
  const [colocando, setColocando] = useState<Share | null>(null);

  useEffect(() => {
    void reloadInbox();
  }, [reloadInbox]);

  const go = (href: string) => {
    onNavigate?.();
    router.push(href as never);
  };

  return (
    <View
      testID="drawer-panel"
      style={{
        flex: 1,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 8,
      }}
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
          const focused = pathname === destination.route;
          const tint = focused ? theme.colors.accent : theme.colors.textMuted;
          return (
            <Pressable
              key={destination.route}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
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

        {status.pendingOperations > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(
              pluralKey("drawer.pending", status.pendingOperations),
              { count: status.pendingOperations },
            )}
            onPress={() => go("/(app)/sync")}
            style={({ pressed }) => [
              styles.item,
              {
                borderRadius: theme.radius.md,
                backgroundColor: pressed
                  ? theme.colors.surfaceMuted
                  : theme.colors.accentSoft,
                marginTop: theme.spacing.xs,
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
          accessibilityState={{ expanded: open }}
          accessibilityLabel={workspace.name}
          {...pista.props}
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
          <View
            style={[styles.dot, { backgroundColor: colorOf(workspace.color) }]}
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
          accessibilityState={{ expanded: open }}
          accessibilityLabel={folder.name}
          {...pista.props}
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
          accessibilityState={{ expanded: open }}
          accessibilityLabel={list.title}
          {...pista.props}
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
      accessibilityState={{ expanded: open }}
      accessibilityLabel={
        open
          ? t("drawer.hide", { name: what })
          : t("drawer.show", { name: what })
      }
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
 */
const DrawerContext = createContext<{
  open: boolean;
  setOpen: (value: boolean) => void;
}>({ open: false, setOpen: () => undefined });

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return (
    <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>
  );
}

export function useDrawer() {
  return useContext(DrawerContext);
}

/**
 * The button that opens it.
 *
 * The same control in the five places it goes — a header on the right, or the
 * left of a screen's own title — so it is one component with one look and one
 * name, and a person recognises it everywhere they find it.
 */
export function DrawerButton() {
  const theme = useTheme();
  const t = useTranslation();
  const { setOpen } = useDrawer();

  const pista = useA11yHint(t("drawer.openHint"));

  return (
    <>
      <Pressable
        accessibilityRole="button"
        testID="drawer-button"
        accessibilityLabel={t("drawer.open")}
        {...pista.props}
        onPress={() => setOpen(true)}
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
  overMenu: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 20,
    // Un fondo opaco, y no solo cuando va en su propia capa. Empujado no hacia
    // falta: no habia nada detras. Tapado, sin el, se ven las dos pantallas a la
    // vez encima y las dos se leen mal.
  },
  column: {
    overflow: "hidden",
  },
  columnInner: {
    flex: 1,
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
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
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
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
    marginHorizontal: 8,
  },
});
