import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { shareService } from '../src/modules/shares/share-service.js';
import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

let api: TestServer;

beforeAll(async () => {
  api = await startTestServer();
});

afterAll(async () => {
  await api.close();
});

async function push(user: TestUser, operations: Record<string, unknown>[]) {
  return api.post(
    '/sync/push',
    {
      deviceId: randomUUID(),
      lastPulledAt: null,
      operations: operations.map((operation) => ({
        operationId: randomUUID(),
        clientId: 'test-client-access',
        baseVersion: 0,
        payload: {},
        clientTimestamp: new Date().toISOString(),
        ...operation,
      })),
    },
    user.accessToken,
  );
}

const pulls = new Map<string, string | null>();
const dispositivos = new Map<string, string>();

/** A device that remembers its place, because a pull that starts from 1970 sees everything. */
async function pull(user: TestUser) {
  let deviceId = dispositivos.get(user.userId);
  if (!deviceId) {
    deviceId = randomUUID();
    dispositivos.set(user.userId, deviceId);
  }
  const cursor = pulls.get(user.userId) ?? null;
  const r = await api.post('/sync/pull', { deviceId, cursor, limit: 200 }, user.accessToken);
  const siguiente = r.body?.data?.nextCursor;
  if (typeof siguiente === 'string') pulls.set(user.userId, siguiente);
  return r;
}

const registro = (r: { body?: { data?: { changes?: { entity: string; record: Record<string, unknown> }[] } } }) =>
  (r.body?.data?.changes ?? []).filter((c) => c.entity !== 'workspace');

const nodo = (
  r: { body?: { data?: { changes?: { entity: string; record: Record<string, unknown> }[] } } },
  entity: string,
  id: string,
) => registro(r).find((c) => c.entity === entity && c.record.id === id)?.record;

async function conEspacio(nombre: string) {
  const user = await createVerifiedUser(api, { displayName: nombre });
  const workspaceId = randomUUID();
  const folderId = randomUUID();
  const listId = randomUUID();
  const noteId = randomUUID();
  const itemId = randomUUID();
  await push(user, [
    { kind: 'create', entity: 'workspace', entityId: workspaceId, payload: { name: 'Casa', color: 'teal' } },
    { kind: 'create', entity: 'folder', entityId: folderId, payload: { workspaceId, name: 'Viajes', position: 0 } },
    { kind: 'create', entity: 'list', entityId: listId, payload: { workspaceId, folderId, title: 'Compra', kind: 'tasks', position: 0 } },
    { kind: 'create', entity: 'list_item', entityId: itemId, payload: { listId, title: 'Leche', position: 0 } },
    { kind: 'create', entity: 'note', entityId: noteId, payload: { workspaceId, folderId: null, title: 'Receta', document: '<p>Sal</p>', tags: [] } },
  ]);
  return { user, workspaceId, folderId, listId, noteId, itemId };
}

/** Shares a node and hands the grantee a place to put it, so it is in their pull. */
async function compartir(
  dueno: TestUser,
  target: { nodeType: 'folder' | 'list' | 'note'; nodeId: string },
  otra: TestUser,
  role: 'editor' | 'viewer',
) {
  await shareService.createShare({
    // `.userId` and not the object. `TestUser` carries the whole session, and
    // passing it where a uuid is expected does not fail loudly: it reaches Postgres
    // as `"[object Object]"` and the error names the query instead of the argument.
    ownerUserId: dueno.userId,
    target: await shareService.resolveTarget(target.nodeType, target.nodeId),
    grantee: { userId: otra.userId, email: otra.email, displayName: null },
    role,
  });
  const suyo = randomUUID();
  await push(otra, [
    { kind: 'create', entity: 'workspace', entityId: suyo, payload: { name: 'Suyo', color: 'rose' } },
  ]);
}

