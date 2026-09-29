import { useMemo } from "react";

import { useSyncStatus } from "@/hooks/use-sync-status";

/** Whether there is something in the sync centre that needs this person. */
export interface SyncAttention {
  /** Whether the menu button should carry a dot. */
  needed: boolean;
  /** How urgent it is, which is what decides the colour of the dot. */
  severity: "blocking" | "pending";
  /** What to tell a screen reader the dot is about. */
  count: number;
}

/**
 * Whether the menu should say "come and look at this".
 *
 * The sync centre used to be a card on the home screen, which meant it said
 * itself out loud on every visit whether anything had happened or not. A panel
 * that is always talking is a panel nobody reads, and by the third visit the
 * card was furniture.
 *
 * So it is a dot on the menu button instead, and it is only there when there is
 * genuinely something to do: a conflict nobody can answer by themselves, a
 * failure the retry will not fix on its own, or work that has not left the
 * device. Ordinary syncing is not one of those — it happens on its own and the
 * dot for it would be a dot that is on almost always.
 *
 * It reads the same tables the rest of the sync does and is correct offline,
 * because "you have work that has not left this device" is exactly as true with
 * no connection as with one.
 */
export function useSyncAttention(): SyncAttention {
  const { status } = useSyncStatus();

  return useMemo(() => {
    // A conflict and an error both stop and wait for a person. They are the two
    // things the app cannot resolve by itself, and they are what the dot is for.
    if (status.pendingConflicts > 0 || status.state === "blocked") {
      return {
        needed: true,
        severity: "blocking",
        count: status.pendingConflicts,
      };
    }
    if (status.state === "error") {
      return { needed: true, severity: "blocking", count: 0 };
    }
    // Work still on the device is worth a dot, because it is the one case where
    // going to the sync centre does something: it tells you what is waiting.
    if (status.pendingOperations > 0) {
      return {
        needed: true,
        severity: "pending",
        count: status.pendingOperations,
      };
    }
    return { needed: false, severity: "pending", count: 0 };
  }, [status.pendingConflicts, status.pendingOperations, status.state]);
}
