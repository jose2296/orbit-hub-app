import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";

import type { ListOrderMode } from "@orbit-hub/contracts";

import { ContentFiltersBody } from "@/components/content/content-filters-body";
import { ListControls } from "@/components/lists/list-controls";
import { AppText } from "@/components/ui/text";
import { ReorderSheet } from "@/components/ui/reorder-sheet";
import type { SheetOption } from "@/components/ui/sheet";
import {
  activeFilterCount,
  isDraggableOrder,
  matchesFilter,
  type ContentFilter,
  type ContentRow,
} from "@/lib/content-order";
import { useTranslation, type Translate } from "@/lib/i18n";
import { pluralKey } from "@/lib/i18n/plural";
import { useTheme } from "@/theme";

/** The orders offered here, and the words for them. */
const ORDENES: { mode: ListOrderMode; key: string }[] = [
  { mode: "manual", key: "content.sort.manual" },
  { mode: "alphabetical", key: "content.sort.alphabetical" },
  { mode: "alphabetical_desc", key: "content.sort.alphabeticalDesc" },
  { mode: "created_asc", key: "content.sort.createdAsc" },
  { mode: "created_desc", key: "content.sort.createdDesc" },
];

export interface ContentToolbarProps {
  /** Every row at this level, for the numbers on the chips. */
  rows: ContentRow[];
  filter: ContentFilter;
  onFilterChange: (filter: ContentFilter) => void;
  order: ListOrderMode;
  onOrderChange: (order: ListOrderMode) => void;
  /** Moves a row by a displacement, which is what every list here writes with. */
  onMove: (id: string, delta: number) => void;
  /**
   * The row to draw to the left of each name, and it is a function because a
   * folder has a glyph, a list has a kind and a note has neither.
   */
  leadingFor?: (row: ContentRow) => ReactNode;
  /** Whether the list can be put in order at all, and why not when it cannot. */
  canReorder: boolean;
}

/**
 * The three buttons over a list of folders, lists and notes — **the same three
 * that are over a list of films**.
 *
 * It was a row of chips for the kinds, a search box and one button whose label
 * was the current order, and every part of that was a different arrangement for
 * the same three questions: what is in here, in what order, and which of it am I
 * looking for. Having it identical to the films is the point: the gesture is
 * learned once and the label says the same thing in both places.
 *
 * **"Reordenar" only exists while the order is manual**, for the same reason it
 * does over the films: a list that is being read by date cannot be rearranged by
 * dragging, because the row you would be moving is not where the finger is.
 *
 * **Putting the rows in order is a sheet, not the list itself.** The rows in front
 * of you are in the order you chose to read them in, and a drag has to fight the
 * scroll to move one of them. The sheet has one job, a handle per row, and closes
 * back onto the same list showing what was arranged.
 */
export function ContentToolbar({
  rows,
  filter,
  onFilterChange,
  order,
  onOrderChange,
  onMove,
  leadingFor,
  canReorder,
}: ContentToolbarProps) {
  const theme = useTheme();
  const t = useTranslation();

  const [reordenarAbierto, setReordenarAbierto] = useState(false);

  const activos = activeFilterCount(filter);
  const claveOrden = ORDENES.find((o) => o.mode === order)?.key ?? "content.sort.manual";

  /**
   * How many rows the filter is leaving out, **counted with the same predicate
   * that filters the list**: one copy of the rule, so the number on the button and
   * the number in the sentence cannot be two different numbers.
   */
  const escondidos = useMemo(
    () => rows.reduce((n, row) => (matchesFilter(row, filter) ? n : n + 1), 0),
    [rows, filter],
  );

  /*
    The same short label as the films' order button: the sentence belongs in the
    sheet, where it is a title with room to be one, and the button says the short
    thing. "Como yo lo pongo" is a hundred and sixty points on a phone that is
    three hundred and ninety wide, which is half the row for the state of one
    control.
  */
  const etiquetaCorta = t(`orderShort.${claveOrden.replace("content.sort.", "")}` as never);

  const opcionesOrden: SheetOption[] = ORDENES.map((o) => ({
    key: o.mode,
    label: t(o.key as never),
    icon: o.mode === order ? ("checkmark" as const) : ("ellipse-outline" as const),
    onPress: () => onOrderChange(o.mode),
  }));

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <ListControls
        filterCount={activos}
        orderLabel={etiquetaCorta}
        orders={opcionesOrden}
        canReorder={canReorder && isDraggableOrder(order)}
        onReorder={() => setReordenarAbierto(true)}
        testID="content-controls"
      >
        <ContentFiltersBody
          rows={rows}
          filter={filter}
          onFilterChange={onFilterChange}
        />
      </ListControls>

      {/*
        What the filter is costing, said in words and not left to be deduced from
        the button's number. "14 of 23 hidden" is a sentence; a number on a chip is
        a number somebody has to subtract, and it does not say why they are gone.
      */}
      {escondidos > 0 ? (
        <AppText variant="caption" tone="subtle">
          {t("content.hidden", { hidden: escondidos, total: rows.length })}
        </AppText>
      ) : null}

      <ReorderSheet
        open={reordenarAbierto}
        onMove={onMove}
        onClose={() => setReordenarAbierto(false)}
        title={t("order.reorder")}
        hint={t("order.reorderHint")}
        rows={rows.map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: subtitleOf(row, t),
          leading: leadingFor?.(row) ?? null,
          leadingSize: { width: 32, height: 32, radius: theme.radius.sm },
        }))}
      />
    </View>
  );
}

/**
 * The one line under the name, **and it is how many things are in it**.
 *
 * It was the *kind* for a list, which put "Libros" under a list called "Libros":
 * the same word twice on one row, in the sheet whose whole job is telling rows
 * apart. A count is never a copy of the name and it is the number somebody is
 * ordering by anyway — a folder of forty things and a folder of two are not
 * interchangeable, and two rows both called "Libros" are.
 *
 * A note has nothing to count that is not in its name, so it gets no second line.
 */
function subtitleOf(row: ContentRow, t: Translate): string | null {
  if (row.kind === "note") return null;
  const count = row.itemCount ?? 0;
  if (count === 0) return null;
  // The plural key, because a row with one thing in it and a row with nine are
  // not the same sentence.
  return t(pluralKey("lists.itemCount" as never, count) as never, { count });
}
