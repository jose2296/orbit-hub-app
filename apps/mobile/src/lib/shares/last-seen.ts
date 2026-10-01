import type { IncomingShare } from "@orbit-hub/contracts";

import { keyValueStore } from "@/lib/storage/key-value";

/**
 * "Ya lo he mirado", which is what a badge needs and what nothing else here had.
 *
 * A module of its own, not a hook, for the same reason `fileable-spaces.ts` is one:
 * this is the part with a rule in it, and a rule in a hook cannot be checked without
 * rendering React Native — which does not run in the test environment.
 *
 * The state is **one timestamp, per account, on this device**, and all three of those
 * are decisions rather than defaults:
 *
 * - **One timestamp and not a flag per item.** Sharing the same list twice, or
 *   something you already placed, would otherwise have to be marked twice, and a flag
 *   per item is a second list that can disagree with the inbox. "Newer than the last
 *   time I looked" cannot disagree with anything: it is a comparison, not a record.
 * - **Per account.** The key carries the user id. One key for everybody means opening
 *   the drawer as Ana clears Beto's badge, and the next thing to arrive is invisible.
 * - **On this device.** It is a notification, not a read receipt, and nothing is sent
 *   to the server. Open the drawer on the phone, the phone's badge clears, the web's
 *   does not. That is what a badge should do, and it costs no column and no migration.
 */

/** Namespaced by user id, which is the whole reason this is a function and not a const. */
const clave = (userId: string) => `orbit.shares.lastSeen.${userId}`;

/**
 * When this person last had the list on screen, or null if never.
 *
 * Null means **everything currently there counts as unseen**, and that is deliberate.
 * The alternative — treat whatever is already sitting there as seen — silently hides
 * anything that arrived while they were logged out, which is exactly the thing a badge
 * is for. A first run showing a number is honest: they have not looked yet.
 */
export function lastSeenAt(userId: string): number | null {
  const raw = keyValueStore.get(clave(userId));
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  // A store that hands back something else — a wiped key, a half-written value, a
  // future version of this file — must not read as "seen at the beginning of time",
  // which would hide everything.
  return Number.isFinite(parsed) ? parsed : null;
}

export function markAllSeen(userId: string, at: number = Date.now()): void {
  keyValueStore.set(clave(userId), String(at));
}

/**
 * How many of these arrived since they last looked.
 *
 * The comparison is `>`, not `>=`, and the boundary is why: `markAllSeen` is called
 * with the time the drawer opened, and an invitation can land in the same millisecond.
 * With `>=` the one that just arrived would be counted as already seen and would
 * never be counted at all, because the next `markAllSeen` moves the line past it.
 *
 * An entry whose `createdAt` cannot be parsed counts as unseen. A share you cannot
 * date is not a share you have seen.
 */
export function countUnseen(
  items: readonly IncomingShare[],
  userId: string,
): number {
  const visto = lastSeenAt(userId);
  if (visto === null) return items.length;

  let nuevos = 0;
  for (const item of items) {
    const creada = Date.parse(item.createdAt);
    if (!Number.isFinite(creada) || creada > visto) nuevos += 1;
  }
  return nuevos;
}
