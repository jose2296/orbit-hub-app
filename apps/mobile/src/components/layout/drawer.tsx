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

import type { Folder, List, Workspace } from "@orbit-hub/contracts";

import { AppText } from "@/components/ui/text";
import { useListItems } from "@/hooks/use-lists";
import { useSyncStatus } from "@/hooks/use-sync-status";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { colorOf } from "@/lib/workspace/color";
import { useTheme } from "@/theme";

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
  const closeLabel = t("drawer.closeByTapping");

  // Three quarters of the screen, so the strip left over is enough to recognise
  // the screen you interrupted and to tap to come back.
  const drawerWidth = Math.min(320, Math.round(width * 0.75));
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

  const columnWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, drawerWidth],
  });

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

      <View style={styles.flex}>
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
      </ScrollView>
    </View>
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

  return (
    <View>
      <View style={[styles.item, { gap: 2 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={workspace.name}
          accessibilityHint={t(
            pluralKey("workspaces.members", workspace.memberCount),
            { count: workspace.memberCount },
          )}
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
        </Pressable>

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

  return (
    <View>
      <View style={[styles.item, { gap: 2 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={folder.name}
          accessibilityHint={t("drawer.opensFolder")}
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

  return (
    <View>
      <View style={[styles.item, { gap: 2 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={list.title}
          accessibilityHint={t(pluralKey("lists.itemCount", list.itemCount), {
            count: list.itemCount,
          })}
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
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                accessibilityHint={t("drawer.opensItem")}
                onPress={() =>
                  onOpen(
                    `/(app)/item/${item.externalId ?? item.id}?kind=${list.kind}&itemKey=${item.id}&itemId=${list.id}&title=${encodeURIComponent(item.title)}`,
                  )
                }
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

export interface SpacesTree {
  foldersOf: (workspaceId: string, parentId: string | null) => Folder[];
  listsOf: (workspaceId: string, parentId: string | null) => List[];
  isEmpty: (workspaceId: string) => boolean;
  isFolderEmpty: (folderId: string) => boolean;
}

/**
 * Every folder and every list, grouped by where they hang.
 *
 * One read of the cache and then lookups by parent, so opening a folder three
 * levels down costs a lookup and not another read. A folder's own lists are the
 * ones whose `folderId` is that folder, and a space's are the ones with no
 * folder at all.
 */
export function useSpacesTree(): SpacesTree {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [lists, setLists] = useState<List[]>([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const [{ readAllCachedFolders }, localStore] = await Promise.all([
        import("@/lib/offline/sync-service"),
        import("@/lib/offline/local-store"),
      ]);

      const store = await localStore.getLocalStoreReady();
      const [folderRows, listRows] = await Promise.all([
        readAllCachedFolders(),
        store.listCached("list"),
      ]);

      const listRecords = listRows
        .map((row) => {
          try {
            return JSON.parse(row.payload) as List;
          } catch {
            return null;
          }
        })
        .filter(
          (row): row is List =>
            Boolean(row) && (row as List).deletedAt === null,
        );

      if (!active) return;
      setFolders(folderRows);
      setLists(listRecords);
    };

    void load();

    let unsubscribe: (() => void) | undefined;
    void import("@/lib/offline/local-store").then((m) => {
      // Suscrito *despues* de la primera lectura, con un import dinamico de por
      // medio, se pierde lo que se escriba entre medias. Y la sincronizacion
      // escribe fila a fila: la primera lectura caia a mitad, la carpeta de
      // primer nivel llegaba y la de segundo no, y como no hubo aviso después no
      // se releía nunca. Un menú que muestra un árbol a medias es un menú que
      // miente sobre lo que tienes.
      if (!active) return;
      unsubscribe = m.subscribeToLocalStore(() => void load());
      // Y al suscribirse otra vez: lo que se escribió antes de suscribirse
      // tampoco lo hemos visto.
      void load();
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return useMemo<SpacesTree>(() => {
    const key = (workspaceId: string, parentId: string | null) =>
      `${workspaceId}:${parentId ?? "root"}`;

    const foldersByParent = new Map<string, Folder[]>();
    const listsByParent = new Map<string, List[]>();
    // Cuantas cosas cuelgan *directamente* de cada carpeta. Una cuenta y no un
    // recorrido: preguntar si una carpeta esta vacia es preguntarlo una vez por
    // cada fila del menu, y recorrer el arbol entero en cada pregunta es un menu
    // que tarda en abrirse.
    const childCount = new Map<string, number>();
    const bump = (id: string) =>
      childCount.set(id, (childCount.get(id) ?? 0) + 1);

    for (const folder of folders) {
      const parentKey = key(folder.workspaceId, folder.parentId);
      if (!foldersByParent.has(parentKey)) foldersByParent.set(parentKey, []);
      foldersByParent.get(parentKey)!.push(folder);
      if (folder.parentId) bump(folder.parentId);
    }

    for (const list of lists) {
      const parentKey = key(list.workspaceId, list.folderId);
      if (!listsByParent.has(parentKey)) listsByParent.set(parentKey, []);
      listsByParent.get(parentKey)!.push(list);
      if (list.folderId) bump(list.folderId);
    }

    const byName = (rows: Folder[]) =>
      [...rows].sort((one, two) => one.name.localeCompare(two.name));
    const byTitle = (rows: List[]) =>
      [...rows].sort((one, two) => one.title.localeCompare(two.title));

    const foldersOf = (workspaceId: string, parentId: string | null) =>
      byName(foldersByParent.get(key(workspaceId, parentId)) ?? []);
    const listsOf = (workspaceId: string, parentId: string | null) =>
      byTitle(listsByParent.get(key(workspaceId, parentId)) ?? []);

    return {
      foldersOf,
      listsOf,
      isEmpty: (workspaceId) =>
        (foldersByParent.get(key(workspaceId, null))?.length ?? 0) === 0 &&
        (listsByParent.get(key(workspaceId, null))?.length ?? 0) === 0,
      isFolderEmpty: (folderId) => (childCount.get(folderId) ?? 0) === 0,
    };
  }, [folders, lists]);
}

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

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("drawer.open")}
      accessibilityHint={t("drawer.openHint")}
      onPress={() => setOpen(true)}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed ? theme.colors.surfaceMuted : "transparent",
          borderRadius: theme.radius.pill,
        },
      ]}
    >
      <Ionicons name="menu" size={22} color={theme.colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: "row",
  },
  flex: {
    flex: 1,
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
