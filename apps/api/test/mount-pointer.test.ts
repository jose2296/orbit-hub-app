import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Where a filed thing is **drawn**, which is not the same question as where it is stored.
 *
 * The pull was rewriting the `workspaceId` of a filed node and nothing else. The client
 * keys its tree on `workspaceId:parentId` for folders and `workspaceId:folderId` for
 * lists and notes (`useSpacesTree`), so a folder filed in Beto's space and still pointing
 * at Ana's folder is looked up under `betoSpace:anaFolderId` — a key nobody asks for.
 *
 * The failure mode is the worst of the three states, and it is silent:
 *
 * - before filing, the folder is visible under Ana's space;
 * - after filing, it is in the pull, gone from the inbox, and **nowhere on screen**.
 *
 * A thing that vanishes the moment you put it somewhere is not a misplaced row, it reads
 * as data loss, and the only way to get it back is to re-share it.
 *
 * The second half of the rule is that **descendants keep their own parent**. Rewriting
 * `parentId` on everything under the filed folder would pile the whole subtree at the
 * root of the recipient's space, which is a different bug and an equally silent one: a
 * tree that is suddenly flat and nobody can say why.
 */
describe('colocado no es solo cambiar el espacio: hay que cambiar donde se cuelga', () => {
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
          clientId: 'test-client-mount-pointer',
          baseVersion: 0,
          payload: {},
          base: null,
          clientTimestamp: new Date().toISOString(),
          ...operation,
        })),
      },
      user.accessToken,
    );
  }

  async function pull(user: TestUser, cursor: string | null = null) {
    const respuesta = await api.post(
      '/sync/pull',
      { deviceId: randomUUID(), cursor, limit: 200 },
      user.accessToken,
    );
    return {
      cursor: respuesta.body.data.nextCursor as string | null,
      cambios: respuesta.body.data.changes as {
        entity: string;
        record: Record<string, unknown>;
      }[],
      de: (id: string) =>
        respuesta.body.data.changes.find(
          (c: { record: { id?: string } }) => c.record?.id === id,
        )?.record,
    };
  }

  /** `Ana: Casa > Viajes > {2026 > {Pistas, y una nota al lado}}`, and Beto's two spaces. */
  async function arbol() {
    const ana = await createVerifiedUser(api, { displayName: 'Ana' });
    const beto = await createVerifiedUser(api, { displayName: 'Beto' });
    const anaSpace = randomUUID();
    const betoSpace = randomUUID();
    const betoFolder = randomUUID();
    const viajes = randomUUID();
    const anio = randomUUID();
    const pistas = randomUUID();
    const fila = randomUUID();
    const notaAlLado = randomUUID();

    await push(ana, [
      { kind: 'create', entity: 'workspace', entityId: anaSpace, payload: { name: 'Casa de Ana', color: 'teal' } },
      { kind: 'create', entity: 'folder', entityId: viajes, payload: { workspaceId: anaSpace, name: 'Viajes', position: 0 } },
      { kind: 'create', entity: 'folder', entityId: anio, payload: { workspaceId: anaSpace, parentId: viajes, name: '2026', position: 0 } },
      { kind: 'create', entity: 'list', entityId: pistas, payload: { workspaceId: anaSpace, folderId: anio, title: 'Pistas', kind: 'tasks', position: 0 } },
      { kind: 'create', entity: 'list_item', entityId: fila, payload: { listId: pistas, title: 'Roma', position: 0 } },
      { kind: 'create', entity: 'note', entityId: notaAlLado, payload: { workspaceId: anaSpace, folderId: anio, title: 'Secreto', document: '<p>x</p>', tags: [] } },
    ]);
    await push(beto, [
      { kind: 'create', entity: 'workspace', entityId: betoSpace, payload: { name: 'Casa de Beto', color: 'fucsia' } },
      { kind: 'create', entity: 'folder', entityId: betoFolder, payload: { workspaceId: betoSpace, name: 'Donde lo quiero', position: 0 } },
    ]);

    return { ana, beto, anaSpace, betoSpace, betoFolder, viajes, anio, pistas, fila, notaAlLado };
  }

  async function compartirCarpeta(
    ana: TestUser,
    nodeId: string,
    workspaceId: string,
    beto: TestUser,
  ): Promise<string> {
    const respuesta = await api.post(
      '/shares',
      { workspaceId, nodeType: 'folder', nodeId, granteeUserId: beto.userId, role: 'editor' },
      ana.accessToken,
    );
    expect(respuesta.status).toBe(201);
    return respuesta.body.data.id as string;
  }

  it('colocada en una carpeta sua, la carpeta ajena cuelga de esa y no de la de Ana', async () => {
    const { ana, beto, anaSpace, betoSpace, betoFolder, viajes } = await arbol();
    const shareId = await compartirCarpeta(ana, viajes, anaSpace, beto);

    const colocada = await api.post(
      `/shares/${shareId}/place`,
      { workspaceId: betoSpace, folderId: betoFolder, position: 0 },
      beto.accessToken,
    );
    expect(colocada.status).toBe(200);

    const arbolBeto = await pull(beto);
    const fila = arbolBeto.de(viajes)!;

    expect(fila.workspaceId).toBe(betoSpace);
    // This is the assertion the whole file exists for. It is `viajes` and not `anio`
    // that was filed, so `viajes` takes the destination's folder and `anio` does not.
    expect(fila['parentId']).toBe(betoFolder);
  });

  it('colocada en la raiz, la carpeta cuelga de la raiz y se ve entre las de su espacio', async () => {
    const { ana, beto, anaSpace, betoSpace, viajes } = await arbol();
    const shareId = await compartirCarpeta(ana, viajes, anaSpace, beto);
    await api.post(
      `/shares/${shareId}/place`,
      { workspaceId: betoSpace, folderId: null, position: 0 },
      beto.accessToken,
    );

    const fila = (await pull(beto)).de(viajes)!;
    expect(fila.workspaceId).toBe(betoSpace);
    // `null`, not Ana's `Viajes`. The key the client looks up is `betoSpace:root`, and
    // anything else is a key it never asks for.
    expect(fila['parentId']).toBeNull();
  });

  it('colocar una lista la cuelga de la carpeta elegida, que es donde se puede mirar', async () => {
    const { ana, beto, anaSpace, betoSpace, betoFolder, pistas } = await arbol();

    const compartida = await api.post(
      '/shares',
      { workspaceId: anaSpace, nodeType: 'list', nodeId: pistas, granteeUserId: beto.userId, role: 'editor' },
      ana.accessToken,
    );
    expect(compartida.status).toBe(201);
    await api.post(
      `/shares/${compartida.body.data.id}/place`,
      { workspaceId: betoSpace, folderId: betoFolder, position: 0 },
      beto.accessToken,
    );

    const fila = (await pull(beto)).de(pistas)!;
    expect(fila.workspaceId).toBe(betoSpace);
    // Lists are keyed by `folderId`, not `parentId`. Rewriting the space alone left the
    // list pointing at `2026`, which Beto does not have.
    expect(fila['folderId']).toBe(betoFolder);
  });

  it('lo que cuelga debajo conserva a su padre, y no se aplana en la raiz', async () => {
    const { ana, beto, anaSpace, betoSpace, viajes, anio, pistas } = await arbol();
    const shareId = await compartirCarpeta(ana, viajes, anaSpace, beto);
    await api.post(
      `/shares/${shareId}/place`,
      { workspaceId: betoSpace, folderId: null, position: 0 },
      beto.accessToken,
    );

    const arbolBeto = await pull(beto);
    const filaAnio = arbolBeto.de(anio)!;
    const filaLista = arbolBeto.de(pistas)!;

    // `2026` was not filed, it came along inside `Viajes`, and it is still inside it.
    // Flattening the subtree would put both of these at the root of Beto's space and
    // leave a tree that no longer looks like the one Ana sent.
    expect(filaAnio.workspaceId).toBe(betoSpace);
    expect(filaAnio['parentId']).toBe(viajes);
    expect(filaLista.workspaceId).toBe(betoSpace);
    expect(filaLista['folderId']).toBe(anio);
  });

  it('compartir una fila mueve la lista de la fila, que es donde se pinta', async () => {
    /*
     * Una fila no se coloca: no tiene carpeta, no tiene sitio, no se puede arrastrar a
     * ningun lado. Lo que se coloca es **la lista que la contiene**, y por eso una concesion
     * sobre una fila tiene que re-apuntar la lista entera.
     *
     * Antes solo se movia la fila. La lista se quedaba en el espacio de Ana — que ademas
     * ya no se manda, porque no hace falta para pintar nada — y el resultado era una fila
     * que estaba en el pull y en ningun sitio: el cliente indexa por
     * `workspaceId:folderId`, y su lista no estaba en ningun espacio que el dispositivo
     * conociera. Es la misma desaparición, un nivel mas abajo, y por el mismo motivo.
     */
    const { ana, beto, anaSpace, betoSpace, betoFolder, pistas, fila } = await arbol();
    const compartida = await api.post(
      '/shares',
      { workspaceId: anaSpace, nodeType: 'list_item', nodeId: fila, granteeUserId: beto.userId, role: 'editor' },
      ana.accessToken,
    );
    expect(compartida.status).toBe(201);
    await api.post(
      `/shares/${compartida.body.data.id}/place`,
      { workspaceId: betoSpace, folderId: betoFolder, position: 0 },
      beto.accessToken,
    );

    const arbolBeto = await pull(beto);
    const filaLista = arbolBeto.de(pistas)!;
    const filaDeLaFila = arbolBeto.de(fila)!;

    // La lista, en el sitio elegido. Y sin su fila no hay nada en el sitio elegido.
    expect(filaLista.workspaceId).toBe(betoSpace);
    expect(filaLista['folderId']).toBe(betoFolder);
    expect(filaDeLaFila.workspaceId).toBe(betoSpace);
    // Y el papel de la concesion, que en este caso no es miembro de nada.
    expect(filaLista.shared).toBe(true);
    expect(filaLista.role).toBe('editor');
  });

  it('lo que cuelga de una carpeta compartida se dice compartido, con el papel de la concesion', async () => {
    /*
     * La insignia, y es una mentira en las dos direcciones.
     *
     * `carpetasConcedidas` —la carpeta y **todo lo que hay debajo**— ya admitia la fila en
     * el pull, pero `accesoDe` miraba solo si la concesion nombraba esa carpeta. Una carpeta
     * un nivel mas abajo no la nombra nadie, asi que salia con `shared: false` y
     * `role: viewer`: "esto es tuyo" sobre una carpeta que escribio otra persona, y "solo
     * puedes mirar" sobre una que se compartio con permiso de editar.
     *
     * Dos preguntas, una respuesta, y las dos mitades de la respuesta no coincidieron: el
     * filtro de filas reconocia lo que el badge negaba.
     */
    const { ana, beto, anaSpace, betoSpace, viajes, anio, pistas } = await arbol();
    const shareId = await compartirCarpeta(ana, viajes, anaSpace, beto);
    await api.post(
      `/shares/${shareId}/place`,
      { workspaceId: betoSpace, folderId: null, position: 0 },
      beto.accessToken,
    );

    const arbolBeto = await pull(beto);

    // La carpeta granddaughter, que no la nombra ninguna concesion.
    const nietas = arbolBeto.de(anio)!;
    expect(nietas).toBeTruthy();
    expect(nietas.shared).toBe(true);
    // Y con el papel que se concedio, no el mas flojo que se pueda inventar.
    expect(nietas.role).toBe('editor');

    // Y su lista, que ya decia la verdad, sigue diciendola.
    expect(arbolBeto.de(pistas)!.shared).toBe(true);
    expect(arbolBeto.de(pistas)!.role).toBe('editor');
  });

  it('un espacio entregado entero alcanza a lo que hay dentro, con su mismo papel', async () => {
    /*
     * El mismo fallo por el otro lado del mueble.
     *
     * Una concesion de espacio llega con sus tres punteros a `null` —no es una carpeta, ni
     * una lista, ni una nota—, asi que `accesoDe` no la reconocia en ninguna fila de esa
     * sala. Decia `role: viewer` sobre listas que el servidor, en ese mismo instante, si
     * estaba dejando editar: un numero concreto y falso, que es peor que no decir nada.
     *
     * (`whole-space-write.test.ts` es el que comprueba que el servidor de verdad acepta el
     * cambio, porque desde aqui no se ve si el permiso se aplica o solo se anuncia.)
     *
     * Y el `shared` de una lista de ahi si es `true`, porque a la lista se llego por una
     * concesion y no por una membresia. No es "mio": es de una sala que no es mia.
     */
    const { ana, beto, anaSpace, pistas } = await arbol();
    const compartida = await api.post(
      '/shares',
      { workspaceId: anaSpace, nodeType: 'workspace', nodeId: anaSpace, granteeUserId: beto.userId, role: 'editor' },
      ana.accessToken,
    );
    expect(compartida.status).toBe(201);

    const arbolBeto = await pull(beto);
    const lista = arbolBeto.de(pistas)!;
    expect(lista).toBeTruthy();
    expect(lista.shared).toBe(true);
    expect(lista.role).toBe('editor');
  });

  it('la nota que no se compartio no aparece aunque se comparta la carpeta de al lado', async () => {
    // The projection has to stay a projection: it moves what was granted and nothing
    // else. A note is a document somebody wrote, and a shared folder is not permission
    // to read the one next to it.
    const { ana, beto, anaSpace, betoSpace, anio, notaAlLado } = await arbol();
    const shareId = await compartirCarpeta(ana, anio, anaSpace, beto);
    await api.post(
      `/shares/${shareId}/place`,
      { workspaceId: betoSpace, folderId: null, position: 0 },
      beto.accessToken,
    );

    const arbolBeto = await pull(beto);
    // The preconditions, so that the absence below means something: the folder and its
    // list are in the pull, and the note is not.
    expect(arbolBeto.de(anio)).toBeTruthy();
    expect(arbolBeto.de(notaAlLado)).toBeUndefined();
  });
});
