import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { FullTitle } from "@/components/media/full-title";
import { DRAG_HANDLE_WIDTH, DraggableRow, DraggableSort } from "@/components/ui/draggable-row";
import { Sheet } from "@/components/ui/sheet";
import { useTheme } from "@/theme";

export interface ReorderSheetRow {
  id: string;
  title: string;
  /** The year, the kind, the count: the one line that says which row this is. */
  subtitle?: string | null;
  /**
   * What is drawn to the left of the name — a poster, an icon, nothing.
   *
   * It is given as a node and not as a URL or a name because the three lists that
   * can be reordered here do not agree on what a row looks like: a film has a
   * poster, a folder has a glyph, a task has a checkbox. The shell draws the card
   * and the space and the handle, and the caller draws what identifies the row.
   */
  leading?: ReactNode;
  /** How wide and tall the leading node is, so the card can be measured. */
  leadingSize?: { width: number; height: number; radius?: number };
}

export interface ReorderSheetProps {
  open: boolean;
  /** The rows in the order they are being shown in. */
  rows: ReorderSheetRow[];
  /**
   * Move a row, and it is a **displacement and not a place**.
   *
   * `moveItemTo` — the call every list in this app reorders with — takes a delta,
   * because that is what survives positions being renumbered from zero. The drag
   * hands over the index the row was dropped at, and turning an index back into a
   * step is the one place in the app where "how far did it move" is a guess:
   * dropping the first row on the third moved it three places instead of two.
   *
   * So the subtraction happens here, **where both numbers are known**: the index it
   * was dropped at and the index it was in.
   */
  onMove: (id: string, delta: number) => void;
  onClose: () => void;
  title: string;
  /** One line under the title, and it is the title's `subtitle`. */
  hint?: string;
}

/**
 * Put a list in order, **in a sheet with a handle per row**.
 *
 * A list that can be read in five different orders cannot also be rearranged by
 * dragging its own rows: the row you are trying to move is not where the finger
 * is — it is wherever that order put it — and a drag has to fight the scroll to
 * mean anything. So the manual order has its own screen, with a handle per row,
 * and **the list comes straight back when it closes**, showing the order that was
 * just arranged.
 *
 * **It writes through the same `moveItem` a drag anywhere else in the app
 * makes**, so the renumbering and the enqueued operation are the ones that already
 * have tests. A second implementation of "move this row here" is a second thing
 * that can be wrong about what a move means.
 *
 * The drag is on the handle and not on the row — that is `DraggableRow`'s rule and
 * it is what leaves the name free for the long press that shows it whole.
 */
export function ReorderSheet({
  open,
  rows,
  onMove,
  onClose,
  title,
  hint,
}: ReorderSheetProps) {
  const theme = useTheme();

  /*
    The space between rows, **written down once**.
   *
    It goes in the layout that draws them and in the `DraggableSort` that has to
    know how far apart they are, and a number written in only one of the two is how
    a drop lands a row away from the gap that opened for it.
   */
  const hueco = theme.spacing.xs;

  return (
    <Sheet visible={open} onClose={onClose} title={title} subtitle={hint}>
      <DraggableSort gap={hueco}>
        <View style={{ gap: hueco }}>
          {rows.map((row, index) => (
            <DraggableRow
              key={row.id}
              id={row.id}
              index={index}
              total={rows.length}
              onReorder={(movedId, toIndex) => onMove(movedId, toIndex - index)}
            >
              <View
                style={[
                  styles.fila,
                  {
                    gap: theme.spacing.md,
                    paddingLeft: theme.spacing.sm,
                    /*
                      The room for the handle, counted here and in one object. It
                      used to be in this style and then overridden by an inline
                      `paddingRight` further down the same array, and the inline one
                      won, which silently gave back the exact room the handle needs.
                    */
                    paddingRight: DRAG_HANDLE_WIDTH + theme.spacing.sm,
                    paddingVertical: theme.spacing.sm,
                    minHeight: 56,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surfaceMuted,
                  },
                ]}
                testID={`reorder-row-${row.id}`}
              >
                {row.leading ? (
                  <View
                    style={[
                      styles.leading,
                      {
                        width: row.leadingSize?.width ?? 32,
                        height: row.leadingSize?.height ?? 44,
                        borderRadius:
                          row.leadingSize?.radius ?? theme.radius.sm,
                        backgroundColor: theme.colors.surface,
                      },
                    ]}
                  >
                    {row.leading}
                  </View>
                ) : null}

                {/*
                  The name and the line under it, **and the whole name on a long
                  press**. A row here is a hundred and forty points of handle and
                  thirty of icon, and there is no width to spend on a long name.
                */}
                <View style={styles.texto}>
                  <FullTitle
                    text={row.title}
                    numberOfLines={1}
                    testID={`nombre-reorden-${row.id}`}
                  />
                  {row.subtitle ? (
                    <FullTitle
                      text={row.subtitle}
                      numberOfLines={1}
                      testID={`detalle-reorden-${row.id}`}
                    />
                  ) : null}
                </View>
              </View>
            </DraggableRow>
          ))}
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
  leading: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  /*
    The name and the line under it in one column, and the line inside it rather
    than beside it. Side by side, a long name and a four digit year fight over the
    same row and the year wraps onto a second line under the handle.
  */
  texto: {
    flex: 1,
    gap: 2,
  },
});
