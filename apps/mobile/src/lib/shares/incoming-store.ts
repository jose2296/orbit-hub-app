import { useSyncExternalStore } from "react";

import type { IncomingShare } from "@orbit-hub/contracts";

import { countUnseen, markAllSeen } from "./last-seen";

/**
 * What has arrived, shared by everything that has to agree about it.
 *
 * This exists because it did **not** exist, and the badge was broken in a way that
 * looked like a bug in the counting:
 *
 * - The menu button and the drawer panel each called `useShares()`, and each got its
 *   own copy of the list and its own "seen" tick.
 * - The panel stamped itself as seen. The button, reading its **own** copy, was never
 *   told, so its dot kept the number it had.
 *
 * Two copies of one number is the same mistake as two copies of one message, and the
 * second copy is the one people believe.
 *
 * A module-level store with `useSyncExternalStore` is the small thing that fixes it
 * without inventing a state library: one list, one tick, every reader on the same
 * value, and a reader that renders outside the provider still works.
 */

let incoming: IncomingShare[] = [];
let vistoTick = 0;

const oyentes = new Set<() => void>();

function avisar() {
  for (const o of oyentes) o();
}

function suscribir(o: () => void) {
  oyentes.add(o);
  return () => void oyentes.delete(o);
}

const instantanea = () => incoming;
const instantaneaTick = () => vistoTick;

/** Called by the hook once the request comes back. */
export function fijarIncoming(items: IncomingShare[]): void {
  // The same array contents must not notify anybody: an equal list re-rendering every
  // reader of this store is a drawer open that redraws for no reason.
  if (
    incoming.length === items.length &&
    incoming.every(
      (item, i) =>
        item.id === items[i]?.id && item.createdAt === items[i]?.createdAt,
    )
  ) {
    return;
  }
  incoming = items;
  avisar();
}

/** Called when the list has been on screen. See `last-seen.ts` for the rule. */
export function marcarVisto(userId: string): void {
  markAllSeen(userId);
  vistoTick += 1;
  avisar();
}

/** `null` with no session: nothing to have missed, not a zero. */
export function useUnseen(userId: string | null): number {
  const items = useSyncExternalStore(suscribir, instantanea, instantanea);
  const tick = useSyncExternalStore(
    suscribir,
    instantaneaTick,
    instantaneaTick,
  );
  // `tick` is read for its side effect of invalidating this render, which is the whole
  // reason it is subscribed to. Without it the number is computed once and cached for
  // ever, and moving the "seen" line changes nothing on screen.
  void tick;
  return countUnseen(items, userId ?? "");
}
