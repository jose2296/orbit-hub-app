import { Ionicons } from "@expo/vector-icons";
import { Image, StyleSheet, View } from "react-native";

import { mediaCardOf } from "@/lib/lists/media-card";
import type { ListItem } from "@orbit-hub/contracts";
import { DRAG_HANDLE_WIDTH, DraggableRow, DraggableSort } from "@/components/ui/draggable-row";
import { AppText } from "@/components/ui/text";
import { Sheet } from "@/components/ui/sheet";
import { useTheme } from "@/theme";

/**
 * The year, on its own, without asking whether there is a poster.
 *
 * `mediaCardOf` returns `null` for anything without an image — deliberately, because
 * a card *is* the picture — and this sheet was reading the year through it. So the
 * year only appeared for rows that had a poster, and an item imported without one
 * showed a bare title with nothing else, which read as "no data" rather than "no
 * picture". The two are independent fields and they are read independently here.
 */
function releasedOf(item: ListItem): string | null {
  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  const raw =
    metadata.releaseDate ?? metadata.publishedDate ?? metadata.year ?? null;
  if (typeof raw !== "string") return null;
  // A full date is cut to its year, which is all a list of films needs to say and
  // is the only part that fits next to a title without pushing it.
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 4);
}

/**
 * Reorder a list of films, **in a sheet, because the carousel has no room**.
 *
 * The carousel shows one poster per screen. That is the right thing to flick
 * through and the wrong place to rearrange: there is no second item on screen to
 * move anything towards, and a drag that has to fight the scroll to mean anything
 * is a drag that sometimes scrolls instead.
 *
 * So the manual order has its own screen, with a handle per row, the same
 * `DraggableSort` the list of tasks uses, and **the carousel comes straight back
 * when it closes** — the order mode is still whatever it was, and if it is
 * `manual` the carousel is showing the order that was just arranged. That was the
 * condition on asking for this: opening the sheet is not a different list, it is
 * the same list with the handles out.
 *
 * **It writes through `moveItem`**, the same call the drag in a list of tasks
 * makes, so the renumbering and the enqueued operation are the ones that already
 * have tests. A second implementation of "move this row here" is a second thing
 * that can be wrong about what a move means.
 */
export function MediaReorderSheet({
  open,
  visible,
  onMove,
  onClose,
  title,
  body,
}: {
  open: boolean;
  /** The rows in the order they are being shown in. */
  visible: ListItem[];
  /**
   * Move a row, and it is a **displacement and not a place**.
   *
   * `moveItemTo` — the function every list in this app reorders with — takes a
   * delta, because that is what survives the fact that positions are renumbered
   * from zero and two rows moving at once is two deltas. This sheet was handing it
   * the index the row was dropped at, which is a different number: dropping the
   * first row on the third one moved it three places instead of two, and with four
   * rows it walked off the end of the list. Measured in the browser: the drag
   * moved nothing and the order did not change.
   *
   * So the subtraction happens here, **where both numbers are known**: the index
   * it was dropped at, and the index it was in. The content list does exactly this
   * for the same reason.
   */
  onMove: (id: string, delta: number) => void;
  onClose: () => void;
  title: string;
  body: string;
}) {
  const theme = useTheme();

  return (
    <Sheet visible={open} onClose={onClose} title={title}>
      <AppText variant="caption" tone="subtle" style={{ marginBottom: theme.spacing.sm }}>
        {body}
      </AppText>
      <DraggableSort>
        <View style={{ gap: theme.spacing.xs }}>
          {visible.map((item, index) => {
            const card = mediaCardOf(item);
            const released = releasedOf(item);

            return (
              <DraggableRow
                key={item.id}
                id={item.id}
                index={index}
                total={visible.length}
                onReorder={(movedId, toIndex) => onMove(movedId, toIndex - index)}
              >
                <View
                  style={[
                    styles.fila,
                    {
                      gap: theme.spacing.md,
                      paddingLeft: theme.spacing.sm,
                      /*
                        The room for the handle, counted **here and in one object**.
                        It used to be in `styles.fila` and then overridden by an
                        inline `paddingRight` further down the same array, and the
                        inline one won — which silently gave back the exact room the
                        handle needs. The year, being the rightmost thing in the row,
                        then sat under the glyph. The comment on `DRAG_HANDLE_WIDTH`
                        in `draggable-row.tsx` is about this number being written
                        down twice and only agreeing by hand; writing it down twice
                        in the *same* file is the same bug with less distance.
                      */
                      paddingRight: DRAG_HANDLE_WIDTH + theme.spacing.sm,
                      paddingVertical: theme.spacing.sm,
                      minHeight: 56,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surfaceMuted,
                    },
                  ]}
                  testID={`reorder-row-${item.id}`}
                >
                  {/*
                    The poster, because in a list of films the picture is what tells
                    two rows apart and this sheet has no carousel behind it any more.
                    A row without one keeps its place with the kind's glyph instead,
                    so the column does not jump about as posters load.
                  */}
                  <View
                    style={[
                      styles.poster,
                      { borderRadius: theme.radius.sm, backgroundColor: theme.colors.surface },
                    ]}
                  >
                    {card?.imageUrl ? (
                      <Image
                        source={{ uri: card.imageUrl }}
                        style={styles.posterImagen}
                        resizeMode="cover"
                      />
                    ) : (
                      <Ionicons
                        name={item.metadata ? "film-outline" : "document-text-outline"}
                        size={16}
                        color={theme.colors.textSubtle}
                      />
                    )}
                  </View>

                  <View style={styles.texto}>
                    <AppText variant="body" numberOfLines={1}>
                      {item.title}
                    </AppText>
                    {released ? (
                      <AppText variant="caption" tone="subtle" numberOfLines={1}>
                        {released}
                      </AppText>
                    ) : null}
                  </View>
                </View>
              </DraggableRow>
            );
          })}
        </View>
      </DraggableSort>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  fila: {
    flexDirection: "row",
    alignItems: "center",
  },
  /*
    The title and the year in one column, and the year inside it rather than
    beside it.

    Side by side, a long title and a four-digit year fight over the same row: the
    year has nothing telling it to keep its size, so a title like "The Lord of the
    Rings: The Fellowship of the Ring" squeezed it and the four digits wrapped onto
    a second line under the handle — which is what put the year "below the drag
    icon". Stacked, the title truncates and the year keeps its line, and the row
    still says both things at the same height.
  */
  texto: {
    flex: 1,
    gap: 2,
  },
  poster: {
    width: 32,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  posterImagen: {
    width: "100%",
    height: "100%",
  },
});
