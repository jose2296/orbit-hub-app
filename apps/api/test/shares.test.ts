import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sharedWithYouEmail } from '../src/modules/email/email.js';
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
  const r = await api.post(
    '/sync/push',
    {
      deviceId: randomUUID(),
      lastPulledAt: null,
      operations: operations.map((operation) => ({
        operationId: randomUUID(),
        clientId: 'test-client-shares',
        baseVersion: 0,
        payload: {},
        // El contrato lo exige y sin el la operacion se rechaza entera: por eso
        // el push de prueba salia con cuatro "rejected" y no decia por que.
        clientTimestamp: new Date().toISOString(),
        ...operation,
      })),
    },
    user.accessToken,
  );
  return r;
}

/** A user with a space, a folder and a list, ready to share any of them. */
async function conEspacio(nombre: string) {
  const user = await createVerifiedUser(api, { displayName: nombre });
  const workspaceId = randomUUID();
  const folderId = randomUUID();
  const listId = randomUUID();
  const itemId = randomUUID();
  await push(user, [
    { kind: 'create', entity: 'workspace', entityId: workspaceId, payload: { name: 'Casa', color: 'teal' } },
    { kind: 'create', entity: 'folder', entityId: folderId, payload: { workspaceId, name: 'Viajes', position: 0 } },
    {
      kind: 'create',
      entity: 'list',
      entityId: listId,
      payload: { workspaceId, folderId, title: 'Compra', kind: 'tasks', position: 0 },
    },
    { kind: 'create', entity: 'list_item', entityId: itemId, payload: { listId, title: 'Leche', position: 0 } },
  ]);
  return { user, workspaceId, folderId, listId, itemId };
}

