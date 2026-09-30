import { StyleSheet, View } from "react-native";

import { mediaCardOf } from "@/lib/lists/media-card";
import type { ListItem } from "@orbit-hub/contracts";
import { DRAG_HANDLE_WIDTH, DraggableRow, DraggableSort } from "@/components/ui/draggable-row";
import { AppText } from "@/components/ui/text";
import { Sheet } from "@/components/ui/sheet";
import { useTheme } from "@/theme";

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
  /** The index the row was dropped at, and the same call a task list makes. */
  onMove: (id: string, toIndex: number) => void;
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
          {visible.map((item, index) => (
            <DraggableRow
              key={item.id}
              id={item.id}
              index={index}
              total={visible.length}
              onReorder={(movedId, toIndex) => onMove(movedId, toIndex)}
            >
              <View
                style={[
                  styles.fila,
                  {
                    gap: theme.spacing.sm,
                    paddingLeft: theme.spacing.md,
                    paddingRight: theme.spacing.sm,
                    paddingVertical: theme.spacing.sm,
                    minHeight: 56,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surfaceMuted,
                  },
                ]}
                testID={`reorder-row-${item.id}`}
              >
                <AppText variant="body" numberOfLines={1} style={styles.titulo}>
                  {item.title}
                </AppText>
                {mediaCardOf(item)?.released ? (
                  <AppText variant="caption" tone="subtle">
                    {mediaCardOf(item)?.released}
                  </AppText>
                ) : null}
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
    // The handle sits on the right and the row leaves room for it, because the
    // handle is drawn over the row and a title that runs under it is a title you
    // cannot read to the end.
    paddingRight: DRAG_HANDLE_WIDTH + 12,
  },
  titulo: {
    flex: 1,
  },
});
