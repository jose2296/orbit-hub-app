import { useMemo, useState } from "react";
import { View } from "react-native";

import type { ListKind } from "@orbit-hub/contracts";

import { useFolders } from "@/hooks/use-workspaces";
import { LIST_KIND_LABEL, LIST_KIND_ORDER } from "@/lib/lists/kind";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

import { ConfirmSheet, RenameSheet } from "../ui/rename-sheet";
import { Sheet, SheetOptions } from "../ui/sheet";
import type { SheetOption } from "../ui/sheet";

export interface FolderMenuSheetProps {
  /** The folder the menu is for, or `null` when it is closed. */
  folder: {
    id: string;
    name: string;
    parentId: string | null;
    version: number;
  } | null;
  /** The space it is in, which is where its lists go when the folder goes. */
  workspaceId: string | undefined;
  /** How many lists are inside, so the delete says what goes with it. */
  listCount: number;
  onClose: () => void;
  /** Opens the create panel already set to this folder and this kind. */
  onCreateInside: (kind: ListKind) => void;
}

/**
 * What can be done with a folder.
 *
 * A folder is a place and not a record of anything, so it has fewer actions
 * than a list: it can be renamed, it can have a new list put inside it, and it
 * can go away. It cannot be duplicated, because a copy of a place is another
 * place with nothing in it and nobody has ever wanted one.
 *
 * Deleting a folder does not delete what is inside. The lists in it are the
 * work, and losing a folder because it was in the wrong place would throw away
 * everything in it; they move up to the space, which is where they would have
 * been had the folder never existed.
 */
export function FolderMenuSheet({
  folder,
  workspaceId,
  listCount,
  onClose,
  onCreateInside,
}: FolderMenuSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const { updateFolder, deleteFolder } = useFolders(workspaceId);

  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creatingKind, setCreatingKind] = useState<ListKind | null>(null);

  /** A sub-panel of this menu is open, so the options are not the whole story. */
  const inside = renaming || confirmDelete || creatingKind !== null;

  const createOptions: SheetOption[] = useMemo(
    () =>
      LIST_KIND_ORDER.map((kind): SheetOption => ({
        key: kind,
        label: t(LIST_KIND_LABEL[kind]),
        onPress: () => {
          onCreateInside(kind);
        },
      })),
    [onCreateInside, t],
  );

  if (!folder) return null;

  return (
    <>
      <Sheet
        visible={!inside}
        onClose={onClose}
        title={folder.name}
        subtitle={t("folders.whatItHolds", { count: listCount })}
        scrollable={false}
      >
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.sm,
          }}
        >
          <SheetOptions
            options={[
              {
                key: "new-list",
                label: t("lists.createHere"),
                icon: "add-circle-outline",
                onPress: () => setCreatingKind("tasks"),
              },
              {
                key: "rename",
                label: t("common.rename"),
                icon: "create-outline",
                onPress: () => setRenaming(true),
              },
              {
                key: "delete",
                label: t("common.delete"),
                icon: "trash-outline",
                tone: "danger",
                description: t("lists.deleteFolderBody"),
                onPress: () => setConfirmDelete(true),
              },
            ]}
          />
        </View>
      </Sheet>

      <Sheet
        visible={creatingKind !== null}
        onClose={() => setCreatingKind(null)}
        title={t("lists.createHere")}
        subtitle={folder.name}
        scrollable={false}
      >
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.sm,
          }}
        >
          <SheetOptions options={createOptions} />
        </View>
      </Sheet>

      <RenameSheet
        visible={renaming}
        title={t("folders.whatTheyAre")}
        value={folder.name}
        onClose={() => {
          setRenaming(false);
          onClose();
        }}
        onRename={(name) => void updateFolder(folder, { name })}
      />

      <ConfirmSheet
        visible={confirmDelete}
        title={t("folders.deleteTitle", { what: folder.name })}
        description={t("lists.deleteFolderBody")}
        confirmLabel={t("folders.deleteConfirm")}
        onClose={() => {
          setConfirmDelete(false);
          onClose();
        }}
        onConfirm={() => void deleteFolder(folder)}
      />
    </>
  );
}
