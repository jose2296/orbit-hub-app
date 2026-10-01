import type { Workspace } from '@orbit-hub/contracts';

/**
 * The spaces somebody can file a received thing into.
 *
 * A separate module and not a helper inside the sheet, for one reason: this is the
 * only part of the sheet that can be checked without rendering React Native, and
 * rendering React Native does not happen in the test environment. The rule was wrong
 * once and it was wrong in a way a test would have caught.
 */

/**
 * The spaces you are a **member** of.
 *
 * The sync cache holds more spaces than that. It also holds the ones you can see
 * **because something inside them was shared with you**, and those are not yours:
 * `placeShare` asks the server, the server asks whether you are a member, and the
 * answer is no.
 *
 * Listing them anyway made the "where does this go" panel a trap. Somebody who
 * receives their first shared list has **no space of their own**, so the cache holds
 * exactly one space — the sender's — it is the only row in the picker, and choosing it
 * answers `403 You can only file it in one of your own spaces`. One option, it never
 * worked, and nothing on screen said why.
 *
 * `shared` and not `role`: a `viewer` who was *invited* to a space and a `viewer` who
 * was *given a list* in it are the same role and not the same thing, and only the
 * second one is `shared`. The drawer already draws from that flag, so this is one rule
 * used twice rather than two rules.
 *
 * `!== true` and not `=== false`, so a record cached before the flag existed is still
 * offered. Offering a space that turns out to be somebody else's costs one refused
 * request; hiding a space that is genuinely yours hides the only way to file at all.
 */
export function spacesYouCanFileInto(spaces: Workspace[]): Workspace[] {
  return spaces.filter((space) => space.shared !== true);
}