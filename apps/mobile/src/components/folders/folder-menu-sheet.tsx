import { useMemo, useState } from "react";
import { View } from "react-native";

import type { ListKind } from "@orbit-hub/contracts";

import { ShareNodeForm } from "@/components/shares/share-node-sheet";
import { SharedBadge } from "@/components/shares/shared-badge";
import { useFolders } from "@/hooks/use-workspaces";
import { LIST_KIND_LABEL, LIST_KIND_ORDER } from "@/lib/lists/kind";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

import { ConfirmSheet, RenameSheet } from "../ui/rename-sheet";
import { Sheet, SheetOptions, useLastValue } from "../ui/sheet";
import type { SheetOption } from "../ui/sheet";

export interface FolderMenuSheetProps {
  folder: {
    id: string;
    name: string;
    parentId: string | null;
    version: number;
    emoji?: string | null;
    role: "owner" | "editor" | "viewer";
    shared: boolean;
  } | null;
  workspaceId: string | undefined;
  listCount: number;
  onPanel?: boolean;
  onTogglePin?: () => void;
  onClose: () => void;
  onCreateInside: (kind: ListKind) => void;
}

/**
 * What can be done with a folder.
 *
 * A folder is a place and not a record of anything, so it has fewer actions
 * than a list: it can be renamed, it can have a new list put inside it, it can be
 * put on the panel, and it can go away. It cannot be duplicated, because a copy of
 * a place is another place with nothing in it and nobody has ever wanted one.
 *
 * "Put it on the panel" is here and not only on the home screen, because that is
 * where somebody is *looking at* a folder. Reaching the panel to find a folder,
 * and only then finding the option to pin it, is two steps where one was obvious.
 *
 * Deleting a folder does not delete what is inside. The lists in it are the
 * work, and losing a folder because it was in the wrong place would throw away
 * everything in it; they move up to the space, which is where they would have
 * been had the folder never existed.
 */
export function FolderMenuSheet({
  folder: pedido,
  workspaceId,
  listCount,
  onPanel = false,
  onTogglePin,
  onClose,
  onCreateInside,
}: FolderMenuSheetProps) {
  /*
    `folder` is **the last one, and not the one the caller is holding** — and that
    difference is the whole fix.

    A sheet of options was written as `if (!folder) return null`: the caller says the
    menu is closed by handing over nothing, and the component does the obvious thing
    with nothing — which takes the sheet, and the exit it is in the middle of, out
    of the tree on the very frame the dismissal is asked for. Measured on the web,
    the panel was gone **forty-five milliseconds** after the cross, and the quarter
    of a second it was supposed to travel down was never on screen.

    So the value that is drawn is the last one there was — declared here, at the
    top, so that everything below keeps the name it always had and now has a value
    that cannot be null — and the caller's own argument, which goes to `null` at
    once, is what `visible` is asked from. The panel keeps its identity while it
    leaves, and the dismissal is a movement instead of a cut.
  */
  /*
    `folder` is **the last one, and not the one the caller is holding** — and that
    difference is the whole fix.

    A sheet of options was written as `if (!folder) return null`: the caller says the
    menu is closed by handing over nothing, and the component does the obvious thing
    with nothing — which takes the sheet, and the exit it is in the middle of, out
    of the tree on the very frame the dismissal is asked for. Measured on the web,
    the panel was gone **forty-five milliseconds** after the cross, and the quarter
    of a second it was supposed to travel down was never on screen.

    So the value that is drawn is the last one there was, and the caller's own
    argument — which goes to `null` at once, because that is how a caller says "close"
    — is what `visible` is asked from. The panel keeps its identity while it leaves,
    and the dismissal is a movement instead of a cut.

    **The prop keeps its name and only the local is new.** Renaming what the caller
    passes would be six call sites later, for a change nobody outside this file can
    see.
  */
  const folder = useLastValue(pedido);

  const theme = useTheme();
  const t = useTranslation();
  const { updateFolder, deleteFolder } = useFolders(workspaceId);

  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creatingKind, setCreatingKind] = useState<ListKind | null>(null);
  const [sharing, setSharing] = useState(false);

  const inside = renaming || confirmDelete || creatingKind !== null || sharing;

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

  const options: SheetOption[] = useMemo(
    () => [
      {
        key: "new-list",
        label: t("lists.createHere"),
        icon: "add-circle-outline",
        onPress: () => setCreatingKind("tasks"),
      },
      // Only offered when somebody wired it up. The menu is also used where the
      // panel is not in play, and an option that silently does nothing is worse
      // than an option that is not there.
      ...(onTogglePin
        ? [
            {
              key: "pin",
              label: onPanel
                ? t("dashboard.takeOffPanel")
                : t("dashboard.putOnPanel"),
              icon: (onPanel
                ? "remove-circle-outline"
                : "apps-outline") as SheetOption["icon"],
              // The menu closes: the panel is a different screen, and staying open
              // over a screen that just changed somewhere else is disorienting.
              onPress: () => {
                onTogglePin();
                onClose();
              },
            },
          ]
        : []),
      {
        key: "rename",
        label: t("common.rename"),
        icon: "create-outline",
        onPress: () => setRenaming(true),
      },
      // Only the owner of the space may hand it on. See `canShare` in
      // `apps/api/src/modules/shares/access.ts`: an editor of the space can write
      // in it, and the folder belongs to whoever owns it, so `editor` here meant
      // the owner could not take back what an editor shared.
      ...(folder && folder.role === "owner"
        ? [
            {
              key: "share",
              label: t("share.pickSomeone"),
              icon: "people-outline" as const,
              description: t("share.isALink"),
              onPress: () => setSharing(true),
            },
          ]
        : []),
      {
        /*
         * A folder you were lent is not yours to erase: the delete is global and would
         * take it from whoever made it. Same rule as the note, the list and the space.
         */
        key: "delete",
        label: folder?.shared ? t("common.deleteNotYours") : t("common.delete"),
        icon: "trash-outline",
        tone: "danger",
        description: folder?.shared
          ? t("common.deleteNotYoursHint")
          : t("lists.deleteFolderBody"),
        disabled: folder?.shared,
        onPress: () => setConfirmDelete(true),
      },
    ],
    [onClose, onPanel, onTogglePin, t],
  );

  if (!folder) return null;

  return (
    <>
      <Sheet
        visible={pedido !== null && !inside}
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
          <SharedBadge shared={folder.shared} role={folder.role} />
          <SheetOptions options={options} />
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

      <Sheet
        visible={sharing}
        onClose={() => setSharing(false)}
        title={folder.name}
        subtitle={t("share.subtitle", { name: folder.name })}
        scrollable
      >
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.sm,
          }}
        >
          <ShareNodeForm
            target={{
              nodeType: "folder",
              nodeId: folder.id,
              title: folder.name,
            }}
            onDone={() => {
              setSharing(false);
              onClose();
            }}
          />
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
