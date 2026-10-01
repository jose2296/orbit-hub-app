import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * The recipient's side of an invitation.
 *
 * Until this endpoint existed, the only way to answer an invitation was a token from a
 * mail. That is a notification that is also the only door, and the door is in a message
 * that gets filtered, searched and buried — so somebody who had been invited had no way
 * to find out from the app itself that they had been.
 *
 * What matters is not that the list works. It is **who is in it**: an invitation is
 * addressed to an email, and the expensive mistake is answering on somebody else's
 * behalf. So each test makes its own two people rather than sharing a cast across the
 * file: a shared cast means the counts depend on the order the tests run in, and a test
 * that only passes in one order is a test that will fail once for a reason nobody reads.
 */
describe('las invitaciones que te han hecho a ti', () => {
  let api: TestServer;

  beforeAll(async () => {
    api = await startTestServer();
  });

  afterAll(async () => {
    await api.close();
  });

  /** Two people and a space that belongs to the first one. */
  async function escena() {
    const ana = await createVerifiedUser(api, { displayName: 'Ana' });
    const beto = await createVerifiedUser(api, { displayName: 'Beto' });
    const nombre = `Casa de Ana ${randomUUID().slice(0, 8)}`;
    const casaId = await crearEspacio(ana, nombre);
    return { ana, beto, casaId, nombre };
  }

  async function invitarA(
    ana: TestUser,
    casaId: string,
    aQuien: TestUser,
    role: 'editor' | 'viewer' = 'editor',
  ): Promise<string> {
    const creada = await api.post(
      `/workspaces/${casaId}/invitations`,
      { role, email: aQuien.email },
      ana.accessToken,
    );
    expect(creada.status).toBe(201);
    return creada.body.data.token as string;
  }

  async function miBandeja(user: TestUser) {
    const respuesta = await api.get('/invitations', user.accessToken);
    expect(respuesta.status).toBe(200);
    return respuesta.body.data.items as {
      id: string;
      token: string;
      workspaceId: string;
      workspaceName: string;
      role: string;
      invitedEmail: string | null;
      invitedBy: { displayName: string };
    }[];
  }

  it('la invitacion aparece en la bandeja del invitado, con el papel y quien la hizo', async () => {
    const { ana, beto, casaId, nombre } = await escena();
    await invitarA(ana, casaId, beto, 'editor');

    const bandeja = await miBandeja(beto);
    expect(bandeja).toHaveLength(1);

    const suya = bandeja[0]!;
    expect(suya.workspaceId).toBe(casaId);
    expect(suya.workspaceName).toBe(nombre);
    expect(suya.role).toBe('editor');
    expect(suya.invitedBy.displayName).toBe('Ana');
    // The token, because accepting is the existing endpoint and this list has to be
    // able to call it. It is only ever handed to the person the mail was addressed to.
    expect(suya.token).toBeTruthy();

    // And the owner's list is the *other* question: who I invited.
    const suPropia = await api.get(`/workspaces/${casaId}/invitations`, ana.accessToken);
    expect(suPropia.body.data.items).toHaveLength(1);
    expect(suPropia.body.data.items[0].invitedEmail).toBe(beto.email);
  });

  it('nadie ve las invitaciones de otro', async () => {
    const { ana, beto, casaId } = await escena();
    await invitarA(ana, casaId, beto);

    // Beto's inbox has the one Ana sent him and nothing else. A directory of other
    // people's pending mail is not what this endpoint is.
    const deBeto = await miBandeja(beto);
    expect(deBeto.every((i) => i.invitedEmail === beto.email)).toBe(true);

    // A third person with no relation at all sees an empty list, not a 403 that
    // tells them whether anything exists.
    const carolina = await createVerifiedUser(api, { displayName: 'Carolina' });
    expect(await miBandeja(carolina)).toEqual([]);
  });

  it('aceptada sale de la bandeja, y el que acepta entra al espacio', async () => {
    const { ana, beto, casaId } = await escena();
    const token = await invitarA(ana, casaId, beto);
    expect(await miBandeja(beto)).toHaveLength(1);

    const aceptado = await api.post(`/invitations/${token}/accept`, {}, beto.accessToken);
    expect(aceptado.status).toBe(200);

    // The whole point of the feature: the space is reachable without ever opening a
    // mail, and the invitation is not offered again.
    expect(await miBandeja(beto)).toEqual([]);

    const espacios = await api.get('/workspaces', beto.accessToken);
    expect(espacios.body.data.items.map((w: { id: string }) => w.id)).toContain(casaId);
  });

  it('rechazada tambien sale de la bandeja', async () => {
    const { ana, beto, casaId } = await escena();
    const token = await invitarA(ana, casaId, beto);

    const rechazada = await api.post(
      `/invitations/${token}/decline`,
      {},
      beto.accessToken,
    );
    expect(rechazada.status).toBe(204);

    expect(await miBandeja(beto)).toEqual([]);
  });

  it('el papel se ve antes de decidir, que es lo que hace la decision', async () => {
    const { ana, beto, casaId } = await escena();
    await invitarA(ana, casaId, beto, 'viewer');

    const [suya] = await miBandeja(beto);
    expect(suya!.role).toBe('viewer');
  });

  it('sin sesion no hay bandeja, y el 401 es el de siempre', async () => {
    const sinSesion = await api.get('/invitations');
    expect(sinSesion.status).toBe(401);
  });

  /**
   * A space, made the way the app makes one: through the outbox.
   *
   * Not through a test-only endpoint, because an endpoint only the tests can reach is
   * one that never meets the code the app uses — and the second thing to break would
   * be the difference between the two.
   */
  async function crearEspacio(user: TestUser, name: string): Promise<string> {
    const id = randomUUID();
    const response = await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          {
            operationId: randomUUID(),
            clientId: 'test-client-invitations',
            entity: 'workspace',
            kind: 'create',
            entityId: id,
            baseVersion: 0,
            payload: { name },
            base: null,
            clientTimestamp: new Date().toISOString(),
          },
        ],
      },
      user.accessToken,
    );

    expect(response.body.data.results[0].status).toBe('applied');
    return id;
  }
});