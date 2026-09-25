import { dashboardWidgetSchema } from '@orbit-hub/contracts';
import type { DashboardWidget } from '@orbit-hub/contracts';

const GRID_COLUMNS = 12;
const GRID_ROWS = 24;
const MAX_WIDGETS = 24;

type WidgetKind = DashboardWidget['kind'];

/**
 * The layout a new user starts with. It is deliberately small: the dashboard
 * should open with something useful, not with a wall of empty widgets.
 */
export const DEFAULT_LAYOUT: readonly DashboardWidget[] = [
  { id: 'quick-actions', kind: 'quick_actions', x: 0, y: 0, w: 12, h: 2, pinned: true },
  { id: 'tasks', kind: 'tasks', x: 0, y: 2, w: 6, h: 4, pinned: false },
  { id: 'recent-lists', kind: 'recent_lists', x: 6, y: 2, w: 6, h: 4, pinned: false },
  { id: 'stats', kind: 'stats', x: 0, y: 6, w: 6, h: 3, pinned: false },
];

/** Every widget kind the dashboard can show, with its default size. */
export const WIDGET_CATALOG: Record<WidgetKind, { labelKey: string; w: number; h: number }> = {
  quick_actions: { labelKey: 'dashboard.widget.quickActions', w: 12, h: 2 },
  tasks: { labelKey: 'dashboard.widget.tasks', w: 6, h: 4 },
  recent_lists: { labelKey: 'dashboard.widget.recentLists', w: 6, h: 4 },
  recent_notes: { labelKey: 'dashboard.widget.recentNotes', w: 6, h: 4 },
  calendar: { labelKey: 'dashboard.widget.calendar', w: 6, h: 5 },
  stats: { labelKey: 'dashboard.widget.stats', w: 6, h: 3 },
};

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
 */
function sanitise(candidate: unknown): unknown {
  if (typeof candidate !== 'object' || candidate === null) return candidate;
  const record = candidate as Record<string, unknown>;

  const w = clamp(toNumber(record['w'], 6), 1, GRID_COLUMNS);
  const h = clamp(toNumber(record['h'], 3), 1, GRID_ROWS);

  return {
    ...record,
    x: clamp(toNumber(record['x'], 0), 0, GRID_COLUMNS - w),
    y: clamp(toNumber(record['y'], 0), 0, 1000),
    w,
    h,
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

    const w = clamp(parsed.data.w, 1, GRID_COLUMNS);
    result.push({
      ...parsed.data,
      x: clamp(parsed.data.x, 0, GRID_COLUMNS - w),
      y: clamp(parsed.data.y, 0, 1000),
      w,
      h: clamp(parsed.data.h, 1, GRID_ROWS),
    });
  }

  // Pinned widgets first. The sort is stable, so the relative order the user
  // chose is preserved inside each group.
  return result.sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

export function addWidget(layout: DashboardWidget[], kind: WidgetKind): DashboardWidget[] {
  if (layout.length >= MAX_WIDGETS) return layout;
  if (layout.some((widget) => widget.kind === kind)) return layout;

  const preset = WIDGET_CATALOG[kind];
  const bottom = layout.reduce((max, widget) => Math.max(max, widget.y + widget.h), 0);

  return normaliseLayout([
    ...layout,
    { id: kind, kind, x: 0, y: bottom, w: preset.w, h: preset.h, pinned: false },
  ]);
}

export function removeWidget(layout: DashboardWidget[], id: string): DashboardWidget[] {
  return layout.filter((widget) => widget.id !== id);
}

export function togglePin(layout: DashboardWidget[], id: string): DashboardWidget[] {
  return normaliseLayout(
    layout.map((widget) => (widget.id === id ? { ...widget, pinned: !widget.pinned } : widget)),
  );
}

export type MoveDirection = 'up' | 'down';

/**
 * Reorders the dashboard. Pinned widgets form a block at the top, so moving an
 * unpinned widget never jumps over a pinned one.
 */
export function moveWidget(
  layout: DashboardWidget[],
  id: string,
  direction: MoveDirection,
): DashboardWidget[] {
  const index = layout.findIndex((widget) => widget.id === id);
  if (index < 0) return layout;

  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= layout.length) return layout;

  const widget = layout[index];
  if (!widget) return layout;

  // Do not let an unpinned widget jump above a pinned one.
  if (widget.pinned && target > 0 && !layout[target]?.pinned) return layout;
  if (!widget.pinned && target < index && layout[target]?.pinned) return layout;

  const next = [...layout];
  const other = next[target];
  if (!other) return layout;

  next[index] = other;
  next[target] = widget;
  return next;
}

/** Renumbers `y` so the widgets stack without holes. */
export function compactLayout(layout: DashboardWidget[]): DashboardWidget[] {
  let cursor = 0;
  const stacked = layout.map((widget) => {
    const next = { ...widget, x: 0, y: cursor };
    cursor += widget.h;
    return next;
  });
  return normaliseLayout(stacked);
}

export function isDefaultLayout(layout: DashboardWidget[]): boolean {
  return layout.length === DEFAULT_LAYOUT.length;
}
