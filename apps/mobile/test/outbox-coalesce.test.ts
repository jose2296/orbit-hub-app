import { describe, expect, it } from 'vitest';

import { coalescePendingOperations, foldIntoCreate } from '../src/lib/offline/coalesce';
import type { CoalescableOperation } from '../src/lib/offline/coalesce';

/**
 * A note is created and typed into straight away, so the outbox holds a `create`
 * and then an `update` for the same row in the same batch. The `update` carries
 * `baseVersion: 0` because the local cache has not seen the answer to the create,
 * and the server has the row at version 1 — so a document nobody else ever
 * touched arrives as a conflict for somebody to resolve.
 *
 * This is the fix, and the tests are here because the failure it prevents is not
 * visible: the note saves, the text is right, and one line later the sync centre
 * says there is a conflict.
 */
function op(over: Partial<CoalescableOperation> & { operationId: string }): CoalescableOperation {
  return {
    kind: 'update',
    entity: 'note',
    entityId: 'n1',
    baseVersion: 0,
    payload: null,
    ...over,
  };
}

const payload = (raw: CoalescableOperation | null | undefined): Record<string, unknown> =>
  JSON.parse(raw?.payload ?? '{}');

describe('coalescePendingOperations', () => {
  it('folds an update into the create it belongs to', () => {
    const { operations, folded } = coalescePendingOperations([
      op({ operationId: 'a', kind: 'create', payload: JSON.stringify({ title: 'Salsa', document: '' }) }),
      op({ operationId: 'b', kind: 'update', payload: JSON.stringify({ document: '<p>Tomates</p>' }) }),
    ]);

    expect(operations).toHaveLength(1);
    expect(operations[0]?.kind).toBe('create');
    expect(payload(operations[0])).toEqual({
      title: 'Salsa',
      document: '<p>Tomates</p>',
    });
    expect([...folded]).toEqual(['b']);
  });

  it('folds several updates into one create', () => {
    const { operations, folded } = coalescePendingOperations([
      op({ operationId: 'a', kind: 'create', payload: JSON.stringify({ title: 'Salsa', document: '' }) }),
      op({ operationId: 'b', kind: 'update', payload: JSON.stringify({ document: '<p>Tom</p>' }) }),
      op({ operationId: 'c', kind: 'update', payload: JSON.stringify({ document: '<p>Tomates</p>' }) }),
    ]);

    expect(operations).toHaveLength(1);
    // The last one wins, and it is the one the person can see on the screen.
    expect(payload(operations[0])['document']).toBe('<p>Tomates</p>');
    expect([...folded].sort()).toEqual(['b', 'c']);
  });

  it('does not touch an update on a row that already exists', () => {
    // Two devices editing the same note is a real conflict with a real base, and
    // folding it would throw away the merge that decides it.
    const { operations, folded } = coalescePendingOperations([
      op({ operationId: 'a', kind: 'update', baseVersion: 4, payload: JSON.stringify({ document: 'uno' }) }),
      op({ operationId: 'b', kind: 'update', baseVersion: 4, payload: JSON.stringify({ document: 'dos' }) }),
    ]);

    expect(operations).toHaveLength(2);
    expect(folded.size).toBe(0);
  });

  it('does not fold a create into another row', () => {
    const { operations } = coalescePendingOperations([
      op({ operationId: 'a', kind: 'create', entityId: 'n1', payload: JSON.stringify({ title: 'Una' }) }),
      op({ operationId: 'b', kind: 'create', entityId: 'n2', payload: JSON.stringify({ title: 'Dos' }) }),
      op({ operationId: 'c', kind: 'update', entityId: 'n2', payload: JSON.stringify({ title: 'Dos' }) }),
    ]);

    expect(operations).toHaveLength(2);
  });

  it('turns a create followed by a delete into a delete', () => {
    // The server never heard of the row, so there is nothing to tombstone: what
    // it needs to know is that it should not create it either.
    const { operations, folded } = coalescePendingOperations([
      op({ operationId: 'a', kind: 'create', payload: JSON.stringify({ title: 'Nace y muere' }) }),
      op({ operationId: 'b', kind: 'delete' }),
    ]);

    expect(operations).toHaveLength(1);
    expect(operations[0]?.kind).toBe('delete');
    expect(operations[0]?.payload).toBeNull();
    expect([...folded]).toEqual(['b']);
  });

  it('keeps a delete of a row that does exist as a delete', () => {
    const { operations, folded } = coalescePendingOperations([
      op({ operationId: 'a', kind: 'update', baseVersion: 3 }),
      op({ operationId: 'b', kind: 'delete', baseVersion: 3 }),
    ]);

    expect(operations).toHaveLength(2);
    expect(folded.size).toBe(0);
  });

  it('leaves a single operation alone', () => {
    const { operations, folded } = coalescePendingOperations([
      op({ operationId: 'a', kind: 'create', payload: JSON.stringify({ title: 'Sola' }) }),
    ]);

    expect(operations).toHaveLength(1);
    expect(folded.size).toBe(0);
    expect(operations[0]?.payload).toBe('{"title":"Sola"}');
  });

  it('handles an empty outbox', () => {
    const { operations, folded } = coalescePendingOperations([]);
    expect(operations).toEqual([]);
    expect(folded.size).toBe(0);
  });

  it('survives a payload that is not JSON, rather than throwing away the batch', () => {
    // A corrupt row must not take every other operation in the queue with it.
    const { operations } = coalescePendingOperations([
      op({ operationId: 'a', kind: 'create', payload: '{no json' }),
      op({ operationId: 'b', kind: 'update', payload: JSON.stringify({ document: '<p>x</p>' }) }),
    ]);

    expect(operations.length).toBeGreaterThan(0);
    expect(payload(operations[0])['document']).toBe('<p>x</p>');
  });
});

