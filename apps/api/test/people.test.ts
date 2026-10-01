import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer } from './helpers';

let api: TestServer;

beforeAll(async () => {
  api = await startTestServer();
});

afterAll(async () => {
  await api.close();
});

async function push(user: { accessToken: string }, operations: Record<string, unknown>[]) {
  return api.post(
    '/sync/push',
    {
      deviceId: randomUUID(),
      lastPulledAt: null,
      operations: operations.map((operation) => ({
        operationId: randomUUID(),
        clientId: 'test-client-people',
        baseVersion: 0,
        payload: {},
        clientTimestamp: new Date().toISOString(),
        ...operation,
      })),
    },
    user.accessToken,
  );
}

/**
 * The directory, and a 200 asserted here rather than at each call site.
 *
 * It was left out of the first version of this file and the whole suite went green
 * against a route that answered 500: the helper read `body?.data?.items ?? []`, and
 * a 500 has no `data`, so a broken endpoint and an account that knows nobody were
 * the same empty array to every assertion in the file. Reading a list of things
 * that are not there is the failure mode that a `?? []` hides.
 */
const directorio = async (token: string) => {
  const r = await api.get('/people', token);
  expect(r.status).toBe(200);
  return r;
};

const correos = (r: { body?: { data?: { items?: { user: { email: string } }[] } } }) =>
  (r.body?.data?.items ?? []).map((p) => p.user.email);

