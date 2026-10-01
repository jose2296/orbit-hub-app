import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { shareNodeTypeSchema } from '@orbit-hub/contracts';

import { getDatabase } from '../src/db/client.js';
import { shareService } from '../src/modules/shares/share-service.js';
import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer } from './helpers';

let api: TestServer;

beforeAll(async () => {
  api = await startTestServer();
});

afterAll(async () => {
  await api.close();
});

/**
 * The template is not a shareable node, and this is where that is proved rather than
 * asserted in a comment.
 *
 * It was in `shareNodeTypeSchema` and in the database CHECK, which is the strongest
 * possible way to promise something the other half of the codebase does not do:
 * `toEntityName` has no name for it, so revoking one produced no tombstone and the
 * other phone kept it forever. Both halves are checked here — the contract and the
 * database — because either one alone would leave the promise standing.
 */
describe('una plantilla no se comparte con una persona', () => {
  it('el contrato la rechaza, y no por defecto sino de verdad', () => {
    expect(shareNodeTypeSchema.safeParse('note_template').success).toBe(false);
    // And the five that do work, so the check is not just refusing everything.
    for (const uno of ['workspace', 'folder', 'list', 'list_item', 'note']) {
      expect(shareNodeTypeSchema.safeParse(uno).success).toBe(true);
    }
  });

  it('la base de datos la rechaza tambien', async () => {
    const { db } = await getDatabase();
    const yo = await createVerifiedUser(api, { displayName: 'Dueno' });
    const nodeId = randomUUID();

    await expect(
      db.execute(
        // Written as a literal on purpose: this is the CHECK talking, not the
        // contract, and going through the application would already have been
        // stopped by the enum before the database was asked.
        `insert into shares (owner_user_id, node_type, node_id, grantee_user_id, role)
         values ('${yo.userId}', 'note_template', '${nodeId}', '${yo.userId}', 'viewer')`,
      ),
    ).rejects.toThrow();
  });

  it('y una plantilla compartida por scope sigue funcionando, que es otra cosa', async () => {
    // The two mechanisms must not be confused. `scope` shares a template with a
    // space or with everybody; that is built, it works, and removing the grant did
    // not touch it. A test that only checked "the share is gone" would pass even if
    // this had been broken too.
    const yo = await createVerifiedUser(api, { displayName: 'Plantillas' });
    const creada = await api.post(
      '/notes/templates',
      { name: 'Receta', scope: 'public', icon: 'restaurant-outline', description: ' algo', document: '<p>Sal</p>' },
      yo.accessToken,
    );
    expect(creada.status).toBe(201);

    const plantilla = creada.body?.data;
    expect(plantilla?.scope).toBe('public');

    const compartida = await api.post(
      `/notes/templates/${plantilla?.id}/share`,
      // `workspace` and not `public`: `public` is what a template is *born* with,
      // and the share endpoint only moves it between personal and a space. Asking
      // for `public` there is a 422, which is the contract being precise about the
      // only two acts it has.
      { scope: 'personal' },
      yo.accessToken,
    );
    expect(compartida.status).toBe(200);
  });

  it('un tipo de nodo desconocido no se resuelve en nada', async () => {
    // `resolveTarget` cae en la consulta de elementos para cualquier cosa que no
    // sepa, y por eso el enum importa: un tipo que se colara llegaria aqui como
    // un 404 con un motivo equivocado.
    await expect(
      shareService.resolveTarget('note_template' as never, randomUUID()),
    ).rejects.toThrow(/does not exist/i);
  });
});
