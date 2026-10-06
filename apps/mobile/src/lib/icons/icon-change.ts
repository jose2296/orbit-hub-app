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