describe('compartir', () => {
  /**
   * The door in front of the service.
   *
   * Every other test in this file calls `shareService` directly, which proves the
   * service and says nothing about the route. The route was missing its
   * `requireAuth`, so `req.auth` was always undefined and every endpoint on it
   * answered 401 to everybody — including an empty inbox, which is the one request
   * the app makes on every drawer open.
   */
  it('la bandeja se pide por HTTP y no solo por el servicio', async () => {
    const otra = await createVerifiedUser(api, { displayName: 'Bandeja HTTP' });

    const vacia = await api.get('/shares/inbox', otra.accessToken);
    expect(vacia.status).toBe(200);
    expect(vacia.body?.data?.items).toEqual([]);
  });

  it('la bandeja pide sesion y la rechaza sin ella', async () => {
    const sinToken = await api.get('/shares/inbox');
    expect(sinToken.status).toBe(401);
  });

  it('lo que le comparten a alguien sale por su bandeja HTTP', async () => {
    const yo = await conEspacio('Dueño HTTP');
    const otra = await createVerifiedUser(api, { displayName: 'Receptora HTTP' });

    await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: otra.userId, email: otra.email, displayName: 'Receptora HTTP' },
      role: 'editor',
    });

    const bandeja = await api.get('/shares/inbox', otra.accessToken);
    expect(bandeja.status).toBe(200);
    expect(bandeja.body?.data?.items).toHaveLength(1);
    expect(bandeja.body?.data?.items?.[0]?.title).toBe('Compra');
  });

  it('le pasa una lista a alguien y la recibe en la bandeja', async () => {
    const yo = await conEspacio('Yo');
    const otra = await createVerifiedUser(api, { displayName: 'Otra' });

    const creada = await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: otra.userId, email: otra.email, displayName: 'Otra' },
      role: 'editor',
    });
    expect(creada.shareId).toBeTruthy();

    const bandeja = await shareService.inbox(otra.userId);
    expect(bandeja).toHaveLength(1);
    expect(bandeja[0]?.title).toBe('Compra');
    expect(bandeja[0]?.role).toBe('editor');
    // Y puede editarla sin ser miembro de aquel espacio.
    const acceso = await shareService.accessFor(await shareService.resolveTarget('list', yo.listId), otra.userId);
    expect(acceso).toBe('edit');
  });

  it('la lista no desaparece de la bandeja hasta que se coloca, y al colocarla sale', async () => {
    const yo = await conEspacio('Yo dos');
    const otra = await createVerifiedUser(api, { displayName: 'Otra dos' });
    const { shareId } = await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'viewer',
    });

    // En un espacio suyo, y ahi se decide que ya no esta sin colocar.
    const suyo = randomUUID();
    await push(otra, [
      { kind: 'create', entity: 'workspace', entityId: suyo, payload: { name: 'Suyo', color: 'rose' } },
    ]);

    await shareService.placeShare({
      userId: otra.userId,
      shareId,
      workspaceId: suyo,
      folderId: null,
    });

    expect(await shareService.inbox(otra.userId)).toHaveLength(0);
  });

  it('no se puede compartir con uno mismo', async () => {
    const yo = await conEspacio('Yo tres');
    await expect(
      shareService.createShare({
        ownerUserId: yo.user.userId,
        target: await shareService.resolveTarget('list', yo.listId),
        grantee: { userId: yo.user.userId, email: yo.user.email, displayName: null },
        role: 'editor',
      }),
    ).rejects.toThrow(/yourself/);
  });

  it('alguien de fuera no puede compartir lo que no es suyo', async () => {
    const yo = await conEspacio('Yo cuatro');
    const otra = await createVerifiedUser(api, { displayName: 'Ajena' });

    await expect(
      shareService.createShare({
        ownerUserId: otra.userId,
        target: await shareService.resolveTarget('list', yo.listId),
        grantee: { userId: yo.user.userId, email: yo.user.email, displayName: null },
        role: 'editor',
      }),
    ).rejects.toThrow(/do not belong/);
  });

  it('quien lo recibe puede editarlo pero no compartirlo', async () => {
    const yo = await conEspacio('Yo cinco');
    const otra = await createVerifiedUser(api, { displayName: 'Otra cinco' });
    const tercero = await createVerifiedUser(api, { displayName: 'Tercero' });

    await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'editor',
    });

    const acceso = await shareService.accessFor(
      await shareService.resolveTarget('list', yo.listId),
      otra.userId,
    );
    expect(acceso).toBe('edit');

    // Y no puede pasarle la lista a un tercero: editar cincuenta elementos no es
    // decidir que un sexto los vea.
    await expect(
      shareService.createShare({
        ownerUserId: otra.userId,
        target: await shareService.resolveTarget('list', yo.listId),
        grantee: { userId: tercero.userId, email: tercero.email, displayName: null },
        role: 'editor',
      }),
    ).rejects.toThrow(/do not belong/);
  });

  it('compartir una carpeta da tambien las listas de dentro', async () => {
    const yo = await conEspacio('Yo seis');
    const otra = await createVerifiedUser(api, { displayName: 'Otra seis' });

    await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('folder', yo.folderId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'editor',
    });

    const deLaLista = await shareService.accessFor(
      await shareService.resolveTarget('list', yo.listId),
      otra.userId,
    );
    expect(deLaLista).toBe('edit');
  });

  it('tomar la concesion la saca de la bandeja y le avisa de a cuantos afecta', async () => {
    const yo = await conEspacio('Yo siete');
    const otra = await createVerifiedUser(api, { displayName: 'Otra siete' });
    const tercera = await createVerifiedUser(api, { displayName: 'Tercera' });

    const a = await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'editor',
    });
    await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: tercera.userId, email: tercera.email, displayName: null },
      role: 'viewer',
    });

    // Lo que pregunta un borrado antes de borrar nada.
    const afectados = await shareService.whoHas(await shareService.resolveTarget('list', yo.listId));
    expect(afectados.count).toBe(2);
    expect(afectados.people.map((p) => p.email).sort()).toEqual([otra.email, tercera.email].sort());

    await shareService.revokeShare({ userId: yo.user.userId, shareId: a.shareId });

    expect(await shareService.inbox(otra.userId)).toHaveLength(0);
    expect(await shareService.inbox(tercera.userId)).toHaveLength(1);
    // Y el acceso por la concesion se cae, que es lo que hace revocar.
    const despues = await shareService.accessFor(
      await shareService.resolveTarget('list', yo.listId),
      otra.userId,
    );
    expect(despues).toBe('none');
  });

  it('compartir dos veces con la misma persona es un error, no una fila mas', async () => {
    const yo = await conEspacio('Yo ocho');
    const otra = await createVerifiedUser(api, { displayName: 'Otra ocho' });
    const args = {
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'editor',
    } as const;

    await shareService.createShare(args);
    await expect(shareService.createShare(args)).rejects.toThrow(/already shared/);
  });
});

