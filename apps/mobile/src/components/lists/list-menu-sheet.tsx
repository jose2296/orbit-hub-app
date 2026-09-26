import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import type { Folder, List } from "@orbit-hub/contracts";

import { useDashboard } from "@/hooks/use-dashboard";
import { useLists } from "@/hooks/use-lists";
import {
  isPinned,
  withPinnedList,
  withoutPinnedList,
} from "@/lib/dashboard/pin";
import { LIST_KIND_LABEL } from "@/lib/lists/kind";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

import { Button } from "../ui/button";
import { Sheet, SheetOptions } from "../ui/sheet";
import type { SheetOption } from "../ui/sheet";
import { AppText } from "../ui/text";
import { TextField } from "../ui/text-field";

export interface ListMenuSheetProps {
  /** The list the menu is for, or `null` when it is closed. */
  list: List | null;
  /** The folder it is in, so the menu says where it lives. */
  folder: Folder | null;
  onClose: () => void;
  /** Called after the list is gone, so the screen can go back somewhere. */
  onDeleted?: () => void;
}

/**
 * What can be done with a list.
 *
 * The same handful of things in the same order wherever the menu is opened from,
 * because a menu that reads differently in two places is two menus to learn. It
 * is a panel and not a row of icons because "mark as favourite" and "delete"
 * sitting next to each other as two identical circles is a mistake waiting to
 * happen.
 *
 * Delete is last and it says how many things go with it. Everything else here
 * can be undone by opening the menu again, and the one that cannot asks first.
 *
 * Renaming and deleting are **pages of this same panel** and not panels of their
 * own. A panel on top of a panel is two backdrops over one screen, and a tap
 * that reaches the wrong one closes what is underneath instead of doing what was
 * asked. One panel whose content changes has neither problem.
 */
type Page = "options" | "rename" | "delete";

export function ListMenuSheet({
  list,
  folder,
  onClose,
  onDeleted,
}: ListMenuSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const { updateList, deleteList, duplicateList, toggleFavorite } = useLists(
    {},
  );
  const { layout, save } = useDashboard();

  const [page, setPage] = useState<Page>("options");
  const [name, setName] = useState(list?.title ?? "");

  // Reopening the menu always starts at the options, whatever page it was left
  // on: a menu that opens in the middle of a flow is a menu that surprises.
  useEffect(() => {
    if (list) {
      setPage("options");
      setName(list.title);
    }
  }, [list]);

  const pinned = list ? isPinned(layout, list.id) : false;

  const options: SheetOption[] = useMemo(() => {
    if (!list) return [];
    return [
      {
        key: "rename",
        label: t("common.rename"),
        icon: "create-outline",
        onPress: () => {
          setName(list.title);
          setPage("rename");
        },
      },
      {
        key: "favorite",
        label: list.favorite ? t("lists.unfavorite") : t("lists.favorite"),
        icon: list.favorite ? "star" : "star-outline",
        onPress: () => {
          onClose();
          void toggleFavorite(list);
        },
      },
      {
        key: "pin",
        label: pinned
          ? t("lists.unpinFromDashboard")
          : t("lists.pinToDashboard"),
        icon: pinned ? "remove-circle-outline" : "apps-outline",
        description: t("lists.pinHint"),
        onPress: () => {
          onClose();
          void save(
            pinned
              ? withoutPinnedList(layout, list.id)
              : withPinnedList(layout, list),
          );
        },
      },
      {
        key: "duplicate",
        label: t("lists.duplicate"),
        icon: "copy-outline",
        description: t("lists.duplicateHint"),
        onPress: () => {
          onClose();
          void duplicateList(list);
        },
      },
      {
        key: "delete",
        label: t("common.delete"),
        icon: "trash-outline",
        tone: "danger",
        description: t("lists.deleteBody", { count: list.itemCount }),
        onPress: () => setPage("delete"),
      },
    ];
  }, [list, pinned, layout, t, onClose, toggleFavorite, duplicateList, save]);

  if (!list) return null;

  const subtitle =
    page === "options"
      ? `${t(LIST_KIND_LABEL[list.kind])}${folder ? ` · ${folder.name}` : ""}`
      : page === "rename"
        ? t("rename.title", { what: t(LIST_KIND_LABEL[list.kind]) })
        : t("lists.deleteTitle", { what: list.title });

  return (
    <Sheet
      visible
      onClose={onClose}
      title={list.title}
      subtitle={subtitle}
      scrollable={false}
    >
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.sm,
        }}
      >
        {page === "options" ? (
          <>
            {list.description ? (
              <AppText variant="body" tone="muted" numberOfLines={2}>
                {list.description}
              </AppText>
            ) : null}
            <SheetOptions options={options} />
          </>
        ) : null}

        {page === "rename" ? (
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
                void updateList(list, { title: trimmed });
              }}
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
                  void updateList(list, { title: trimmed });
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

        {page === "delete" ? (
          <View style={{ gap: theme.spacing.md }}>
            <AppText variant="body">
              {t("lists.deleteBody", { count: list.itemCount })}
            </AppText>
            <AppText variant="caption" tone="subtle">
              {t("confirm.irreversible")}
            </AppText>
            <View style={{ gap: theme.spacing.sm }}>
              <Button
                label={t("lists.deleteConfirm")}
                variant="danger"
                fullWidth
                onPress={() => {
                  onClose();
                  void deleteList(list);
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
