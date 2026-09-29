/**
 * What a stored layout is read through before it is trusted.
 *
 * The server keeps this as free JSON in a column, so anything can arrive: a layout
 * from an older build, one a client sent with fields this version does not know,
 * or a screen of cards that names a page which does not exist. None of those is a
 * reason to leave somebody's panel blank, so what cannot be read is repaired or
 * left out and the rest stays — the one thing that is not done is throwing the
 * whole layout away.
 */
import { DASHBOARD_PAGES, dashboardWidgetSchema } from "@orbit-hub/contracts";
import type { DashboardWidget } from "@orbit-hub/contracts";

import { PANEL_COLUMNS, PANEL_ROWS, snapSize } from "./panel";

const MAX_WIDGETS = 24;

/**
 * The panel starts empty.
 *
 * It used to start with four widgets of its own, which made the panel a page
 * about the app: "recent lists", "tasks", "stats". A card that says "recent
 * lists" tells you what the app knows and not what you have to do, and the
 * panel is more useful with the person's own lists on it and the colour of their
 * own spaces. What is on it is what they put on it.
 */
export const DEFAULT_LAYOUT: readonly DashboardWidget[] = [];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

/**
 * Coerces and clamps the numeric fields *before* validation, so a widget that is
 * merely out of bounds gets repaired instead of discarded by the schema.
 *
 * The size goes through `snapSize` and not a clamp, and that is the difference
 * between repairing a layout and re-laying it out: a card stored at three and a
 * half columns is snapped to the nearest size the panel can draw, which is what
 * every other path does with it. A clamp would leave the impossible number in
 * place and push the fixing to the screen, so the stored layout and the drawn
 * one would disagree about the same card.
 *
 * The grid itself is imported from the panel rather than written out here. Two
 * copies of "how many columns" is how a panel ends up accepting a card the
 * placement would refuse, and neither place says where the other got its number.
 */
function sanitise(candidate: unknown): unknown {
  if (typeof candidate !== "object" || candidate === null) return candidate;
  const record = candidate as Record<string, unknown>;

  const size = snapSize(
    toNumber(record["w"], 2),
    toNumber(record["h"], 2),
    PANEL_COLUMNS,
    PANEL_ROWS,
  );

  return {
    ...record,
    x: clamp(toNumber(record["x"], 0), 0, PANEL_COLUMNS - size.w),
    y: clamp(toNumber(record["y"], 0), 0, PANEL_ROWS - size.h),
    w: size.w,
    h: size.h,
    // A layout written before the panel had screens has no `page`, and one that
    // says page 9000 is a card on a screen nobody can reach.
    page: clamp(toNumber(record["page"], 0), 0, DASHBOARD_PAGES - 1),
  };
}

/**
 * Validates and repairs a layout.
 *
 * The server stores this as free JSON, so anything can arrive here: an old
 * layout, a hand-edited one, or a widget kind a later version removed. Rather
 * than failing, invalid pieces are dropped and sizes are clamped, because a
 * dashboard with one bad widget is better than a broken screen.
 */
export function normaliseLayout(input: unknown): DashboardWidget[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const result: DashboardWidget[] = [];

  for (const candidate of input.slice(0, MAX_WIDGETS)) {
    const parsed = dashboardWidgetSchema.safeParse(sanitise(candidate));
    if (!parsed.success) continue;
    if (seen.has(parsed.data.id)) continue;

    seen.add(parsed.data.id);

    // Snapped a second time because `sanitise` guessed at the size from a value
    // that might not have been a number, and the schema is what decides what
    // arrived. Both go through the same function, so the stored layout and the
    // drawn one are the same layout.
    const size = snapSize(parsed.data.w, parsed.data.h, PANEL_COLUMNS, PANEL_ROWS);
    result.push({
      ...parsed.data,
      x: clamp(parsed.data.x, 0, PANEL_COLUMNS - size.w),
      y: clamp(parsed.data.y, 0, PANEL_ROWS - size.h),
      w: size.w,
      h: size.h,
    });
  }

  // Pinned widgets first. The sort is stable, so the relative order the user
  // chose is preserved inside each group.
  return result.sort((a, b) => Number(b.pinned) - Number(a.pinned));
}
