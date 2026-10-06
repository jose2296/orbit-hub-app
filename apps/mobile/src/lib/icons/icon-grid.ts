import type { IconRef } from "@orbit-hub/contracts";
import { VECTOR_ICON_CATEGORIES } from "@orbit-hub/contracts";

import { EMOJI_CATALOG, EMOJI_GROUPS } from "@/lib/icons/emoji-catalog.generated";
import { searchEmojis } from "@/lib/icons/search-emoji";
import { DRAWINGS, searchDrawings } from "@/lib/icons/vector-drawings";

/**
 * What the picker shows, as data — and the geometry of scrolling it.
 *
 * A component cannot be asked anything in this repo, so everything the grid
 * decides lives here, where it can be checked.
 *
 * **The list rows itself instead of letting `numColumns` do it**, and that is the
 * whole trick. With `numColumns`, react-native-web *measures* rows as they mount:
 * the content height only ever describes what happens to be on screen, the scroll
 * bar is a lie, jumping to the end is impossible, and the list grows underneath
 * you as you read it. Chunking the rows here means every row has a height known
 * before it is rendered, so the total height, the scroll bar, `scrollToOffset` and
 * "which category am I in" are all arithmetic instead of measurement.
 *
 * Which also buys the section titles: a row is either a title or a row of cells.
 */

export interface GridCell {
  /** Stable identity for the list: the glyph for a drawing, the emoji itself. */
  id: string;
  category: string;
  /** The label a screen reader reads. Empty on a padding cell. */
  label: string;
  /** The key stored when this cell is picked. Undefined on a padding cell. */
  value?: string;
  /** What this cell picks, already resolved. Undefined on a padding cell. */
  onPick?: () => void;
  /** A cell that exists only to complete a row. */
  placeholder?: boolean;
}

export interface HeaderRow {
  type: "header";
  category: string;
  cells: [];
}

export interface CellRow {
  type: "cells";
  category: string;
  cells: GridCell[];
}

export type GridRow = HeaderRow | CellRow;

export interface GridSection {
  category: string;
  /** The **row** that carries this category's title, for scrolling to it. */
  firstRow: number;
}

export interface IconGrid {
  kind: "emoji" | "vector";
  rows: GridRow[];
  /** Where each category's title is, in the order the bar shows them. */
  sections: GridSection[];
  /** Every cell that can be picked, flattened, padding excluded. */
  cells: GridCell[];
  /** How many padding cells closed the last row of the whole grid. */
  padding: number;
}

export interface BuildIconGridInput {
  kind: "emoji" | "vector";
  query: string;
  columns: number;
  onPickVector?: (key: string) => void;
  onPickEmoji?: (emoji: string) => void;
}

/** Whether the grid shows a title per category at all. */
export type Titles = "on" | "off";

function cellFor(
  input: BuildIconGridInput,
  found: GridCell[],
): GridCell[] {
  void input;
  return found;
}

/**
 * The grid: every icon, grouped, in rows that all have the same height.
 *
 * The tail is padded to a multiple of the column count. A row that does not fill
 * divides its width between the cells it has, so each of them comes out wider
 * than the ones above — and that reads as "some icons take more space than
 * others" to anyone who is not thinking about flexbox. The padding cells have
 * nothing to press and nothing to read.
 */
export function buildIconGrid(input: BuildIconGridInput, titles: Titles = "on"): IconGrid {
  const columns = Math.max(1, Math.trunc(input.columns));
  const { onPickEmoji, onPickVector } = input;

  const found: GridCell[] =
    input.kind === "emoji"
      ? searchEmojis(input.query).map((entry) => ({
          id: entry.emoji,
          category: entry.group,
          label: entry.name,
          value: entry.emoji,
          onPick: () => onPickEmoji?.(entry.emoji),
        }))
      : searchDrawings(input.query).map((drawing) => ({
          id: drawing.glyph,
          category: drawing.category,
          label: drawing.label,
          value: drawing.key,
          onPick: () => onPickVector?.(drawing.key),
        }));

  /*
    Grouped by category only when browsing, and in the order the categories are
    **declared**, not alphabetically. Both orders mean something: the emoji groups
    come from Unicode, which puts faces first and flags last, and the vector ones
    are a curation. Sorting by name throws both away.
  */
  const hayBusqueda = input.query.trim().length > 0;
  const orden: readonly string[] =
    input.kind === "emoji" ? EMOJI_GROUPS : VECTOR_ICON_CATEGORIES;
  const posicion = new Map(orden.map((category, i) => [category as string, i]));
  const celdas = hayBusqueda
    ? found
    : [...found].sort(
        (a, b) =>
          (posicion.get(a.category) ?? Number.MAX_SAFE_INTEGER) -
          (posicion.get(b.category) ?? Number.MAX_SAFE_INTEGER),
      );

  const sobrantes = celdas.length % columns;
  const padding = sobrantes === 0 ? 0 : columns - sobrantes;
  const celdasRelleno: GridCell[] = Array.from({ length: padding }, (_, i) => ({
    id: `__relleno_${i}`,
    category: "",
    label: "",
    placeholder: true,
  }));

  /* Rows, with a title row opening each category. */
  const rows: GridRow[] = [];
  const sections: GridSection[] = [];
  let i = 0;
  let anterior: string | null = null;

  while (i < celdas.length) {
    const categoria = celdas[i]?.category ?? "";
    if (titles === "on" && categoria !== anterior) {
      sections.push({ category: categoria, firstRow: rows.length });
      rows.push({ type: "header", category: categoria, cells: [] });
    }
    anterior = categoria;
    rows.push({
      type: "cells",
      category: categoria,
      cells: celdas.slice(i, i + columns),
    });
    i += columns;
  }

  /* The very last row takes the padding, so the grid ends square. */
  const last = rows[rows.length - 1];
  if (last && last.type === "cells" && padding > 0) {
    last.cells = [...last.cells, ...celdasRelleno];
  }

  return { kind: input.kind, rows, sections, cells: cellFor(input, celdas), padding };
}

