import type { BoardState } from "@orbit-hub/contracts";

import { Sheet, SheetOptions, useLastValue } from "@/components/ui/sheet";
import type { SheetOption } from "@/components/ui/sheet";
import { useTranslation } from "@/lib/i18n";

export interface ColumnMenuSheetProps {
  /**
   * The column the menu is about, or `null` when it is closed.
   *
   * Same always-mounted pattern as every sheet in this folder: the last column
   * is what is drawn while it travels down.
   */
  state: BoardState | null;
  /** Open the single-state sheet (name and colour) for this column. */
  onEditState: () => void;
  /** Open the order sheet (this column's tasks) for this column. */
  onEditOrder: () => void;
  onClose: () => void;
}

/**
 * What can be done with one column, **and only two things.**
 *
 * The board's full editor (`state-editor-sheet.tsx`) does everything to every
 * column; this menu does one column's two edits and each one opens its own
 * sheet. Two doors side by side because renaming a column and rearranging its
 * tasks are different jobs: the first asks for a name and a colour, the second
 * for an order, and a panel that asked for all three would be the full editor
 * wearing a smaller title.
 *
 * Both close this menu on the way out, in the order the state picker uses for
 * its own doors: the next panel arrives behind the one leaving.
 */
export function ColumnMenuSheet({
  state: pedido,
  onEditState,
  onEditOrder,
  onClose,
}: ColumnMenuSheetProps) {
  const t = useTranslation();
  const columna = useLastValue(pedido);
  const abierto = pedido !== null;

  if (!columna) return null;

  const options: SheetOption[] = [
    {
      key: "edit",
      label: t("board.editState"),
      icon: "create-outline",
      onPress: () => {
        onEditState();
        onClose();
      },
    },
    {
      key: "order",
      label: t("board.editOrder"),
      /*
        **`reorder-two-outline`, the same glyph the lists order by.** `list-controls`
        offers the manual order with it, so a column's order wears the same shape —
        and a second glyph for the same job would be two drawings to learn.
      */
      icon: "reorder-two-outline",
      onPress: () => {
        onEditOrder();
        onClose();
      },
    },
  ];

  return (
    <Sheet visible={abierto} onClose={onClose} title={columna.title}>
      <SheetOptions options={options} />
    </Sheet>
  );
}
