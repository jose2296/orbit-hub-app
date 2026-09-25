import type { DashboardWidget } from '@orbit-hub/contracts';
import { describe, expect, it } from 'vitest';

import {
  addWidget,
  compactLayout,
  DEFAULT_LAYOUT,
  moveWidget,
  normaliseLayout,
  removeWidget,
  togglePin,
} from '../src/lib/dashboard/layout';

const orders = (widgets: DashboardWidget[]) => widgets.map((widget) => widget.id);

describe('normaliseLayout', () => {
  it('returns an empty layout for rubbish input', () => {
    expect(normaliseLayout(null)).toEqual([]);
    expect(normaliseLayout('nope')).toEqual([]);
    expect(normaliseLayout(42)).toEqual([]);
  });

  it('drops widgets that fail validation', () => {
    const result = normaliseLayout([
      { id: 'ok', kind: 'tasks', x: 0, y: 0, w: 6, h: 4, pinned: false },
      { id: 'broken', kind: 'not-a-kind', x: 0, y: 0, w: 6, h: 4, pinned: false },
      { kind: 'tasks', x: 0, y: 0, w: 6, h: 4, pinned: false },
    ]);

    expect(orders(result)).toEqual(['ok']);
  });

  it('removes duplicate ids, keeping the first', () => {
    const result = normaliseLayout([
      { id: 'same', kind: 'tasks', x: 0, y: 0, w: 4, h: 2, pinned: false },
      { id: 'same', kind: 'stats', x: 0, y: 0, w: 4, h: 2, pinned: false },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('tasks');
  });

  it('clamps sizes to the grid instead of failing', () => {
    const [widget] = normaliseLayout([
      { id: 'huge', kind: 'tasks', x: 0, y: 0, w: 99, h: 999, pinned: false },
    ]);

    expect(widget?.w).toBeLessThanOrEqual(12);
    expect(widget?.h).toBeLessThanOrEqual(24);
  });

  it('brings pinned widgets to the top without losing the chosen order', () => {
    const result = normaliseLayout([
      { id: 'a', kind: 'tasks', x: 0, y: 0, w: 6, h: 2, pinned: false },
      { id: 'b', kind: 'stats', x: 0, y: 2, w: 6, h: 2, pinned: true },
      { id: 'c', kind: 'recent_lists', x: 0, y: 4, w: 6, h: 2, pinned: false },
    ]);

    expect(orders(result)).toEqual(['b', 'a', 'c']);
  });
});

describe('addWidget', () => {
  it('appends below the current stack', () => {
    const layout = normaliseLayout(DEFAULT_LAYOUT);
    const result = addWidget(layout, 'calendar');
    const calendar = result.find((widget) => widget.kind === 'calendar');

    expect(calendar).toBeDefined();
    expect(calendar?.y).toBeGreaterThanOrEqual(6);
  });

  it('refuses a widget that is already there', () => {
    const layout = normaliseLayout(DEFAULT_LAYOUT);
    expect(addWidget(layout, 'tasks')).toHaveLength(layout.length);
  });

  it('never exceeds the maximum widget count', () => {
    let layout: DashboardWidget[] = [];
    for (let index = 0; index < 40; index += 1) {
      layout = addWidget(layout, index % 2 === 0 ? 'recent_notes' : 'calendar');
    }
    expect(layout.length).toBeLessThanOrEqual(24);
  });
});

describe('removeWidget and togglePin', () => {
  it('removes by id', () => {
    const layout = normaliseLayout(DEFAULT_LAYOUT);
    const result = removeWidget(layout, 'tasks');

    expect(orders(result)).not.toContain('tasks');
    expect(result).toHaveLength(layout.length - 1);
  });

  it('ignores an unknown id', () => {
    const layout = normaliseLayout(DEFAULT_LAYOUT);
    expect(removeWidget(layout, 'ghost')).toHaveLength(layout.length);
  });

  it('pins and unpins, and the newly pinned one comes first', () => {
    // A layout with nothing pinned yet, so the assertion is about the pin.
    const layout = normaliseLayout([
      { id: 'a', kind: 'tasks', x: 0, y: 0, w: 6, h: 2, pinned: false },
      { id: 'b', kind: 'stats', x: 0, y: 2, w: 6, h: 2, pinned: false },
    ]);

    const pinned = togglePin(layout, 'b');
    expect(pinned[0]?.id).toBe('b');
    expect(pinned[0]?.pinned).toBe(true);

    // Unpinning leaves the widget where the pin put it: the order is the one
    // the user chose by pinning, not an automatic re-sort.
    const unpinned = togglePin(pinned, 'b');
    expect(unpinned.find((widget) => widget.id === 'b')?.pinned).toBe(false);
    expect(orders(unpinned)).toEqual(['b', 'a']);
  });

  it('keeps already pinned widgets above a newly pinned one', () => {
    const layout = normaliseLayout(DEFAULT_LAYOUT);
    const pinned = togglePin(layout, 'stats');

    // quick-actions was already pinned, so it stays first and stats follows.
    expect(orders(pinned)).toEqual(['quick-actions', 'stats', 'tasks', 'recent-lists']);
  });
});

describe('moveWidget', () => {
  it('moves a widget up and down', () => {
    const layout = normaliseLayout([
      { id: 'a', kind: 'tasks', x: 0, y: 0, w: 6, h: 2, pinned: false },
      { id: 'b', kind: 'stats', x: 0, y: 2, w: 6, h: 2, pinned: false },
      { id: 'c', kind: 'recent_lists', x: 0, y: 4, w: 6, h: 2, pinned: false },
    ]);

    expect(orders(moveWidget(layout, 'c', 'up'))).toEqual(['a', 'c', 'b']);
    expect(orders(moveWidget(layout, 'a', 'down'))).toEqual(['b', 'a', 'c']);
  });

  it('does nothing at the edges', () => {
    const layout = normaliseLayout(DEFAULT_LAYOUT);

    expect(orders(moveWidget(layout, 'tasks', 'up'))).toEqual(orders(layout));
    expect(orders(moveWidget(layout, 'stats', 'down'))).toEqual(orders(layout));
  });

  it('keeps unpinned widgets below the pinned block', () => {
    const layout = normaliseLayout([
      { id: 'pinned', kind: 'quick_actions', x: 0, y: 0, w: 12, h: 2, pinned: true },
      { id: 'a', kind: 'tasks', x: 0, y: 2, w: 6, h: 2, pinned: false },
    ]);

    // 'a' cannot jump above the pinned widget.
    expect(orders(moveWidget(layout, 'a', 'up'))).toEqual(['pinned', 'a']);
  });

  it('ignores an unknown widget', () => {
    const layout = normaliseLayout(DEFAULT_LAYOUT);
    expect(moveWidget(layout, 'ghost', 'up')).toHaveLength(layout.length);
  });
});

describe('compactLayout', () => {
  it('removes the holes left by a removal', () => {
    const layout = normaliseLayout([
      { id: 'a', kind: 'tasks', x: 0, y: 0, w: 6, h: 3, pinned: false },
      { id: 'b', kind: 'stats', x: 6, y: 3, w: 6, h: 2, pinned: false },
      { id: 'c', kind: 'recent_lists', x: 0, y: 5, w: 6, h: 2, pinned: false },
    ]);

    const compacted = compactLayout(removeWidget(layout, 'b'));

    expect(orders(compacted)).toEqual(['a', 'c']);
    expect(compacted.map((widget) => widget.y)).toEqual([0, 3]);
  });
});
