import { describe, expect, it } from 'vitest';

import type { PendingOperationRecord } from '@/lib/offline/local-store';

import { pendingOperationFor } from '../src/lib/shares/pending-node';

/**
 * A node that has not reached the server cannot be shared, and the app used to find
 * that out from a `404`.
 *
 * The bug was reported as "tengo que recargar la página para poder compartir", which
 * is the tell: reloading flushes the outbox on boot, so the second attempt works.
 * A fix whose instructions are "reload the page" is not a fix on a phone, where
 * reloading means closing the app.
 *
 * This is the decision that fixes it, so it is a pure function and it is tested: the
 * form calls it and then flushes.
 */
function operacion(over: Partial<PendingOperationRecord> = {}): PendingOperationRecord {
  return {
    operationId: 'op-1',
    clientId: 'device-1',
    kind: 'create',
    entity: 'folder',
    entityId: 'folder-1',
    baseVersion: 0,
    payload: null,
    base: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    ...over,
  };
}

describe('lo que sigue en la bandeja de salida', () => {
  const carpeta = { nodeType: 'folder', nodeId: 'folder-1' };

  it('una carpeta recien creada esta pendiente, y hay que subirla antes de compartir', () => {
    const pendiente = pendingOperationFor([operacion()], carpeta);
    expect(pendiente).not.toBeNull();
  });

  it('una carpeta que ya se subio no esta pendiente', () => {
    expect(pendingOperationFor([], carpeta)).toBeNull();
  });

  it('lo pendiente de otra cosa no bloquea esta', () => {
    const otra = [operacion({ entityId: 'folder-999', entity: 'folder' })];
    expect(pendingOperationFor(otra, carpeta)).toBeNull();
  });

  it('un elemento se llama list_item en las dos partes, y se reconoce', () => {
    // There was an alias table here mapping `list_item` to `item`, written on the
    // assumption that the outbox and the API disagree on the word. They do not:
    // `shareNodeTypeSchema` says `list_item` too. `item` is not a node type at all.
    expect(
      pendingOperationFor(
        [operacion({ entity: 'list_item', entityId: 'item-1' })],
        { nodeType: 'list_item', nodeId: 'item-1' },
      ),
    ).not.toBeNull();

    expect(
      pendingOperationFor(
        [operacion({ entity: 'list_item', entityId: 'item-1' })],
        { nodeType: 'item', nodeId: 'item-1' },
      ),
    ).toBeNull();
  });

  it('una actualizacion pendiente tambien bloquea, no solo una creacion', () => {
    const actualizado = operacion({ kind: 'update', entity: 'list', entityId: 'list-1' });
    expect(
      pendingOperationFor([actualizado], { nodeType: 'list', nodeId: 'list-1' }),
    ).not.toBeNull();
  });

  it('el panel no es contenido y no se busca', () => {
    const panel = [operacion({ entity: 'dashboard', entityId: 'd-1' })];
    expect(pendingOperationFor(panel, { nodeType: 'dashboard', nodeId: 'd-1' })).toBeNull();
  });
});