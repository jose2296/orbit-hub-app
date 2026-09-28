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