describe('lo que la cabecera va a poder decir', () => {
  /**
   * `role` and `shared` are two questions and this file is where they are kept
   * apart. The bug they invite is real and it is quiet: a badge built from `shared`
   * alone puts a "shared" mark on a list three colleagues have open, because it is
   * not theirs — and a badge built from `role` alone says "you can edit this" about
   * a list handed over as read-only.
   */

  it('lo tuyo lleva tu papel de miembro y no la marca de compartido', async () => {
    const yo = await conEspacio('Mio');
    const r = await pull(yo.user);

    expect(nodo(r, 'list', yo.listId)?.role).toBe('owner');
    expect(nodo(r, 'list', yo.listId)?.shared).toBe(false);
    expect(nodo(r, 'folder', yo.folderId)?.role).toBe('owner');
    expect(nodo(r, 'note', yo.noteId)?.role).toBe('owner');
    expect(nodo(r, 'list_item', yo.itemId)?.role).toBe('owner');
  });

  it('lo que te comparten lleva la marca y el papel de la concesion', async () => {
    const yo = await conEspacio('Dueno');
    const otra = await createVerifiedUser(api, { displayName: 'Receptora' });
    await compartir(yo.user, { nodeType: 'list', nodeId: yo.listId }, otra, 'editor');

    const r = await pull(otra);
    const lista = nodo(r, 'list', yo.listId);

    expect(lista?.shared).toBe(true);
    expect(lista?.role).toBe('editor');
  });

  it('una concesion en solo lectura se dice solo lectura', async () => {
    const yo = await conEspacio('Dueno dos');
    const otra = await createVerifiedUser(api, { displayName: 'Receptora dos' });
    await compartir(yo.user, { nodeType: 'list', nodeId: yo.listId }, otra, 'viewer');

    const r = await pull(otra);
    expect(nodo(r, 'list', yo.listId)?.role).toBe('viewer');
    expect(nodo(r, 'list', yo.listId)?.shared).toBe(true);
  });

  it('lo que tres companeros tienen tambien sigue siendo tuyo', async () => {
    // La trampa. Esta lista la has compartido con tres personas y aun asi es tuya:
    // vive en tu espacio y tu eres miembro. Un badge construido sobre `shared` la
    // marcaria como prestada, que es exactamente la confusion que los dos campos
    // estan separados para evitar.
    const yo = await conEspacio('Con companeros');
    for (const nombre of ['Uno', 'Dos', 'Tres']) {
      const otro = await createVerifiedUser(api, { displayName: nombre });
      await compartir(yo.user, { nodeType: 'list', nodeId: yo.listId }, otro, 'viewer');
    }

    const r = await pull(yo.user);
    const lista = nodo(r, 'list', yo.listId);

    expect(lista?.shared).toBe(false);
    expect(lista?.role).toBe('owner');

    // Y quien si lo tiene, lo tiene. El endpoint de alcance no ha cambiado y sigue
    // siendo la unica fuente de "cuanta gente mas".
    const alcance = await shareService.whoHas(await shareService.resolveTarget('list', yo.listId));
    expect(alcance.count).toBe(3);
  });

  it('compartir una carpeta marca la carpeta, no lo que hay dentro', async () => {
    const yo = await conEspacio('Carpeta');
    const otra = await createVerifiedUser(api, { displayName: 'Receptora tres' });
    await compartir(yo.user, { nodeType: 'folder', nodeId: yo.folderId }, otra, 'viewer');

    const r = await pull(otra);
    const carpeta = nodo(r, 'folder', yo.folderId);

    expect(carpeta?.shared).toBe(true);
    expect(carpeta?.role).toBe('viewer');
  });

  it('compartir una carpeta trae lo que hay dentro, por fechas', async () => {
    // No por|subarbol. La lista de dentro llega en su sitio y por su fecha, como
    // cualquier otra fila de la linea de tiempo, y lo mismo sus elementos. El filtro
    // de cada entidad admite lo que una concesion alcanza, no solo lo que nombra: una
    // concesion sobre una carpeta nombra la carpeta, y sus hijas no las nombra nadie.
    //
    // Esto estaba roto y de una manera que no se veia: compartir una carpeta entregaba
    // la carpeta, su padre, el espacio y nada mas dentro, y como no habia nada mas,
    // no habia nada que cambiara y llegara despues. Un movil que compartia una carpeta
    // se quedaba con una carpeta vacia para siempre.
    const yo = await conEspacio('Carpeta llena');
    const otra = await createVerifiedUser(api, { displayName: 'Receptora de carpeta' });
    await compartir(yo.user, { nodeType: 'folder', nodeId: yo.folderId }, otra, 'editor');

    const r = await pull(otra);
    const carpeta = nodo(r, 'folder', yo.folderId);
    const lista = nodo(r, 'list', yo.listId);
    const fila = nodo(r, 'list_item', yo.itemId);

    expect(carpeta?.shared).toBe(true);
    // Y llegan marcadas, que es lo que hace que la cabecera no diga dos cosas falsas
    // sobre una lista que el dueno si le ha dado.
    expect(lista?.shared).toBe(true);
    expect(lista?.role).toBe('editor');
    expect(fila?.shared).toBe(true);
    expect(fila?.role).toBe('editor');
  });

  it('compartir una carpeta NO trae las notas que tiene al lado', async () => {
    // La excepcion, y es deliberada: una nota es un documento que alguien escribio, y
    // que te pasen una lista de la compra no es permiso para leer lo que hay al lado.
    // Compartir una nota es un acto explicito, sobre un nodo propio.
    const yo = await conEspacio('Carpeta con nota');
    const otra = await createVerifiedUser(api, { displayName: 'Receptora de nota' });
    const notaAlLado = randomUUID();
    await push(yo.user, [
      { kind: 'create', entity: 'note', entityId: notaAlLado, payload: { workspaceId: yo.workspaceId, folderId: yo.folderId, title: 'Al lado', document: '<p>Secreto</p>', tags: [] } },
    ]);
    await compartir(yo.user, { nodeType: 'folder', nodeId: yo.folderId }, otra, 'editor');

    const r = await pull(otra);
    expect(nodo(r, 'note', notaAlLado)).toBeUndefined();
  });

  it('una nota se comparte sola y no arrastra a lo que tiene al lado', async () => {
    const yo = await conEspacio('Notas');
    const otra = await createVerifiedUser(api, { displayName: 'Receptora cuatro' });
    const otraNota = randomUUID();
    await push(yo.user, [
      { kind: 'create', entity: 'note', entityId: otraNota, payload: { workspaceId: yo.workspaceId, folderId: yo.folderId, title: 'No compartida', document: '<p>Secreto</p>', tags: [] } },
    ]);
    await compartir(yo.user, { nodeType: 'note', nodeId: yo.noteId }, otra, 'editor');

    const r = await pull(otra);
    expect(nodo(r, 'note', yo.noteId)?.shared).toBe(true);    // La nota de al lado no llega siquiera al movil.
    expect(nodo(r, 'note', otraNota)).toBeUndefined();
  });

  it('el techo manda: viewer en el espacio con concesion de editor sigue siendo viewer', async () => {
    // Si somebody te acepta en su espacio como viewer y te pasa una carpeta con
    // permiso de edicion, eres viewer ahi. Es la regla de ADR 0031 y la razon de
    // que esto llame a `accessOf` en vez de decidirlo aqui: decidirlo aqui seria
    // una segunda respuesta a la misma pregunta, y la cabecera acabaria diciendo
    // "puedes editarla" sobre una lista que no puedes tocar.
    const dueño = await conEspacio('Propietario');
    const editor = await createVerifiedUser(api, { displayName: 'Editor' });

    // El propietario acepta al editor en el espacio, pero como viewer.
    const invitacion = await api.post(
      `/workspaces/${dueño.workspaceId}/invitations`,
      { role: 'viewer', email: editor.email },
      dueño.user.accessToken,
    );
    const aceptada = await api.post(
      `/invitations/${invitacion.body?.data?.token}/accept`,
      {},
      editor.accessToken,
    );
    expect(aceptada.status).toBe(200);

    // Y ahora le comparte una carpeta con permiso de edicion.
    await compartir(dueño.user, { nodeType: 'folder', nodeId: dueño.folderId }, editor, 'editor');

    const r = await pull(editor);
    const carpeta = nodo(r, 'folder', dueño.folderId);
    const lista = nodo(r, 'list', dueño.listId);

    // Membresia de viewer + concesion de editor = viewer. Y no es "shared", porque
    // eres miembro del espacio: lo tienes de las dos maneras a la vez.
    expect(carpeta?.role).toBe('viewer');
    expect(lista?.role).toBe('viewer');
    expect(carpeta?.shared).toBe(false);
    expect(lista?.shared).toBe(false);
  });

  it('a quien no leitellegamos no le llegan campos de permiso inventados', async () => {
    const yo = await conEspacio('Ajena');
    const ajena = await createVerifiedUser(api, { displayName: 'Ajena' });
    const r = await pull(ajena);
    expect(nodo(r, 'list', yo.listId)).toBeUndefined();
  });
});
