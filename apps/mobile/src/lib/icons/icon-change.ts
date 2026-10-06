import type { IconColor, IconRef } from "@orbit-hub/contracts";

/**
 * What tapping a control in the picker changes.
 *
 * Every field is optional on purpose. Tapping a colour is not tapping an icon
 * with a colour: the colour control only ever changes the colour state of the
 * panel, and the icon changes when an icon is tapped. Sending the whole icon
 * along with every tap is what used to write back whatever the panel thought
 * the row had — so choosing a colour right after choosing an icon took the
 * icon away.
 */
export interface IconChange {
  icon?: IconRef | null;
  color?: IconColor;
}

/**
 * Just what changed between the icon there was and the one there is now.
 *
 * A pure function in `lib` and not in the sheet because no test in this repo
 * renders a component: the panel cannot be asked, but this can. The screen
 * that opened the picker keeps the **id** of the row and merges this into it,
 * never a copy of the icon — a copy goes stale on the first write and the
 * panel hands the stale one back to the server.
 */
export function iconChange(current: IconRef | null | undefined, next: IconRef | null): IconChange {
  if (next === null) return { icon: null };
  if (!current) return { icon: next };

  const change: IconChange = {};
  if (
    current.type !== next.type ||
    current.value !== next.value ||
    (current.type === "vector" &&
      next.type === "vector" &&
      (current.library !== next.library || current.style !== next.style))
  ) {
    change.icon = next;
  }
  if (current.color !== next.color) {
    change.color = next.color;
  }
  return change;
}

/**
 * Whether two icons are the one the person would recognise as the same.
 *
 * Field by field and not by reference: the panel keeps what was picked in its
 * draft and what the row has in the row, and two different objects saying the
 * same icon are the same choice. `JSON.stringify` would also answer, but only
 * while both sides write the keys in the same order — which nothing promises.
 */
export function mismoIcono(a: IconRef | null | undefined, b: IconRef | null | undefined): boolean {
  if (!a || !b) return a == null && b == null;
  if (a.type !== b.type || a.value !== b.value || a.color !== b.color) return false;
  if (a.type === "vector" && b.type === "vector") {
    return a.library === b.library && a.style === b.style;
  }
  return true;
}
