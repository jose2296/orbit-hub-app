import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";

import type { List, ListItem } from "@orbit-hub/contracts";

import { useListItems, useLists } from "@/hooks/use-lists";
import { useTranslation } from "@/lib/i18n";
import { LIST_KIND_ICON, LIST_KIND_LABEL } from "@/lib/lists/kind";

import { EmptyState } from "@/components/ui/empty-state";
import { Sheet, SheetOptions } from "@/components/ui/sheet";
import type { SheetOption } from "@/components/ui/sheet";

export interface MediaActionsSheetProps {
  /** The item the menu is for, or `null` when the menu is closed. */
  item: ListItem | null;
  /** The list it is in, which the menu cannot offer to remove it from. */
  listId: string;
  /** Media kind, so the wording is "watched" or "read". */
  listKind: List["kind"];
  onClose: () => void;
}

/**
 * What can be done with a film, a series or a book.
 *
 * The same menu in the carousel and in the detail, because it is the same
 * handful of things and having two lists of them is how they drift apart. It is
 * a panel rather than a row of icons because "remove from the list" next to
 * "mark as watched" is a tap that cannot be undone, and a row of icons has
 * nowhere to put a warning.
 *
 * Marking as watched is the first option because it is what the menu is for
 * most of the time, and the wording follows the list: a book is read.
 */
export function MediaActionsSheet({
  item,
  listId,
  listKind,
  onClose,
}: MediaActionsSheetProps) {
  const t = useTranslation();
  const router = useRouter();

  const { lists } = useLists({});
  const { toggleCompleted, removeItem, addItemTo } = useListItems(listId);

  const [pickingList, setPickingList] = useState(false);

  const isBook = listKind === "books";
  const seen = item?.completed ?? false;

  /**
   * The lists this title could also go into.
   *
   * Every list of the same kind except this one. Whether it is already in one
   * of them is not asked here: that would mean reading every list to draw a
   * menu, and the write already refuses to add a title twice.
   */
  const targets = useMemo(
    () => lists.filter((list) => list.id !== listId && list.kind === listKind),
    [listId, listKind, lists],
  );

  const close = useCallback(() => {
    setPickingList(false);
    onClose();
  }, [onClose]);

  if (!item) return null;

  // The second page: where else this title should go.
  if (pickingList) {
    return (
      <Sheet
        visible
        onClose={close}
        title={t("mediaActions.addToAnother")}
        subtitle={item.title}
      >
        {targets.length === 0 ? (
          <EmptyState
            compact
            title={t("mediaActions.noOtherList")}
            description={t("mediaActions.noOtherListBody")}
          />
        ) : (
          <SheetOptions
            options={targets.map((list): SheetOption => ({
              key: list.id,
              label: list.title,
              icon: LIST_KIND_ICON[list.kind],
              onPress: () => {
                setPickingList(false);
                void addItemTo(
                  {
                    title: item.title,
                    externalId: item.externalId,
                    // The provider record travels with the title, so the copy in
                    // the other list looks the same instead of being a bare row.
                    metadata: item.metadata,
                  },
                  list.id,
                );
                onClose();
              },
            }))}
          />
        )}
      </Sheet>
    );
  }

  const options: SheetOption[] = [
    {
      key: "seen",
      label: seen
        ? isBook
          ? t("mediaActions.markAsUnread")
          : t("mediaActions.markAsUnseen")
        : isBook
          ? t("mediaActions.markAsRead")
          : t("mediaActions.markAsSeen"),
      icon: seen ? "eye-off-outline" : "eye-outline",
      onPress: () => {
        void toggleCompleted(item);
        onClose();
      },
    },
    {
      key: "details",
      label: t("items.viewDetails"),
      icon: "information-circle-outline",
      onPress: () => {
        onClose();
        router.push({
          pathname: "/(app)/item/[itemId]",
          params: {
            itemId: listId,
            kind: isBook ? "books" : listKind === "series" ? "tv" : "movies",
            externalId: item.externalId ?? "",
            title: item.title,
            itemIdOfItem: item.id,
          },
        });
      },
    },
    {
      key: "add-elsewhere",
      label: t("mediaActions.addToAnother"),
      icon: "albums-outline",
      description: t("mediaActions.addToAnotherHint"),
      disabled: !item.externalId,
      onPress: () => setPickingList(true),
    },
    {
      key: "remove",
      label: t("mediaActions.removeFromList"),
      icon: "trash-outline",
      tone: "danger",
      description: t("mediaActions.removeFromListHint"),
      onPress: () => {
        void removeItem(item);
        onClose();
      },
    },
  ];

  return (
    <Sheet
      visible
      onClose={onClose}
      title={item.title}
      subtitle={t(LIST_KIND_LABEL[listKind])}
    >
      <SheetOptions options={options} />
    </Sheet>
  );
}
