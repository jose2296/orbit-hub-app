import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import type { Workspace } from "@orbit-hub/contracts";

import { WorkspaceColorPicker } from "@/components/workspace/workspace-color-picker";
import { SharePanel } from "@/components/workspace/share-panel";
import { Button } from "../ui/button";
import { Sheet, SheetOptions } from "../ui/sheet";
import type { SheetOption } from "../ui/sheet";
import { AppText } from "../ui/text";
import { TextField } from "../ui/text-field";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useLists } from "@/hooks/use-lists";
import { useFolders } from "@/hooks/use-workspaces";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface WorkspaceMenuSheetProps {
  workspace: Workspace | null;
  onClose: () => void;
  /** Called after the space is gone, so the screen can go back somewhere. */
  onDeleted?: () => void;
}

type Page = "options" | "edit" | "share" | "delete";

/**
 * What can be done with a space.
 *
 * The same shape as the list menu and for the same reason: a menu that reads
 * differently in two places is two menus to learn. Renaming, sharing and
 * deleting are **pages of this panel** and not panels of their own, because a
 * panel on top of a panel is two backdrops over one screen and a tap that
 * reaches the wrong one closes what is underneath instead of doing what was
 * asked.
 *
 * Deleting a space is last, red, and it says how much goes with it: a list, a
 * folder and somebody's whole organisation of their things do not come back.
 */
export function WorkspaceMenuSheet({
  workspace,
  onClose,
  onDeleted,
}: WorkspaceMenuSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const { updateWorkspace, deleteWorkspace } = useWorkspaces();
  const { lists } = useLists(workspace ? { workspaceId: workspace.id } : {});
  const { folders } = useFolders(workspace?.id);

  const [page, setPage] = useState<Page>("options");
  const [name, setName] = useState(workspace?.name ?? "");

  // Reopening always starts at the options, whatever page it was left on.
  //
  // Keyed on the **id**, not on the object. Changing the name or the colour of a
  // space makes a new object with the same id, and watching the object meant that
  // every keystroke and every colour you picked threw you back to the options —
  // so the panel closed itself at the exact moment you were using it. The id is
  // what says "this is a different space".
  useEffect(() => {
    if (workspace) {
      setPage("options");
      setName(workspace.name);
    }
  }, [workspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const listCount = lists.length;
  const folderCount = folders.length;

  const options: SheetOption[] = useMemo(() => {
    if (!workspace) return [];
    return [
      {
        key: "edit",
        label: t("workspaceMenu.edit"),
        icon: "create-outline",
        description: t("workspaceMenu.editHint"),
        onPress: () => {
          setName(workspace.name);
          setPage("edit");
        },
      },
      {
        key: "share",
        label: t("workspaceMenu.share"),
        icon: "people-outline",
        description: t(
          pluralKey("workspaceMenu.shareHint", workspace.memberCount),
          {
            count: workspace.memberCount,
          },
        ),
        onPress: () => setPage("share"),
      },
      {
        key: "delete",
        label: t("common.delete"),
        icon: "trash-outline",
        tone: "danger",
        description: t(
          pluralKey("workspaceMenu.deleteHint", listCount + folderCount),
          {
            count: listCount + folderCount,
          },
        ),
        onPress: () => setPage("delete"),
      },
    ];
  }, [workspace, t, listCount, folderCount]);

  if (!workspace) return null;

  const subtitle =
    page === "options"
      ? t(`workspaces.role.${workspace.role}` as never)
      : page === "edit"
        ? t("workspaceMenu.edit")
        : page === "share"
          ? t(pluralKey("share.peopleSubtitle", workspace.memberCount), {
              count: workspace.memberCount,
            })
          : t("workspaceMenu.deleteTitle", { name: workspace.name });

  return (
    <Sheet
      visible
      onClose={onClose}
      title={workspace.name}
      subtitle={subtitle}
      /*
       * Scrollable, and it used not to be. The edit page grew — a colour picker
       * with twelve swatches, a square, a strip, a field and a preview is about
       * 700 points tall — and a panel that cannot scroll shows the first 600 and
       * puts the button that saves the thing below the fold. A control you cannot
       * reach is not a control.
       */
      scrollable
    >
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.sm,
        }}
      >
        {page === "options" ? (
          <>
            {workspace.description ? (
              <AppText variant="body" tone="muted" numberOfLines={2}>
                {workspace.description}
              </AppText>
            ) : null}
            <SheetOptions options={options} />
          </>
        ) : null}

        {page === "edit" ? (
          <View style={{ gap: theme.spacing.md }}>
            <TextField
              value={name}
              onChangeText={setName}
              label={t("rename.field")}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={() => {
                const trimmed = name.trim();
                if (!trimmed) return;
                onClose();
                void updateWorkspace(workspace, { name: trimmed });
              }}
            />

            {/* The colour lives here, next to the name, because a space is the
                thing a colour is a property of and this is where you go to
                change a space. */}
            <WorkspaceColorPicker
              value={workspace.color}
              valueTo={workspace.colorTo}
              wash={workspace.wash}
              onPick={(color) => void updateWorkspace(workspace, { color })}
              onPickTo={(colorTo) => void updateWorkspace(workspace, { colorTo })}
              onPickWash={(wash) => void updateWorkspace(workspace, { wash })}
            />

            <View style={{ gap: theme.spacing.sm }}>
              <Button
                label={t("rename.save")}
                disabled={name.trim().length === 0}
                fullWidth
                onPress={() => {
                  const trimmed = name.trim();
                  if (!trimmed) return;
                  onClose();
                  void updateWorkspace(workspace, { name: trimmed });
                }}
              />
              <Button
                label={t("common.back")}
                variant="ghost"
                fullWidth
                onPress={() => setPage("options")}
              />
            </View>
          </View>
        ) : null}

        {page === "share" ? (
          <>
            <SharePanel
              workspaceId={workspace.id}
              workspaceName={workspace.name}
              isOwner={workspace.role === "owner"}
              onBack={() => setPage("options")}
            />
            <Button
              label={t("common.back")}
              variant="ghost"
              fullWidth
              onPress={() => setPage("options")}
            />
          </>
        ) : null}

        {page === "delete" ? (
          <View style={{ gap: theme.spacing.md }}>
            <AppText variant="body">
              {t(
                pluralKey("workspaceMenu.deleteBody", listCount + folderCount),
                {
                  name: workspace.name,
                  count: listCount + folderCount,
                },
              )}
            </AppText>
            <AppText variant="caption" tone="subtle">
              {t("confirm.irreversible")}
            </AppText>
            <View style={{ gap: theme.spacing.sm }}>
              <Button
                label={t("workspaceMenu.deleteConfirm")}
                variant="danger"
                fullWidth
                onPress={() => {
                  onClose();
                  void deleteWorkspace(workspace);
                  onDeleted?.();
                }}
              />
              <Button
                label={t("common.cancel")}
                variant="ghost"
                fullWidth
                onPress={() => setPage("options")}
              />
            </View>
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}