/** The height of one row, from the cell size and the title's own height. */
export function rowHeight(row: GridRow, cellHeight: number, headerHeight: number): number {
  return row.type === "header" ? headerHeight : cellHeight;
}

/**
 * The offset of a row, and its height: `getItemLayout`, done as arithmetic.
 *
 * Every row's height is known before anything is rendered, so the content height
 * of a 1914-emoji grid is right the first time instead of growing as it is read.
 */
export function layoutOfRow(
  rows: readonly GridRow[],
  index: number,
  cellHeight: number,
  headerHeight: number,
): { offset: number; length: number } {
  let offset = 0;
  const hasta = Math.min(index, rows.length);
  for (let i = 0; i < hasta; i += 1) {
    offset += rowHeight(rows[i]!, cellHeight, headerHeight);
  }
  return { offset, length: rowHeight(rows[index] ?? { type: "cells", category: "", cells: [] }, cellHeight, headerHeight) };
}

/** The height of the whole grid, for the scroll bar and for the jump to the end. */
export function totalHeight(
  rows: readonly GridRow[],
  cellHeight: number,
  headerHeight: number,
): number {
  let total = 0;
  for (const row of rows) total += rowHeight(row, cellHeight, headerHeight);
  return total;
}

/**
 * The category at this offset: the last row that **starts** at or above nothing.
 *
 * "The last row that has begun", not "the last one that has finished": standing on
 * the first row of the grid is standing on the first category, and an earlier
 * version that asked which row had *ended* answered `null` at offset zero — the
 * first thing anybody sees reported no category at all.
 */
export function categoryAtOffset(
  rows: readonly GridRow[],
  offset: number,
  cellHeight: number,
  headerHeight: number,
): string | null {
  let categoria: string | null = null;
  let inicio = 0;

  for (const row of rows) {
    if (inicio > offset) break;
    categoria = row.category;
    inicio += rowHeight(row, cellHeight, headerHeight);
  }
  return categoria;
}

/**
 * The first row holding a cell that answers this, or null.
 *
 * To scroll to the icon that is already chosen. The match is on the cell's `id` —
 * the glyph for a drawing, the emoji itself — and **not** on its `key`, because the
 * key of a cell is the canonical one and the row may be carrying any of the words
 * that draw it: a row that stored `pan` holds the cell `vaso`, and matching on the
 * key would scroll nowhere and, worse, would not mark it as chosen either.
 */
export function firstRowWhere(
  rows: readonly GridRow[],
  match: (cell: GridCell) => boolean,
): number | null {
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row?.type === "cells" && row.cells.some(match)) return i;
  }
  return null;
}

/**
 * Which tab the picker opens on.
 *
 * On the one the chosen icon is on. Somebody who put a drawing there and comes
 * back to change its colour opens the picker to find that drawing — landing on the
 * emoji tab means scrolling past four thousand system drawings to reach the
 * forty they are editing, every single time.
 *
 * Null, or an emoji, opens on emojis: that is the tab that is wanted by default
 * and the one worth showing first.
 */
export function initialTab(current: IconRef | null | undefined): "emoji" | "vector" {
  return current?.type === "vector" ? "vector" : "emoji";
}

/** The emoji catalogue size, for the tests that compare the grid against it. */
export const EMOJI_COUNT = EMOJI_CATALOG.length;

/** The drawing catalogue size, for the same reason. */
export const DRAWING_COUNT = DRAWINGS.length;
