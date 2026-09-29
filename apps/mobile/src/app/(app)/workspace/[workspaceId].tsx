import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { Folder, List } from "@orbit-hub/contracts";

import { CreateSheet } from "@/components/folders/create-sheet";
import type { CreateKind } from "@/components/folders/create-sheet";
import { FolderBrowser } from "@/components/folders/folder-browser";
import { FolderMenuSheet } from "@/components/folders/folder-menu-sheet";
import { FloatingButton } from "@/components/ui/floating-button";
import { ListMenuSheet } from "@/components/lists/list-menu-sheet";
import { Screen } from "@/components/ui/screen";
import { AppText } from "@/components/ui/text";
import { SpaceWash } from "@/components/ui/wash";
import { spacePaint } from "@/lib/workspace/color";
import { useFolders, useWorkspaces } from "@/hooks/use-workspaces";
import { WorkspaceMenuSheet } from "@/components/workspace/workspace-menu-sheet";
import { useDashboard } from "@/hooks/use-dashboard";
import {
  isFolderPinned,
  withPinnedFolder,
  withoutPinnedFolder,
} from "@/lib/dashboard/pin";
import { useLists } from "@/hooks/use-lists";
import { useNotes } from "@/hooks/use-notes";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * A space, seen as a folder.
 *
 * The space is the root of the tree, so this screen and the one inside a folder
 * are the same screen with a different folder. Everything that can live in a
 * space lives in one of its folders, and the button in the corner is how all of
 * it is created, in the same three gestures wherever you are.
 */