describe('una nota compartida', () => {
  /**
   * A note is the thing people actually send to each other.
   *
   * `resolveTarget` had no `note` branch, so a note fell through to the list-item
   * query, matched nothing, and answered 404. Three separate failures came out of that
   * one missing branch, and they are the three below:
   *
   * 1. `POST /shares` with `nodeType: 'note'` was a 404.
   * 2. The recipient could not edit it: `assertCanWrite` in sync-service calls the
   *    same `resolveTarget` and turns the throw into "workspace not found".
   * 3. The recipient was never told anything had arrived, because `tocaElNodo`
   *    stamped a list row that does not exist and the pull cursor never moved.
   *
   * All of them go through HTTP. The comment at the top of this file explains what
   * a service-only test cost the last time.
   */
  async function conNota(nombre: string) {
    const user = await createVerifiedUser(api, { displayName: nombre });
    const workspaceId = randomUUID();
    const noteId = randomUUID();
    await push(user, [
      { kind: 'create', entity: 'workspace', entityId: workspaceId, payload: { name: 'Casa', color: 'teal' } },
      {
        kind: 'create',
        entity: 'note',
        entityId: noteId,
        payload: { workspaceId, folderId: null, title: 'Lista de la compra', document: '<p>Pan</p>', tags: [] },
      },
    ]);
    return { user, workspaceId, noteId };
  }

  it('se puede compartir por HTTP, y llega a la bandeja de la otra persona', async () => {
    const yo = await conNota('Nota yo');
    const otra = await createVerifiedUser(api, { displayName: 'Nota otra' });

    const r = await api.post(
      '/shares',
      {
        nodeType: 'note',
        nodeId: yo.noteId,
        // Por id y no por correo: es la via que el selector de personas usara, y la
        // que no existia desde ningun lado hasta ahora.
        granteeUserId: otra.userId,
        role: 'editor',
      },
      yo.user.accessToken,
    );

    // Un 404 aqui era la respuesta de antes, y decia "That does not exist" de una
    // nota que existia y era del que la compartia.
    expect(r.status).toBe(201);
    expect(r.body?.data?.id).toBeTruthy();

    const bandeja = await api.get('/shares/inbox', otra.accessToken);
    expect(bandeja.body?.data?.items).toHaveLength(1);
    expect(bandeja.body?.data?.items?.[0]?.title).toBe('Lista de la compra');
    expect(bandeja.body?.data?.items?.[0]?.nodeType).toBe('note');
  });

  it('quien la recibe la ve en su pull, y no hace falta que tenga espacios', async () => {
    const yo = await conNota('Pull nota yo');
    const otra = await createVerifiedUser(api, { displayName: 'Pull nota otra' });

    await api.post(
      '/shares',
      { nodeType: 'note', nodeId: yo.noteId, granteeUserId: otra.userId, role: 'editor' },
      yo.user.accessToken,
    );

    const r = await api.post(
      '/sync/pull',
      { deviceId: randomUUID(), cursor: null, limit: 200 },
      otra.accessToken,
    );

    const notas = (r.body?.data?.changes ?? []).filter((c: { entity: string }) => c.entity === 'note');
    expect(notas).toHaveLength(1);
    expect(notas[0]?.record?.title).toBe('Lista de la compra');
  });

  it('quien la recibe como editor puede editarla por sync, sin ser miembro', async () => {
    const yo = await conNota('Sync nota yo');
    const otra = await createVerifiedUser(api, { displayName: 'Sync nota otra' });

    await api.post(
      '/shares',
      { nodeType: 'note', nodeId: yo.noteId, granteeUserId: otra.userId, role: 'editor' },
      yo.user.accessToken,
    );

    const r = await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          {
            operationId: randomUUID(),
            clientId: 'test-client-shares',
            kind: 'update',
            entity: 'note',
            entityId: yo.noteId,
            baseVersion: 0,
            base: { title: 'Lista de la compra' },
            payload: { title: 'Compra del Saturday' },
            clientTimestamp: new Date().toISOString(),
          },
        ],
      },
      otra.accessToken,
    );

    // Antes esto caia en el 404 de "workspace not found" del `assertCanWrite`, que
    // es un 404 porque no distingue "no existe" de "no es tuyo", y aqui la nota si
    // existia y si era suya: la concesion se la habia dado el dueno hace un momento.
    expect(r.body?.data?.results?.[0]?.status).toBe('applied');
  });

  it('quien la recibe en solo lectura no puede editarla y se le dice por que', async () => {
    const yo = await conNota('Sync nota viewer yo');
    const otra = await createVerifiedUser(api, { displayName: 'Sync nota viewer otra' });

    await api.post(
      '/shares',
      { nodeType: 'note', nodeId: yo.noteId, granteeUserId: otra.userId, role: 'viewer' },
      yo.user.accessToken,
    );

    const r = await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          {
            operationId: randomUUID(),
            clientId: 'test-client-shares',
            kind: 'update',
            entity: 'note',
            entityId: yo.noteId,
            baseVersion: 0,
            base: { title: 'Lista de la compra' },
            payload: { title: 'No deberia poder' },
            clientTimestamp: new Date().toISOString(),
          },
        ],
      },
      otra.accessToken,
    );

    expect(r.body?.data?.results?.[0]?.status).toBe('rejected');
    expect(r.body?.data?.results?.[0]?.error).toMatch(/edit access/);
  });

  it('a quien no se la han compartido le sale como si la nota no existiera', async () => {
    const yo = await conNota('Sync nota ajena yo');
    const ajena = await createVerifiedUser(api, { displayName: 'Sync nota ajena' });

    const r = await api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          {
            operationId: randomUUID(),
            clientId: 'test-client-shares',
            kind: 'update',
            entity: 'note',
            entityId: yo.noteId,
            baseVersion: 0,
            base: { title: 'Lista de la compra' },
            payload: { title: 'Ni se inmuta' },
            clientTimestamp: new Date().toISOString(),
          },
        ],
      },
      ajena.accessToken,
    );

    // El 404 y no el 403 a proposito, y por lo que dice el comentario de
    // `resolveGrantee`: el mismo 404 para "no existe" y "existe pero no es tuyo" es
    // lo que no deja averiguar que notas ajenas hay. Un 403 confirmaria que el id
    // existe, que es justo lo que no hay que confirmar.
    expect(r.body?.data?.results?.[0]?.status).toBe('rejected');
    expect(r.body?.data?.results?.[0]?.error).toMatch(/not found/i);
  });

  it('el alcance de una nota se puede preguntar antes de borrarla', async () => {
    const yo = await conNota('Alcance yo');
    const otra = await createVerifiedUser(api, { displayName: 'Alcance otra' });

    await api.post(
      '/shares',
      { nodeType: 'note', nodeId: yo.noteId, granteeUserId: otra.userId, role: 'viewer' },
      yo.user.accessToken,
    );

    const r = await api.get(`/shares/note/${yo.noteId}/reach`, yo.user.accessToken);
    expect(r.status).toBe(200);
    expect(r.body?.data?.count).toBe(1);
    expect(r.body?.data?.people?.[0]?.email).toBe(otra.email);
  });

  it('revocar una nota compartida la entierra en el pull del otro', async () => {
    const yo = await conNota('Revocar nota yo');
    const otra = await createVerifiedUser(api, { displayName: 'Revocar nota otra' });

    const creada = await api.post(
      '/shares',
      { nodeType: 'note', nodeId: yo.noteId, granteeUserId: otra.userId, role: 'editor' },
      yo.user.accessToken,
    );

    let cursor: string | null = null;
    const pull = async () => {
      const r = await api.post(
        '/sync/pull',
        { deviceId: randomUUID(), cursor, limit: 200 },
        otra.accessToken,
      );
      if (typeof r.body?.data?.nextCursor === 'string') cursor = r.body.data.nextCursor;
      return r;
    };

    expect(
      (await pull()).body?.data?.changes?.some((c: { entity: string }) => c.entity === 'note'),
    ).toBe(true);

    await api.delete(`/shares/${creada.body?.data?.id}`, yo.user.accessToken);

    const despues = (await pull()).body?.data?.changes ?? [];
    const laNota = despues.find(
      (c: { entity: string; record: { title?: string } }) =>
        c.entity === 'note' && c.record.title === 'Lista de la compra',
    );
    // El entierro es lo unico que puede hacer que un movil que ya la tiene en cache
    // la borre de verdad. Sin el, "ya esta revocado" no se ve por ningun lado.
    expect(laNota?.record?.deletedAt).toBeTruthy();
    expect(laNota?.record?.withdrawn).toBe(true);
  });
});

