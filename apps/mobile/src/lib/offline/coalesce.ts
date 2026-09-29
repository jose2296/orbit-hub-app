/**
 * Folding a batch before it goes out.
 *
 * A note is created and typed into straight away, so the outbox holds a `create`
 * and then an `update` for the same row. Both leave in the same batch, in order,
 * and the `update` carries `baseVersion: 0` because the local cache has not seen
 * the server's answer to the create. The server has the row at version 1, so
 * `0 !== 1`, and a document nobody else ever touched arrives as a conflict for
 * somebody to resolve.
 *
 * The fix is here rather than in the note: it is not a note problem, it is a
 * problem with anything you create and edit in one breath, and it belongs in the
 * engine that sends the batch.
 *
 * Pure and in its own module because the timing of the network is not the part
 * worth testing. This is, and it cannot be tested from a module that imports
 * React Native.
 */

export interface CoalescableOperation {
  operationId: string;
  kind: string;
  entity: string;
  entityId: string;
  payload: string | null;
  baseVersion: number;
}

/**
 * Two payloads, later over earlier.
 *
 * A row that is not JSON does not take the batch down with it: the corrupt half
 * is dropped and the readable half is kept, because losing one operation is bad
 * and losing every operation queued behind it is worse.
 */
function mergePayloads(earlier: string | null, later: string | null): Record<string, unknown> {
  const read = (raw: string | null): Record<string, unknown> => {
    if (!raw) return {};
    try {
      const value = JSON.parse(raw) as unknown;
      return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };
  return { ...read(earlier), ...read(later) };
}

export function coalescePendingOperations<T extends CoalescableOperation>(
  pending: T[],
): { operations: T[]; folded: Set<string> } {
  const folded = new Set<string>();
  if (pending.length < 2) return { operations: pending, folded };

  const createIndexByEntity = new Map<string, number>();
  const out: T[] = [];

  for (const record of pending) {
    const key = `${record.entity}:${record.entityId}`;
    const createIndex = createIndexByEntity.get(key);

    if (createIndex === undefined) {
      if (record.kind === 'create') createIndexByEntity.set(key, out.length);
      out.push(record);
      continue;
    }

    // A delete of a row whose create never went out is not an update, it is a
    // change of mind: the create becomes the delete, because the server has never
    // heard of the row and has nothing to tombstone.
    if (record.kind === 'delete') {
      out[createIndex] = {
        ...out[createIndex]!,
        kind: 'delete',
        payload: null,
        base: null,
      } as T;
      folded.add(record.operationId);
      continue;
    }

    const create = out[createIndex]!;
    out[createIndex] = {
      ...create,
      payload: JSON.stringify(mergePayloads(create.payload, record.payload)),
    };
    folded.add(record.operationId);
  }

  return { operations: out, folded };
}

/**
 * The create an update should be folded into, or `null` when there is not one.
 *
 * This is the case the batch folding above cannot reach, and it is the common
 * one. The create leaves in its own flush, about a second and a half after it is
 * written, and the first keystroke after that becomes an update in a *later*
 * flush. The two are never in the same batch, so folding at send time does
 * nothing and the conflict happens anyway.
 *
 * `null` means the row exists on the server, so the update carries a real
 * `baseVersion` and a real conflict, and folding it would throw away the merge
 * that decides it.
 */
export function foldIntoCreate<T extends CoalescableOperation>(
  pending: T[],
  update: T,
): T | null {
  const create = pending.find(
    (record) =>
      record.entity === update.entity &&
      record.entityId === update.entityId &&
      record.kind === 'create',
  );
  if (!create) return null;

  if (update.kind === 'delete') {
    // A row the server has never heard of, deleted before it left. The create
    // becomes the delete and there is nothing to tombstone on either side.
    return { ...create, kind: 'delete', payload: null, base: null };
  }

  return {
    ...create,
    payload: JSON.stringify(mergePayloads(create.payload, update.payload)),
  };
}
