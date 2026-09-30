import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Image, StyleSheet } from "react-native";

import type { List, ListItem } from "@orbit-hub/contracts";

import { useListItems, useLists } from "@/hooks/use-lists";
import { useTranslation } from "@/lib/i18n";
import { LIST_KIND_ICON, LIST_KIND_LABEL } from "@/lib/lists/kind";
import { mediaCardOf } from "@/lib/lists/media-card";

import { EmptyState } from "@/components/ui/empty-state";
import { Sheet, SheetOptions } from "@/components/ui/sheet";
import { useTheme } from "@/theme";
import type { SheetOption } from "@/components/ui/sheet";

export interface MediaActionsSheetProps {
  /** The item the menu is for, or `null` when the menu is closed. */
  item: ListItem | null;
  /** The list it is in, which the menu cannot offer to remove it from. */
  listId: string;
  /** Media kind, so the wording is "watched" or "read". */
  listKind: List["kind"];
  /**
   * When the menu is opened from the detail of the item, searching for its title
   * and asking where it is are actions on the thing and not buttons on the screen.
   */
  onFindTitle?: () => void;
  /** Only when the title has a provider id: a book is not on Netflix. */
  onWhereToWatch?: () => void;
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
  onFindTitle,
  onWhereToWatch,
  onClose,
}: MediaActionsSheetProps) {
  const t = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const { lists } = useLists({});
  const { toggleCompleted, removeItem, addItemTo } = useListItems(listId);

  const [pickingList, setPickingList] = useState(false);
  /*
    The target being written to right now.
   *
    `planAddToList` refuses a duplicate, and a refusal is no use against two taps
    in a row: both calls read the list **before** either writes, so each one sees a
    list that does not have the title yet and both say yes. The two rows then land
    together, and the rule that was there to prevent exactly that is what let it
    through. One name in flight is what closes that window.
  */
  const [anadiendoEn, setAnadiendoEn] = useState<string | null>(null);

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
              disabled: anadiendoEn !== null,
              onPress: () => {
                if (anadiendoEn !== null) return;
                setAnadiendoEn(list.id);
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
                )
                  .catch(() => undefined)
                  .finally(() => setAnadiendoEn(null));
                onClose();
              },
            }))}
          />
        )}
      </Sheet>
    );
  }

  const options: SheetOption[] = [
    // Buscar el titulo es una accion sobre la peli, y desde el detalle cabe en el
    // menu como una mas. Antes era un boton de pantalla completa al final del
    // texto, que empujaba la sinopsis hacia abajo y duplicaba lo que ya hacia el
    // boton de al lado de la portada.
    ...(onFindTitle
      ? [
          {
            key: "find-title",
            label: isBook
              ? t("itemDetails.findBook")
              : t("itemDetails.findTitle"),
            icon: "search-outline" as const,
            onPress: () => {
              onClose();
              onFindTitle();
            },
          },
        ]
      : []),
    ...(onWhereToWatch
      ? [
          {
            key: "where",
            label: t("providers.action"),
            icon: "tv-outline" as const,
            onPress: () => {
              onClose();
              onWhereToWatch();
            },
          },
        ]
      : []),
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

  /*
    The cover, in the header, **beside the title**.
   *
    Two sheets with the same title open at once and there is nothing to tell them
    apart, and this sheet is reached by long-pressing a poster, so the poster is
    literally the thing under the finger that opened it. Thirty-six points is the
    width of a thumbnail: enough to recognise a film from its artwork, small
    enough that the title still has the sheet to itself.
   */
  const cover = mediaCardOf(item)?.imageUrl;
  const arte = cover ? (
    <Image
      source={{ uri: cover }}
      style={[
        styles.portada,
        { borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceMuted },
      ]}
      resizeMode="cover"
      accessibilityIgnoresInvertColors
    />
  ) : null;

  return (
    <Sheet
      visible
      onClose={onClose}
      title={item.title}
      subtitle={t(LIST_KIND_LABEL[listKind])}
      artwork={arte}
    >
      <SheetOptions options={options} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  portada: {
    width: 36,
    height: 54,
  },
});