describe('una lista compartida en el sync', () => {
  /** Tacha un elemento de la lista, por la via normal de la app. */
  async function tachar(user: TestUser, itemId: string) {
    return api.post(
      '/sync/push',
      {
        deviceId: randomUUID(),
        lastPulledAt: null,
        operations: [
          {
            operationId: randomUUID(),
            clientId: 'test-client-shares',
            kind: 'update',
            entity: 'list_item',
            entityId: itemId,
            baseVersion: 0,
            base: { completed: false },
            payload: { completed: true },
            clientTimestamp: new Date().toISOString(),
          },
        ],
      },
      user.accessToken,
    );
  }

  const estado = (r: { body?: { data?: { results?: { status: string; error?: string }[] } } }) =>
    r.body?.data?.results?.[0];

  it('quien la recibe como editor puede tachar, sin ser miembro del espacio', async () => {
    const yo = await conEspacio('Sync yo');
    const otra = await createVerifiedUser(api, { displayName: 'Sync otra' });
    await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'editor',
    });

    const r = await tachar(otra, yo.itemId);
    expect(estado(r)?.status).toBe('applied');
  });

  it('quien la recibe como solo ver puede tacharla y le dicen que no', async () => {
    const yo = await conEspacio('Sync yo dos');
    const otra = await createVerifiedUser(api, { displayName: 'Sync otra dos' });
    await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'viewer',
    });

    const r = await tachar(otra, yo.itemId);
    // Rechazada, y con el motivo: "no found" seria leer de mas, "forbidden" es la
    // respuesta honesta para alguien que puede verla y no tocarla.
    expect(estado(r)?.status).toBe('rejected');
    expect(estado(r)?.error).toMatch(/edit access/);
  });

  it('a quien no se la ha compartido le sale como si no existiera', async () => {
    const yo = await conEspacio('Sync yo tres');
    const ajena = await createVerifiedUser(api, { displayName: 'Sync ajena' });

    const r = await tachar(ajena, yo.itemId);
    expect(estado(r)?.status).toBe('rejected');
    expect(estado(r)?.error).toMatch(/not found/i);
  });

  it('tachar la lista de dentro de una carpeta compartida tambien vale', async () => {
    const yo = await conEspacio('Sync yo cuatro');
    const otra = await createVerifiedUser(api, { displayName: 'Sync otra cuatro' });
    await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('folder', yo.folderId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'editor',
    });

    const r = await tachar(otra, yo.itemId);
    expect(estado(r)?.status).toBe('applied');
  });
});

