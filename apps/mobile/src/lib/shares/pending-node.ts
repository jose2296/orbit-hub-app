import type { PendingOperationRecord } from "@/lib/offline/local-store";

/**
 * Whether this node is still sitting in the outbox on this device.
 *
 * **Sharing a link is not offline-first, and the reason is in `useShares`: a grant is
 * decided on the server when somebody presses the button.** So the node being shared
 * has to *exist on the server* before it can be granted — and a folder, a list or an
 * item created thirty seconds ago is still a pending local operation with no row
 * behind it on the other side.
 *
 * What happened when that was ignored: `POST /shares` answered `404 That does not
 * exist`, which is true and says nothing. The panel showed that sentence under a form
 * that looks finished, and the only way out was to reload the page — which flushes the
 * outbox on boot, so the node arrives and the second attempt works. A bug whose fix is
 * "reload", on a phone where reloading means closing the app.
 *
 * Pure on purpose: this is the decision, and the decision is the thing that has to be
 * provable without rendering React Native.
 */
/**
 * The four kinds of thing that can be shared, minus the space itself.
 *
 * `shareNodeTypeSchema` has five and the fifth is `workspace`: a space is shareable,
 * but it is not *filed* anywhere, so it never goes through this sheet and treating it
 * as shareable here would be a claim about a code path that does not exist.
 *
 * The words are the same on both sides — the outbox entity for an item is `list_item`
 * and the API's node type is also `list_item`. There was a table mapping one to the
 * other here, written on the assumption that they differed; they do not, and the
 * assumption was the only thing in this file that was wrong.
 */
const SHAREABLE = new Set(['folder', 'list', 'list_item', 'note']);

export function pendingOperationFor(
  pending: readonly PendingOperationRecord[],
  target: { nodeType: string; nodeId: string },
): PendingOperationRecord | null {
  /*
    Not asked about a kind that cannot be shared. The panel is in the outbox and it is
    content, and matching on the id alone would call it pending — harmless today only
    because the share sheet never names one. "Harmless because nobody asks" is how a
    sheet that starts naming a new kind gets a "reload the page" bug nobody can explain.
  */
  if (!SHAREABLE.has(target.nodeType)) return null;

  return (
    pending.find(
      (operation) =>
        operation.entityId === target.nodeId && operation.entity === target.nodeType,
    ) ?? null
  );
}