describe('la carpeta de gente', () => {
  it('pide sesion, y sin ella no hay ni una lista vacia', async () => {
    const sinToken = await api.get('/people');
    // No es un 200 con una lista vacia. Una ruta de "gente" sin sesion que
    // contesta `[]` es indistinguishable de una ruta que no encuentra a nadie, y
    // ese 200 es lo que hace que un cliente sin token parezca tener cero contactos
    // en vez de estar roto.
    expect(sinToken.status).toBe(401);
  });

  it('empieza vacia para alguien que no ha tratado con nadie', async () => {
    const sola = await createVerifiedUser(api, { displayName: 'Sola' });
    const r = await directorio(sola.accessToken);
    expect(r.status).toBe(200);
    expect(r.body?.data?.items).toEqual([]);
  });

  it('no se puede buscar a nadie: solo sale quien ya tiene una relacion contigo', async () => {
    // La parte que protege. Un endpoint de gente que devolviera mas de esto
    // permitiria recorrer la tabla de usuarios y averiguar quien tiene cuenta, que
    // es justo lo que el 404 de `resolveGrantee` evita.
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const colega = await createVerifiedUser(api, { displayName: 'Colega' });
    const desconocido = await createVerifiedUser(api, { displayName: 'Desconocido' });

    // Dois usuarios mas existen en la base de datos, y no salen.
    expect(desconocido.email).toBeTruthy();
    expect(colega.email).toBeTruthy();

    const r = await directorio(yo.accessToken);
    expect(correos(r)).not.toContain(desconocido.email);
    expect(correos(r)).not.toContain(colega.email);
  });

  it('sale quien le compartiste algo, con la razon en la direccion del shares', async () => {
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const otra = await createVerifiedUser(api, { displayName: 'Otra' });
    const workspaceId = randomUUID();
    const listId = randomUUID();

    await push(yo, [
      { kind: 'create', entity: 'workspace', entityId: workspaceId, payload: { name: 'Casa', color: 'teal' } },
      { kind: 'create', entity: 'list', entityId: listId, payload: { workspaceId, folderId: null, title: 'Compra', kind: 'tasks', position: 0 } },
    ]);

    const creada = await api.post(
      '/shares',
      { nodeType: 'list', nodeId: listId, granteeUserId: otra.userId, role: 'editor' },
      yo.accessToken,
    );
    expect(creada.status).toBe(201);

    const mio = await directorio(yo.accessToken);
    expect(correos(mio)).toEqual([otra.email]);
    // `shared_with` se lee desde el que pregunta: "yo le he compartido a esta
    // persona". La direccion es lo unico no obvio de este enum y por eso se
    // comprueba aqui y no solo que la lista tenga un elemento.
    expect(mio.body?.data?.items?.[0]?.relations).toEqual(['shared_with']);
  });

  it('sale quien te compartio algo, y con la razon contraria', async () => {
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const otra = await createVerifiedUser(api, { displayName: 'Otra' });
    const workspaceId = randomUUID();
    const listId = randomUUID();

    await push(otra, [
      { kind: 'create', entity: 'workspace', entityId: workspaceId, payload: { name: 'Casa', color: 'teal' } },
      { kind: 'create', entity: 'list', entityId: listId, payload: { workspaceId, folderId: null, title: 'Compra', kind: 'tasks', position: 0 } },
    ]);
    await api.post(
      '/shares',
      { nodeType: 'list', nodeId: listId, granteeUserId: yo.userId, role: 'editor' },
      otra.accessToken,
    );

    const mio = await directorio(yo.accessToken);
    expect(correos(mio)).toEqual([otra.email]);
    expect(mio.body?.data?.items?.[0]?.relations).toEqual(['shared_by']);
  });

  it('quien esta en un espacio tuyo sale por el espacio', async () => {
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const mia = await createVerifiedUser(api, { displayName: 'Mia' });
    const workspaceId = randomUUID();

    await push(mia, [
      { kind: 'create', entity: 'workspace', entityId: workspaceId, payload: { name: 'Trabajo', color: 'teal' } },
    ]);
    // La mia acepta la invitacion por la via normal, que es lo que pone la fila de
    // `memberships` que el directorio lee. La invitacion se crea colgando del
    // espacio (`/workspaces/:id/invitations`), no en `/invitations`, que solo tiene
    // el preview y el accept.
    const invitacion = await api.post(
      `/workspaces/${workspaceId}/invitations`,
      { role: 'editor', email: yo.email },
      mia.accessToken,
    );
    expect(invitacion.status).toBe(201);

    const aceptar = await api.post(
      `/invitations/${invitacion.body?.data?.token}/accept`,
      {},
      yo.accessToken,
    );
    expect(aceptar.status).toBe(200);

    const mio = await directorio(yo.accessToken);
    expect(correos(mio)).toEqual([mia.email]);
    expect(mio.body?.data?.items?.[0]?.relations).toEqual(['space']);
  });

  it('una persona con dos razones sale una vez, con las dos razones', async () => {
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const otra = await createVerifiedUser(api, { displayName: 'Otra' });
    const workspaceId = randomUUID();
    const listId = randomUUID();

    await push(yo, [
      { kind: 'create', entity: 'workspace', entityId: workspaceId, payload: { name: 'Casa', color: 'teal' } },
      { kind: 'create', entity: 'list', entityId: listId, payload: { workspaceId, folderId: null, title: 'Compra', kind: 'tasks', position: 0 } },
    ]);

    // Dos razones: le comparto una lista, y estamos en el mismo espacio. Una fila,
    // no dos. El picker ofrece una persona, no una relacion, y tres filas para
    // Marta en una lista de seis nombres es una lista que el que la pinta tiene
    // que deduplicar.
    await api.post(
      '/shares',
      { nodeType: 'list', nodeId: listId, granteeUserId: otra.userId, role: 'editor' },
      yo.accessToken,
    );
    const invitacion = await api.post(
      `/workspaces/${workspaceId}/invitations`,
      { role: 'editor', email: otra.email },
      yo.accessToken,
    );
    expect(invitacion.status).toBe(201);
    const aceptada = await api.post(`/invitations/${invitacion.body?.data?.token}/accept`, {}, otra.accessToken);
    expect(aceptada.status).toBe(200);

    const mio = await directorio(yo.accessToken);
    expect(correos(mio)).toEqual([otra.email]);
    const relaciones = mio.body?.data?.items?.[0]?.relations;
    expect(relaciones).toHaveLength(2);
    expect(relaciones).toContain('shared_with');
    expect(relaciones).toContain('space');
  });

  it('tienes que salir con los tres campos del usuario, no solo con el id', async () => {
    // El picker necesita el nombre para pintar la fila y el correo para poder
    // compartir por la via vieja sin escribirlo. Un directorio que solo devuelve
    // ids obliga al cliente a pedir un perfil por persona, y no hay perfil por
    // persona.
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const otra = await createVerifiedUser(api, { displayName: 'Otra' });
    const workspaceId = randomUUID();
    const listId = randomUUID();

    await push(yo, [
      { kind: 'create', entity: 'workspace', entityId: workspaceId, payload: { name: 'Casa', color: 'teal' } },
      { kind: 'create', entity: 'list', entityId: listId, payload: { workspaceId, folderId: null, title: 'Compra', kind: 'tasks', position: 0 } },
    ]);
    await api.post(
      '/shares',
      { nodeType: 'list', nodeId: listId, granteeUserId: otra.userId, role: 'editor' },
      yo.accessToken,
    );

    const mio = await directorio(yo.accessToken);
    const persona = mio.body?.data?.items?.[0];
    expect(persona?.user?.displayName).toBe('Otra');
    expect(persona?.user?.email).toBe(otra.email);
    expect(persona?.user?.avatarUrl).toBeNull();
    expect(persona?.lastInteractionAt).toBeTruthy();
  });

  it('revocar un share saca a la persona de tu carpeta', async () => {
    // Si no saliera, una persona que tomo la concesion la vuelta a ti se queda en
    // tu directorio para siempre, y no hay forma de quitarla de ahi.
    const yo = await createVerifiedUser(api, { displayName: 'Yo' });
    const otra = await createVerifiedUser(api, { displayName: 'Otra' });
    const workspaceId = randomUUID();
    const listId = randomUUID();

    await push(yo, [
      { kind: 'create', entity: 'workspace', entityId: workspaceId, payload: { name: 'Casa', color: 'teal' } },
      { kind: 'create', entity: 'list', entityId: listId, payload: { workspaceId, folderId: null, title: 'Compra', kind: 'tasks', position: 0 } },
    ]);
    const creada = await api.post(
      '/shares',
      { nodeType: 'list', nodeId: listId, granteeUserId: otra.userId, role: 'editor' },
      yo.accessToken,
    );

    expect(correos(await directorio(yo.accessToken))).toEqual([otra.email]);

    await api.delete(`/shares/${creada.body?.data?.id}`, yo.accessToken);

    expect(correos(await directorio(yo.accessToken))).toEqual([]);
  });

  it('la carpeta de una persona no se ve desde la de otra', async () => {
    const a = await createVerifiedUser(api, { displayName: 'A' });
    const b = await createVerifiedUser(api, { displayName: 'B' });
    const c = await createVerifiedUser(api, { displayName: 'C' });

    // C comparte con A. B no tiene nada que ver con ninguno de los dos y su
    // carpeta tiene que estar vacia, no parcialmente llena.
    const creada = await api.post(
      '/shares',
      { nodeType: 'workspace', nodeId: randomUUID(), granteeUserId: a.userId, role: 'editor' },
      c.accessToken,
    );
    expect(creada.status).toBe(404);

    const deB = await directorio(b.accessToken);
    expect(correos(deB)).toEqual([]);
    expect(correos(deB)).not.toContain(c.email);
    expect(correos(deB)).not.toContain(a.email);
  });
});