describe('el pull trae lo compartido', () => {
  /**
   * The same phone, pulling twice.
   *
   * Two things have to be right here and both were wrong at first, which is worth
   * writing down because the symptom in each case was the same and the cause was
   * not:
   *
   * - The field is `cursor`, not `lastPulledAt`. The request schema has a default
   *   of `null` for it, so a wrong key does not fail — it silently pulls the whole
   *   history from 1970 on every call, and "the tombstone comes back forever"
   *   becomes the correct answer instead of a bug.
   * - The cursor has to be fed back. The server *stores* it per device but never
   *   reads it back: the cursor is the client's to keep, and a test that does not
   *   return it is testing a device that lost its place.
   */
  const cursores = new Map<string, string | null>();

  const pull = async (user: TestUser) => {
    const cursor = cursores.get(user.userId) ?? null;

    const r = await api.post(
      '/sync/pull',
      { deviceId: deviceOf(user), cursor, limit: 200 },
      user.accessToken,
    );

    const siguiente = r.body?.data?.nextCursor;
    if (typeof siguiente === 'string') cursores.set(user.userId, siguiente);

    return r;
  };

  const deviceOf = (user: TestUser) => {
    const existente = cursores.get(`device:${user.userId}`);
    if (existente) return existente;
    const nuevo = randomUUID();
    cursores.set(`device:${user.userId}`, nuevo);
    return nuevo;
  };

  const titulos = (r: { body?: { data?: { changes?: { entity: string; record: { title?: string; name?: string } }[] } } }) =>
    (r.body?.data?.changes ?? [])
      .map((c) => c.record.title ?? c.record.name)
      .filter(Boolean) as string[];

  it('la cadena entera de una lista compartida llega a un movil sin espacios', async () => {
    const yo = await conEspacio('Pull yo');
    const otra = await createVerifiedUser(api, { displayName: 'Pull otra' });
    // Sin ningun espacio propio: el caso real de alguien a quien le comparten
    // algo antes de que haya creado nada.
    await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'editor',
    });

    // Un elemento nuevo en la lista compartida: es lo que el cursor tiene que
    // traer, y no un cambio de algo que ya estaba.
    const nuevo = randomUUID();
    const r = await push(yo.user, [
      { kind: 'create', entity: 'list_item', entityId: nuevo, payload: { listId: yo.listId, title: 'Huevos', position: 1 } },
    ]);
    expect(r.body?.data?.results?.[0]?.status).toBe('applied');

    const titres = titulos(await pull(otra));
    // La lista y el elemento. El espacio tambien tiene que llegar, o la lista
    // queda colgada de un sitio que no existe en el movil.
    expect(titres).toContain('Compra');
    expect(titres).toContain('Huevos');
  });

  it('lo tuyo sigue llegando igual, compartido o no', async () => {
    // El filtro se toco para admitir cadenas, y un "y" donde deberia haber un "o"
    // hacia desaparecer justo lo de siempre. Esta prueba es la que lo coge.
    const propia = await conEspacio('Pull propia');

    const conCambios = await push(propia.user, [
      { kind: 'create', entity: 'list_item', entityId: randomUUID(), payload: { listId: propia.listId, title: 'Sin compartir', position: 1 } },
      { kind: 'create', entity: 'folder', entityId: randomUUID(), payload: { workspaceId: propia.workspaceId, name: 'Carpeta mia', position: 1 } },
    ]);
    expect(
      conCambios.body?.data?.results?.every((r: { status: string }) => r.status === 'applied'),
    ).toBe(true);

    const titres = titulos(await pull(propia.user));
    expect(titres).toContain('Sin compartir');
    expect(titres).toContain('Carpeta mia');
  });

  it('a quien le comparten un espacio no le sale el nombre del espacio en el asunto', async () => {
    // El asunto tiene dos formas: con el espacio del que viene y sin el. Meter el
    // nombre de un espacio en el asunto de un espacio compartido deja un
    // "de  " con un hueco, y eso es lo que se ve en la bandeja de correo.
    const yo = await conEspacio('Correo yo');
    // Sin `locale`: el helper no lo acepta, y el idioma sale de la fila, que es de
    // donde tiene que salir. Pasarlo por el helper seria inventar un segundo sitio
    // donde se decide en que idioma escribe el correo.
    const otra = await createVerifiedUser(api, { displayName: 'Correo otra' });
    const creada = await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'editor',
    });

    expect(creada.title).toBe('Compra');
    expect(creada.spaceName).toBe('Casa');
    expect(creada.ownerName).toBe('Correo yo');
    expect(creada.address).toBe(otra.email);

    const correo = sharedWithYouEmail({
      to: creada.address,
      locale: creada.locale,
      nodeTitle: creada.title,
      nodeType: 'list',
      spaceName: creada.spaceName,
      ownerName: creada.ownerName,
      role: 'editor',
    });

    // Dice las tres cosas que hay que decir: que, quien, y si se puede tocar.
    expect(correo.subject).toContain('Compra');
    expect(correo.subject).toContain('Correo yo');
    expect(correo.subject).toContain('Casa');
    expect(correo.text).toMatch(/puedes editarlo/);
    // Y el enlace va a la bandeja, no a un sitio que todavia no existe.
    expect(correo.text).toContain('/shared');
    expect(correo.text).not.toMatch(/\/shared\?token=/);
  });

  it('un espacio compartido no lleva el nombre de un espacio en el asunto', async () => {
    const yo = await conEspacio('Correo espacio');
    const otra = await createVerifiedUser(api, { displayName: 'Correo espacio otra' });
    const creada = await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('workspace', yo.workspaceId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'viewer',
    });

    expect(creada.spaceName).toBeNull();

    const correo = sharedWithYouEmail({
      to: creada.address,
      locale: creada.locale,
      nodeTitle: creada.title,
      nodeType: 'workspace',
      spaceName: creada.spaceName,
      ownerName: creada.ownerName,
      role: 'viewer',
    });

    expect(correo.subject).not.toMatch(/de\s+con/);
    expect(correo.subject).toContain('Casa');
    // Y avisa de que no se puede tocar, en vez de dejarlo para descubrirlo.
    expect(correo.text).toMatch(/no puedes cambiarlo|puedes verlo/);
  });

  it('el espacio compartido llega marcado como compartido, y el tuyo no', async () => {
    // La palabra "compartido" en la app sale de este campo, y confundirse aqui
    // pone el simbolo en espacios que no lo son y lo quita de los que si. Un
    // viewer invitado y un viewer al que le compartieron una lista son el mismo
    // `role` y no la misma cosa.
    const yo = await conEspacio('Marca yo');
    const otra = await createVerifiedUser(api, { displayName: 'Marca otra' });
    await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'viewer',
    });

    const campos = (user: TestUser) =>
      pull(user)
        .then((r) =>
          (r.body?.data?.changes ?? [])
            .filter((c: { entity: string }) => c.entity === 'workspace')
            .map((c: { record: { name: string; role: string; shared: boolean } }) => ({
              name: c.record.name,
              role: c.record.role,
              shared: c.record.shared,
            })),
        );

    // El espacio ajeno llega con el papel de la concesion y marcado.
    const ajenos = await campos(otra);
    expect(ajenos).toEqual([{ name: 'Casa', role: 'viewer', shared: true }]);

    // Y el tuyo llega igual que antes: miembro, no compartido.
    const propios = await campos(yo.user);
    expect(propios.every((w: { shared: boolean }) => w.shared === false)).toBe(true);
  });

  it('el papel del espacio compartido es el mas amplio de tus concessiones', async () => {
    // Alguien con una lista en solo lectura y una carpeta con permiso de edicion
    // esta, en ese espacio, como editor: lo que va a encontrar al entrar. Si aqui
    // saliera el primero que llego, entraria pensando que no puede tocar nada.
    const yo = await conEspacio('Amplo yo');
    const otra = await createVerifiedUser(api, { displayName: 'Amplo otra' });
    await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'viewer',
    });
    await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('folder', yo.folderId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'editor',
    });

    const r = await pull(otra);
    const espacio = (r.body?.data?.changes ?? []).find(
      (c: { entity: string }) => c.entity === 'workspace',
    );
    expect(espacio?.record.role).toBe('editor');
    expect(espacio?.record.shared).toBe(true);
  });

  it('revocar manda un entierro, para que el movil lo borre de verdad', async () => {
    // El fallo que decia "ya esta, revocado": el movil se queda con la lista en la
    // cache. La fila es tuya, y nada en el flujo del cursor dice que ya no. La
    // persona sigue viendo la lista en el menu, y offline hasta puede editarla.
    // Parar de traer filas nuevas no devuelve las que ya tenia.
    const yo = await conEspacio('Revocar yo');
    const otra = await createVerifiedUser(api, { displayName: 'Revocar otra' });
    const { shareId } = await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'editor',
    });

    // La primera vez llega entera.
    expect(titulos(await pull(otra))).toContain('Compra');

    await shareService.revokeShare({ userId: yo.user.userId, shareId });

    // Y ahora llega el entierro: la lista, con fecha de borrado, y la marca de que
    // se la llevaron (no la borro esta persona).
    const r = await pull(otra);
    const laLista = (r.body?.data?.changes ?? []).find(
      (c: { entity: string; record: { title?: string } }) =>
        c.entity === 'list' && c.record.title === 'Compra',
    );
    expect(laLista?.record.deletedAt).toBeTruthy();
    expect(laLista?.record.withdrawn).toBe(true);

    // Y no se repite. Este pull ya paso el cursor por la revocacion, asi que la
    // siguiente no dice nada: un entierro es un hecho que se cuenta una vez, y si
    // se reenviara en cada sincronizacion el cliente no tendria forma de saber
    // cuando parar de avisar.
    const otraVez = await pull(otra);
    expect(
      (otraVez.body?.data?.changes ?? []).filter(
        (c: { entity: string; record: { title?: string } }) =>
          c.entity === 'list' && c.record.title === 'Compra',
      ),
    ).toHaveLength(0);
  });

  it('compartir otra vez despues de revocar no lo deja escondido para siempre', async () => {
    // Si el entierro se guardase con `updatedAt`, al volver a compartir se
    // actualizaria esa fila y el movil volveria a esconder la lista para siempre
    // — y no hay forma de que el cliente distinga eso de un fallo.
    const yo = await conEspacio('Revocar dos');
    const otra = await createVerifiedUser(api, { displayName: 'Revocar otra dos' });
    const { shareId } = await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'editor',
    });

    await shareService.revokeShare({ userId: yo.user.userId, shareId });
    // Por el `pull` de verdad, para que el cursor quede donde ha quedado: el
    // siguiente tiene que empezar despues de la revocacion, que es el escenario
    // entero.
    await pull(otra);

    await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'editor',
    });

    // Cambia algo, a proposito: sin un cambio el cursor no avanza y no se puede
    // saber si la lista vuelve o no.
    await push(yo.user, [
      { kind: 'create', entity: 'list_item', entityId: randomUUID(), payload: { listId: yo.listId, title: 'Pan', position: 1 } },
    ]);

    const titres = titulos(await pull(otra));
    expect(titres).toContain('Compra');
    expect(titres).toContain('Pan');
  });

  it('lo revocado deja de llegar con vida, y con un entierro por delante', async () => {
    const yo = await conEspacio('Pull yo tres');
    const otra = await createVerifiedUser(api, { displayName: 'Pull otra tres' });
    const { shareId } = await shareService.createShare({
      ownerUserId: yo.user.userId,
      target: await shareService.resolveTarget('list', yo.listId),
      grantee: { userId: otra.userId, email: otra.email, displayName: null },
      role: 'editor',
    });

    expect(titulos(await pull(otra))).toContain('Compra');

    await shareService.revokeShare({ userId: yo.user.userId, shareId });

    // Lo que llega ya no es una lista viva: es la misma fila con fecha de borrado,
    // que es lo unico que puede hacer que un movil que ya la tiene.cacheada la
    // oculte. Lo que ya no llega —y por eso el nombre no se comprueba aqui— es el
    // *contenido* de una lista revocada: nada nuevo, nada editable.
    const despues = await pull(otra);
    const cambios = despues.body?.data?.changes ?? [];
    const laLista = cambios.find(
      (c: { entity: string; record: { title?: string } }) =>
        c.entity === 'list' && c.record.title === 'Compra',
    );
    expect(laLista?.record.deletedAt).toBeTruthy();

    // Y de los elementos de dentro no llega ni uno sin fecha de borrado: son
    // hijos de una lista que ya no es tuya.
    const items = cambios.filter(
      (c: { entity: string; record: { title?: string; deletedAt?: string | null } }) =>
        c.entity === 'list_item' && c.record.title === 'Leche',
    );
    expect(items).toHaveLength(0);
  });
});
