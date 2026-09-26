import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { Folder, List } from "@orbit-hub/contracts";

import { CreateSheet } from "@/components/folders/create-sheet";
import type { CreateKind } from "@/components/folders/create-sheet";
import { FolderBrowser } from "@/components/folders/folder-browser";
import { FolderMenuSheet } from "@/components/folders/folder-menu-sheet";
import { FloatingCreateButton } from "@/components/folders/floating-create-button";
import { ListMenuSheet } from "@/components/lists/list-menu-sheet";
import { Screen } from "@/components/ui/screen";
import { AppText } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { useFolders, useWorkspaces } from "@/hooks/use-workspaces";
import { useLists } from "@/hooks/use-lists";
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

  const { workspaces, deleteWorkspace } = useWorkspaces();
  const { folders, isLoading, createFolder } = useFolders(workspaceId);
  const { lists, createList } = useLists({ workspaceId });

  const [menuFor, setMenuFor] = useState<
    { kind: "folder"; folder: Folder } | { kind: "list"; list: List } | null
  >(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<"what" | "details">("what");
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [title, setTitle] = useState("");

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );

  useScreenTitle(workspace?.name ?? t("workspaces.title"));

  /** The folder a list lives in, for the menu to say where it is. */
  const folderOf = (list: List) =>
    folders.find((folder) => folder.id === list.folderId) ?? null;

  /** How many lists are inside a folder, for the delete to say what it takes. */
  const folderListCount = (folder: Folder | null) =>
    folder ? lists.filter((list) => list.folderId === folder.id).length : 0;

  const closeSheets = useCallback(() => {
    setMenuFor(null);
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
    } else if (createKind && createKind !== "note") {
      // 'note' is greyed out in the panel, so it only arrives from a future
      // build; it is not a kind of list and must not be written as one.
      await createList({
        workspaceId,
        folderId: null,
        title: trimmed,
        kind: createKind,
      });
    }
    closeSheets();
  }, [closeSheets, createFolder, createList, createKind, title, workspaceId]);

  if (!workspaceId) {
    return (
      <Screen>
        <AppText variant="body">{t("workspaces.notFound")}</AppText>
      </Screen>
    );
  }

  return (
    <Screen>
      {workspace ? (
        <View style={[styles.meta, { gap: theme.spacing.sm }]}>
          <View
            style={[
              styles.badge,
              {
                backgroundColor: theme.colors.accentSoft,
                borderRadius: theme.radius.md,
              },
            ]}
          >
            <AppText
              variant="caption"
              style={{ color: theme.colors.accentSoftText }}
            >
              {t(`workspaces.role.${workspace.role}` as never)}
            </AppText>
          </View>
          <AppText variant="caption" tone="muted">
            {t(pluralKey("workspaces.members", workspace.memberCount), {
              count: workspace.memberCount,
            })}
          </AppText>
        </View>
      ) : null}

      <FolderBrowser
        workspaceId={workspaceId}
        folderId={null}
        folders={folders}
        lists={lists}
        isLoading={isLoading}
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

      <FloatingCreateButton onPress={() => setCreateOpen(true)} />

      {workspace ? (
        <Card variant="outlined" style={{ gap: theme.spacing.md }}>
          <AppText variant="callout" tone="muted">
            {t("workspaces.dangerZone")}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("workspaces.delete")}
            onPress={() => {
              void deleteWorkspace(workspace);
              router.replace("/(app)/workspaces");
            }}
            style={({ pressed }) => [
              styles.dangerRow,
              {
                backgroundColor: theme.colors.dangerSoft,
                borderRadius: theme.radius.md,
                padding: theme.spacing.md,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Ionicons
              name="trash-outline"
              size={18}
              color={theme.colors.danger}
            />
            <AppText variant="body" tone="danger">
              {t("workspaces.delete")}
            </AppText>
          </Pressable>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: {
    flexDirection: "row",
    alignItems: "center",
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dangerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
});