export default function WorkspaceScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>();

  const { workspaces } = useWorkspaces();
  const { folders, isLoading, createFolder } = useFolders(workspaceId);
  const { layout, save } = useDashboard();

  /** Whether a folder already has a card, so the menu can say "take it off". */
  const folderOnPanel = useCallback(
    (folderId: string) => isFolderPinned(layout, folderId),
    [layout],
  );
  const { lists, createList } = useLists({ workspaceId });
  const { createNote } = useNotes({ workspaceId });

  const [menuFor, setMenuFor] = useState<
    { kind: "folder"; folder: Folder } | { kind: "list"; list: List } | null
  >(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<"what" | "details">("what");
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [title, setTitle] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );

  /**
   * The colours of the text that goes on the band.
   *
   * Asked for from the space and not from the theme, and that is the whole point
   * of a band in the colour of the space: theme text on a space colour is dark
   * text on a dark space half the time. The accent has no say in it either — a
   * space is a category and the accent means "this is the action".
   */
  // The second colour goes with it because it is the person's own choice, and a
  // band that drops it paints a different pair from the one the picker shows.
  const onWash = spacePaint(workspace?.color, workspace?.wash, workspace?.colorTo);

  useScreenTitle(workspace?.name ?? t("workspaces.title"));

  /** The folder a list lives in, for the menu to say where it is. */
  const folderOf = (list: List) =>
    folders.find((folder) => folder.id === list.folderId) ?? null;

  /** How many lists are inside a folder, for the delete to say what it takes. */
  const folderListCount = (folder: Folder | null) =>
    folder ? lists.filter((list) => list.folderId === folder.id).length : 0;

  const closeSheets = useCallback(() => {
    setMenuFor(null);
    setMenuOpen(false);
    setCreateOpen(false);
    setCreateStep("what");
    setCreateKind(null);
    setTitle("");
  }, []);

  const onCreate = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || !workspaceId) return;
    if (createKind === "folder") {
      await createFolder({ name: trimmed, parentId: null });
    } else if (createKind === "note") {
      // Written locally and opened straight away: the note is in the cache from
      // this moment, so there is nothing to wait for.
      const noteId = await createNote({
        workspaceId,
        folderId: null,
        title: trimmed,
      });
      closeSheets();
      router.push({ pathname: "/note/[noteId]", params: { noteId } });
      return;
    } else if (createKind) {
      await createList({
        workspaceId,
        folderId: null,
        title: trimmed,
        kind: createKind,
      });
    }
    closeSheets();
  }, [
    closeSheets,
    createFolder,
    createList,
    createNote,
    createKind,
    router,
    title,
    workspaceId,
  ]);

  if (!workspaceId) {
    return (
      <Screen>
        <AppText variant="body">{t("workspaces.notFound")}</AppText>
      </Screen>
    );
  }

  return (
    <Screen>
      {/*
        The band with the name of the space on it, in the colour of the space.

        It is here and not only in the menu because everything below it is *of*
        that space: the folders, the lists inside them, the items in those. A band
        in the colour of the space is what makes that obvious at a glance, and it
        is the same gradient the cards on the panel are painted with, so a space
        looks the same everywhere it appears.
      */}
      <SpaceWash
        colorKey={workspace?.color}
        // The end colour too, for the same reason as the text above: the wash
        // and the text on it are one decision about a pair the person picked.
        colorToKey={workspace?.colorTo}
        wash={workspace?.wash}
        radius={theme.radius.lg}
        style={[
          styles.band,
          { padding: theme.spacing.lg, gap: theme.spacing.sm },
        ]}
      >
        <View style={[styles.bandTop, { gap: theme.spacing.md }]}>
          <AppText variant="title" style={[styles.flex, { color: onWash.foreground }]}>
            {workspace?.emoji ? `${workspace.emoji} ` : ""}
            {workspace?.name ?? t("workspaces.title")}
          </AppText>
          {/* The menu of the space is on the band rather than in the row below
              it, so the control that belongs to the space is drawn on the space
              and not floating next to it. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("workspaceMenu.open")}
            hitSlop={8}
            onPress={() => setMenuOpen(true)}
            style={({ pressed }) => [
              styles.more,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Ionicons
              name="ellipsis-horizontal"
              size={18}
              color={onWash.foreground}
            />
          </Pressable>
        </View>

        {workspace?.description ? (
          <AppText
            variant="callout"
            numberOfLines={2}
            style={{ color: onWash.muted }}
          >
            {workspace.description}
          </AppText>
        ) : null}

        <View style={[styles.bandMeta, { gap: theme.spacing.sm }]}>
          {/* The role is a fact about who can change things, and it is written on
              the colour of the space rather than in the accent: the accent means
              "this is the action", and a role is not an action. */}
          <View
            style={[
              styles.badge,
              { borderRadius: theme.radius.md, backgroundColor: onWash.wash },
            ]}
          >
            <AppText variant="caption" style={{ color: onWash.foreground }}>
              {t(`workspaces.role.${workspace?.role ?? "viewer"}` as never)}
            </AppText>
          </View>
          <AppText variant="caption" style={{ color: onWash.muted }}>
            {t(pluralKey("workspaces.members", workspace?.memberCount ?? 0), {
              count: workspace?.memberCount ?? 0,
            })}
          </AppText>
        </View>
      </SpaceWash>



      <WorkspaceMenuSheet
        workspace={menuOpen ? workspace : null}
        onClose={closeSheets}
        onDeleted={() => router.replace("/(app)/workspaces")}
      />

      <FolderBrowser
        workspaceId={workspaceId}
        folderId={null}
        folders={folders}
        lists={lists}
        isLoading={isLoading}
        colorKey={workspace?.color}
        // Los dos colores y el sentido, o este sitio pinta un par distinto del que
        // ensena el selector: la banda de arriba con el elegido y las filas con el
        // derivado, en la misma pantalla.
        wash={workspace?.wash}
        colorTo={workspace?.colorTo}
        onFolderMenu={(folder) => setMenuFor({ kind: "folder", folder })}
        onListMenu={(list) => setMenuFor({ kind: "list", list })}
      />

      <ListMenuSheet
        list={menuFor?.kind === "list" ? menuFor.list : null}
        folder={menuFor?.kind === "list" ? folderOf(menuFor.list) : null}
        onClose={closeSheets}
      />

      <FolderMenuSheet
        folder={menuFor?.kind === "folder" ? menuFor.folder : null}
        workspaceId={workspaceId}
        listCount={folderListCount(
          menuFor?.kind === "folder" ? menuFor.folder : null,
        )}
        onPanel={
          menuFor?.kind === "folder"
            ? folderOnPanel(menuFor.folder.id)
            : false
        }
        onTogglePin={() => {
          const folder =
            menuFor?.kind === "folder"
              ? (folders.find((row) => row.id === menuFor.folder.id) ?? null)
              : null;
          if (!folder) return;
          void save(
            isFolderPinned(layout, folder.id)
              ? withoutPinnedFolder(layout, folder.id)
              : withPinnedFolder(layout, folder),
          );
        }}
        onClose={closeSheets}
        onCreateInside={(kind) => {
          setMenuFor(null);
          setCreateKind(kind);
          setCreateStep("details");
          setCreateOpen(true);
        }}
      />

      <CreateSheet
        open={createOpen}
        onClose={closeSheets}
        subtitle={workspace?.name}
        step={createStep}
        onStep={setCreateStep}
        kind={createKind}
        onKind={setCreateKind}
        title={title}
        onTitle={setTitle}
        onCreate={() => void onCreate()}
        creating={false}
      />

      <FloatingButton onPress={() => setCreateOpen(true)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  band: {
    width: "100%",
  },
  bandTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  bandMeta: {
    flexDirection: "row",
    alignItems: "center",
  },
  more: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});
