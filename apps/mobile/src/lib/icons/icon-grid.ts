import { VECTOR_ICON_CATEGORIES } from "@orbit-hub/contracts";

import { EMOJI_CATALOG, EMOJI_GROUPS } from "@/lib/icons/emoji-catalog.generated";
import { searchEmojis } from "@/lib/icons/search-emoji";
import { DRAWINGS, searchDrawings } from "@/lib/icons/vector-drawings";

/**
 * What the picker shows, as data.
 *
 * A component cannot be asked anything in this repo — no test renders one — so
 * everything the grid decides lives here, where it can be checked. The component
 * only draws what this answers.
 *
 * Three things it decides, and each one was wrong before:
 *
 * - **The whole catalogue, grouped.** The grid only showed everything once you
 *   picked a category, and the chips *filtered* instead of navigating. Now the
 *   chips move you and everything is already there.
 * - **Full rows.** `flex: 1` divides a row's width between the cells it has, so
 *   an incomplete last row comes out with wider cells — which the eye reads as
 *   some icons taking more room than others. The tail is padded to a multiple of
 *   the column count with cells that cannot be pressed.
 * - **Where each category starts**, so the bar can scroll to it.
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

export interface GridSection {
  category: string;
  /** The first cell of this category, for scrolling to it. */
  firstIndex: number;
}

export interface IconGrid {
  kind: "emoji" | "vector";
  cells: GridCell[];
  /** Where each category starts, in the order the bar shows them. */
  sections: GridSection[];
  /** How many padding cells closed the last row. */
  padding: number;
}

export interface BuildIconGridInput {
  kind: "emoji" | "vector";
  query: string;
  columns: number;
  /** Called with the key to store when a drawing is picked. */
  onPickVector?: (key: string) => void;
  /** Called with the emoji when an emoji is picked. */
  onPickEmoji?: (emoji: string) => void;
}

/**
 * Where each category begins, and only its **first** beginning.
 *
 * Deduplicated on purpose: with a search in place the list is in relevance
 * order, so one category can show up in two stretches, and a bar with "Comida"
 * on it twice is a bar that cannot say where you are.
 */
function sectionStarts(cells: readonly GridCell[]): GridSection[] {
  const sections: GridSection[] = [];
  const vistas = new Set<string>();
  let anterior: string | null = null;

  for (let i = 0; i < cells.length; i += 1) {
    const category = cells[i]?.category;
    if (category === undefined || category === anterior) continue;
    anterior = category;
    if (vistas.has(category)) continue;
    vistas.add(category);
    sections.push({ category, firstIndex: i });
  }
  return sections;
}

export function buildIconGrid(input: BuildIconGridInput): IconGrid {
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
    are a curation. Sorting by name throws both away and starts the vector grid
    with "Comida".
  */
  const hayBusqueda = input.query.trim().length > 0;
  const orden: readonly string[] = input.kind === "emoji" ? EMOJI_GROUPS : VECTOR_ICON_CATEGORIES;
  const posicion = new Map(orden.map((category, i) => [category as string, i]));
  const celdas = hayBusqueda
    ? found
    : [...found].sort(
        (a, b) =>
          (posicion.get(a.category) ?? Number.MAX_SAFE_INTEGER) -
          (posicion.get(b.category) ?? Number.MAX_SAFE_INTEGER),
      );

  const sections = sectionStarts(celdas);

  /*
    The tail, padded. A row that does not fill divides its width between fewer
    cells, so each of them comes out wider than the ones above — and that reads as
    "some icons take more space than others" to anyone who is not thinking about
    flexbox. These cells have nothing to press and nothing to read.
  */
  const sobrantes = found.length % columns;
  const padding = sobrantes === 0 ? 0 : columns - sobrantes;
  const celdasRelleno: GridCell[] = Array.from({ length: padding }, (_, i) => ({
    id: `__relleno_${i}`,
    category: "",
    label: "",
    placeholder: true,
  }));

  return { kind: input.kind, cells: [...celdas, ...celdasRelleno], sections, padding };
}

/** The row a cell sits in, for scrolling to it. */
export function rowForIndex(index: number, columns: number): number {
  const cols = Math.max(1, Math.trunc(columns));
  if (index <= 0) return 0;
  return Math.floor(index / cols);
}

/**
 * The offset to scroll to for a cell, from a measured cell height.
 *
 * Measured and not assumed: the cell is a square that takes a share of the panel's
 * width, and on a wide browser panel that is wider than on a phone. A negative or
 * past-the-end offset is the one thing that cannot be undone — `scrollToOffset`
 * does not clamp, and the list ends up somewhere it does not know how to leave.
 */
export function cellForIndex(index: number, columns: number, cellHeight: number): number {
  if (cellHeight <= 0) return 0;
  return rowForIndex(index, columns) * cellHeight;
}

/** The emoji catalogue size, for the tests that compare the grid against it. */
export const EMOJI_COUNT = EMOJI_CATALOG.length;

/** The drawing catalogue size, for the same reason. */
export const DRAWING_COUNT = DRAWINGS.length;