/**
 * The case the batch folding could not reach, and the common one.
 *
 * The create leaves in its own flush about a second and a half after it is
 * written, and the first keystroke after that becomes an update in a *later*
 * flush. Folding a batch therefore never sees them together, and a note created
 * and typed into in one breath came back as a conflict for somebody to resolve
 * over a document nobody else had touched.
 */
describe('foldIntoCreate, at the moment an edit is enqueued', () => {
  it('folds an update into a create that has not gone out yet', () => {
    const create = op({ operationId: 'a', kind: 'create', payload: JSON.stringify({ title: 'Salsa', document: '' }) });
    const update = op({ operationId: 'b', kind: 'update', baseVersion: 0, payload: JSON.stringify({ document: '<p>Tomates</p>' }) });

    const folded = foldIntoCreate([create], update);

    expect(folded).not.toBeNull();
    // The create's own id: the operation that leaves is the one already queued, so
    // a retry of it is still idempotent.
    expect(folded?.operationId).toBe('a');
    expect(folded?.kind).toBe('create');
    expect(payload(folded)['document']).toBe('<p>Tomates</p>');
    expect(payload(folded)['title']).toBe('Salsa');
  });

  it('leaves an update alone when the row already exists on the server', () => {
    // This is a real conflict with a real base version, decided by the merge.
    const update = op({ operationId: 'b', kind: 'update', baseVersion: 4, payload: JSON.stringify({ document: 'x' }) });

    expect(foldIntoCreate([], update)).toBeNull();
    expect(foldIntoCreate([op({ operationId: 'c', kind: 'update', baseVersion: 3 })], update)).toBeNull();
  });

  it('turns a create into a delete when the note is abandoned before it syncs', () => {
    const create = op({ operationId: 'a', kind: 'create', payload: JSON.stringify({ title: 'Nace' }) });
    const del = op({ operationId: 'b', kind: 'delete' });

    const folded = foldIntoCreate([create], del);

    expect(folded?.kind).toBe('delete');
    expect(folded?.payload).toBeNull();
  });

  it('does not fold into another row of the same note id', () => {
    const create = op({ operationId: 'a', kind: 'create', entityId: 'otra', payload: JSON.stringify({ title: 'Otra' }) });
    const update = op({ operationId: 'b', kind: 'update', entityId: 'n1' });

    expect(foldIntoCreate([create], update)).toBeNull();
  });

  it('does not fold into a create of a different entity kind', () => {
    const create = op({ operationId: 'a', kind: 'create', entity: 'list', entityId: 'n1' });
    const update = op({ operationId: 'b', kind: 'update', entity: 'note', entityId: 'n1' });

    expect(foldIntoCreate([create], update)).toBeNull();
  });
});
