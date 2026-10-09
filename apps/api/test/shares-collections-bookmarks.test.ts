import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { shareNodeTypeSchema } from '@orbit-hub/contracts';

import { getDatabase } from '../src/db/client.js';
import { shareService } from '../src/modules/shares/share-service.js';
import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Una coleccion y un enlace se comparten, y las **tres** copias de la misma lista de
 * tipos tienen que concordar: el enum de Zod, el `$type<>` de la columna y el CHECK
 * de Postgres.
 *
 * ------------------------------------------------------------------
 * POR QUE HACE FALTA UNA MIGRACION Y NO SOLO EL ENUM
 * ------------------------------------------------------------------
 *
 * El brief decia que no hacia falta migracion, y es media verdad: el `varchar(16)`
 * entra de sobra --`collection` son 10 caracteres y `bookmark` son 8—, pero el CHECK
 * enumera los valores uno por uno desde `0011`. Sin tocarlo el POST pasa Zod, el
 * servicio resuelve el nodo, y la fila muere en Postgres con un `check violation` que
 * le llega a quien comparte como un 500 y a nadie mas como una traza.
 *
 * ------------------------------------------------------------------
 * POR QUE EL CHECK SE COMPRUEBA EN CRUDO
 * ------------------------------------------------------------------
 *
 * Porque pasando por la aplicacion lo pararia el enum, que es justamente lo que se
 * quiere comprobar: que la columna admite lo que el contrato acaba de abrir. Por eso
 * el INSERT de esta prueba es SQL escrito a mano.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRaiz = resolve(here, '..');

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
        clientId: 'test-client-share-collection',
        baseVersion: 0,
        payload: {},
        clientTimestamp: new Date().toISOString(),
        ...operation,
      })),
    },
    user.accessToken,
  );
}

/** Ana con un espacio, una carpeta, una coleccion y un enlace dentro de la carpeta. */
async function anaConUnEnlace() {
  const ana = await createVerifiedUser(api, { displayName: 'Ana' });
  const beto = await createVerifiedUser(api, { displayName: 'Beto' });
  const workspaceId = randomUUID();
  const folderId = randomUUID();
  const collectionId = randomUUID();
  const bookmarkId = randomUUID();

  const enviado = await push(ana, [
    { kind: 'create', entity: 'workspace', entityId: workspaceId, payload: { name: 'Casa', color: 'teal' } },
    { kind: 'create', entity: 'folder', entityId: folderId, payload: { workspaceId, name: 'Links', position: 0 } },
    {
      kind: 'create',
      entity: 'collection',
      entityId: collectionId,
      payload: { workspaceId, folderId, name: 'Recetas', emoji: 'x', position: 0 },
    },
    {
      kind: 'create',
      entity: 'bookmark',
      entityId: bookmarkId,
      payload: {
        workspaceId,
        folderId,
        collectionId,
        url: 'https://example.com/tortilla',
        title: 'Tortilla',
        tags: [],
        position: 0,
      },
    },
  ]);

  for (const resultado of enviado.body.data.results) {
    expect(resultado.status, JSON.stringify(enviado.body)).toBe('applied');
  }

  return { ana, beto, workspaceId, folderId, collectionId, bookmarkId };
}

describe('las tres copias de la lista de tipos, y que sean la misma', () => {
  it('el enum de Zod admite los dos y sigue sin admitir una plantilla', () => {
    for (const uno of [
      'workspace',
      'folder',
      'list',
      'list_item',
      'note',
      'collection',
      'bookmark',
    ]) {
      expect(shareNodeTypeSchema.safeParse(uno).success, uno).toBe(true);
    }
    // El que se fue en la T9 se tiene que seguir yendo: es el otro lado del enum.
    expect(shareNodeTypeSchema.safeParse('note_template').success).toBe(false);
  });

  it('la base de datos admite los dos, y sigue rechazando lo que nadie escribio', async () => {
    const { db } = await getDatabase();
    const yo = await createVerifiedUser(api, { displayName: 'Dueno' });
    const otro = await createVerifiedUser(api, { displayName: 'Invitado' });

    for (const tipo of ['collection', 'bookmark']) {
      await expect(
        db.execute(
          `insert into shares (owner_user_id, node_type, node_id, grantee_user_id, role)
           values ('${yo.userId}', '${tipo}', '${randomUUID()}', '${otro.userId}', 'viewer')`,
        ),
        tipo,
      ).resolves.toBeDefined();
    }

    // Un CHECK que admite de mas no rompe nada visible: admite una concesion que no
    // resuelve, que es una fila muerta. Uno que admite de menos rompe la pantalla de
    // compartir con un 500.
    await expect(
      db.execute(
        `insert into shares (owner_user_id, node_type, node_id, grantee_user_id, role)
         values ('${yo.userId}', 'galaxia', '${randomUUID()}', '${otro.userId}', 'viewer')`,
      ),
    ).rejects.toThrow();
  });

  /*
    El `$type<>` de la columna es la **tercera** copia escrita a mano de la misma
    lista, y la unica que se puede desincronizar sin que nada falle: `$type<>` no
    existe en Postgres, asi que un `$type<>` viejo sigue tipando perfecto mientras la
    columna acepta otra cosa —o al reves—. Y el CHECK es una cuarta, en SQL.

    Las tres se comparan aqui contra el enum en la misma prueba, que es la unica
    forma de que "las tres copias" deje de ser una frase: si el enum de Zod gana un
    valor y el CHECK no, esta prueba falla con los dos nombres en el mensaje.
  */
  it('el $type de la columna y el CHECK de la migracion dicen lo mismo que el enum', () => {
    const delEnum = [...shareNodeTypeSchema.options].sort();

    const esquema = readFileSync(resolve(apiRaiz, 'src/db/content-schema.ts'), 'utf8');
    const delTipo = [
      ...(esquema.match(/nodeType: varchar\('node_type'[\s\S]*?\$type<([^>]*)>\(\)/)?.[1] ?? '').matchAll(
        /'([^']+)'/g,
      ),
    ]
      .map((m) => m[1]!)
      .sort();
    expect(delTipo, 'no se encontro el $type<>() de shares.node_type').toEqual(delEnum);

    // La ultima migracion que menciona el CHECK manda: las anteriores lo reescriben
    // y si se lee la primera se compara contra un enum de hace tres fases.
    // La ultima migracion que menciona el CHECK manda: las anteriores lo reescriben
    // y leer la primera es comparar contra un enum de hace tres fases. El orden es
    // el del nombre y no el que devuelva el sistema de ficheros.
    const carpeta = resolve(apiRaiz, 'drizzle');
    const ultima = readFileSync(
      resolve(carpeta, readdirSync(carpeta).filter((n) => n.endsWith('.sql')).sort().at(-1)!),
      'utf8',
    );
    const delCheck = [
      ...(ultima.match(/check \(node_type in \(([^)]*)\)\)/)?.[1] ?? '').matchAll(/'([^']+)'/g),
    ]
      .map((m) => m[1]!)
      .sort();
    expect(delCheck, 'la ultima migracion no reescribe el CHECK').toEqual(delEnum);
  });
});

describe('compartir una coleccion y un enlace', () => {
  it('los dos se comparten por HTTP, y no con un 400 del contrato', async () => {
    const { ana, beto, workspaceId, collectionId, bookmarkId } = await anaConUnEnlace();

    for (const [tipo, nodeId] of [
      ['collection', collectionId],
      ['bookmark', bookmarkId],
    ] as const) {
      const creada = await api.post(
        '/shares',
        { workspaceId, nodeType: tipo, nodeId, granteeUserId: beto.userId, role: 'viewer' },
        ana.accessToken,
      );

      expect(creada.status, `${tipo}: ${JSON.stringify(creada.body)}`).toBe(201);
    }
  });

  it('el nodo se resuelve con su titulo y con su espacio', async () => {
    const { workspaceId, collectionId, bookmarkId } = await anaConUnEnlace();

    expect(await shareService.resolveTarget('collection', collectionId)).toEqual({
      nodeType: 'collection',
      nodeId: collectionId,
      title: 'Recetas',
      workspaceId,
    });

    expect(await shareService.resolveTarget('bookmark', bookmarkId)).toEqual({
      nodeType: 'bookmark',
      nodeId: bookmarkId,
      title: 'Tortilla',
      workspaceId,
    });
  });

  it('un enlace sin titulo usa la url, y no se manda un correo en blanco', async () => {
    /*
      `bookmarks.title` es `not null default ''`: un enlace guardado hace treinta
      segundos lo tiene vacio y lo rellena la extraccion despues. Es el unico nodo
      compartible cuyo titulo puede faltar de verdad, y `ShareTarget` promete uno
      porque es lo que el otro lee en el correo y en la bandeja.
    */
    const ana = await createVerifiedUser(api, { displayName: 'Sin titulo' });
    const workspaceId = randomUUID();
    const bookmarkId = randomUUID();

    await push(ana, [
      { kind: 'create', entity: 'workspace', entityId: workspaceId, payload: { name: 'Casa', color: 'teal' } },
      {
        kind: 'create',
        entity: 'bookmark',
        entityId: bookmarkId,
        payload: {
          workspaceId,
          folderId: null,
          collectionId: null,
          url: 'https://example.com/sin-titulo',
          tags: [],
          position: 0,
        },
      },
    ]);

    const target = await shareService.resolveTarget('bookmark', bookmarkId);
    expect(target.title).toBe('https://example.com/sin-titulo');
  });

  it('un id que no existe responde 404, y no cae en la tabla de items', async () => {
    // `resolveTarget` tiene un `else` final que busca en `list_items`, asi que un
    // tipo sin rama daria el 404 de otra tabla. Sigue siendo 404, que es lo que
    // importa: nunca dice "existe pero no es tuyo" de algo que no existe.
    await expect(shareService.resolveTarget('collection', randomUUID())).rejects.toThrow(
      /does not exist/i,
    );
    await expect(shareService.resolveTarget('bookmark', randomUUID())).rejects.toThrow(
      /does not exist/i,
    );
  });

  it('el enlace llega a la bandeja del otro, con el titulo resuelto', async () => {
    const { ana, beto, workspaceId, bookmarkId } = await anaConUnEnlace();

    await api.post(
      '/shares',
      { workspaceId, nodeType: 'bookmark', nodeId: bookmarkId, granteeUserId: beto.userId, role: 'viewer' },
      ana.accessToken,
    );

    const bandeja = await api.get('/shares/inbox', beto.accessToken);
    const mio = bandeja.body.data.items.find((item: any) => item.nodeId === bookmarkId);

    expect(mio).toBeTruthy();
    expect(mio.nodeType).toBe('bookmark');
    expect(mio.title).toBe('Tortilla');
  });
});

describe('los permisos: que concesion alcanza a que', () => {
  it('tener la carpeta ya alcanza el enlace archivado en ella', async () => {
    /*
      La rama nueva de `ancestorsOf`: una coleccion y un enlace anaden la carpeta en
      la que estan archivados. Sin eso, compartir la carpeta y que el enlace de
      dentro siga sin verse seria el mismo fallo que una lista compartida que no
      trae sus items.
    */
    const { ana, beto, workspaceId, folderId, bookmarkId } = await anaConUnEnlace();

    await api.post(
      '/shares',
      { workspaceId, nodeType: 'folder', nodeId: folderId, granteeUserId: beto.userId, role: 'editor' },
      ana.accessToken,
    );

    const repetida = await api.post(
      '/shares',
      { workspaceId, nodeType: 'bookmark', nodeId: bookmarkId, granteeUserId: beto.userId, role: 'editor' },
      ana.accessToken,
    );

    expect(repetida.status).toBe(409);
  });

  it('pero una carpeta no alcanza a lo que esta en OTRA carpeta', async () => {
    // El caso contrario, que es el que hace que la de arriba signifique algo:
    // acumular la carpeta no es acumular cualquier carpeta del espacio.
    const ana = await createVerifiedUser(api, { displayName: 'Ana' });
    const beto = await createVerifiedUser(api, { displayName: 'Beto' });
    const workspaceId = randomUUID();
    const unaCarpeta = randomUUID();
    const otraCarpeta = randomUUID();
    const enlaceId = randomUUID();

    await push(ana, [
      { kind: 'create', entity: 'workspace', entityId: workspaceId, payload: { name: 'Casa', color: 'teal' } },
      { kind: 'create', entity: 'folder', entityId: unaCarpeta, payload: { workspaceId, name: 'Una', position: 0 } },
      { kind: 'create', entity: 'folder', entityId: otraCarpeta, payload: { workspaceId, name: 'Otra', position: 1 } },
      {
        kind: 'create',
        entity: 'bookmark',
        entityId: enlaceId,
        payload: {
          workspaceId,
          folderId: otraCarpeta,
          collectionId: null,
          url: 'https://example.com/otra',
          title: 'Otro',
          tags: [],
          position: 0,
        },
      },
    ]);

    await api.post(
      '/shares',
      { workspaceId, nodeType: 'folder', nodeId: unaCarpeta, granteeUserId: beto.userId, role: 'editor' },
      ana.accessToken,
    );

    const creada = await api.post(
      '/shares',
      { workspaceId, nodeType: 'bookmark', nodeId: enlaceId, granteeUserId: beto.userId, role: 'editor' },
      ana.accessToken,
    );

    expect(creada.status, JSON.stringify(creada.body)).toBe(201);
  });

  it('un enlace no acumula su coleccion, porque una coleccion es una etiqueta', async () => {
    /*
      `bookmarks.collection_id` es `on delete set null` y no `cascade`: borrar una
      coleccion deja sus enlaces vivos como "sin coleccion". O sea que la relacion no
      es de contencion sino de clasificacion, y acumularla seria decir que tener la
      etiqueta da todos los enlaces que alguna vez se clasificaron bajo ella, que es
      justo lo que no pasa cuando se borra.

      Que la app **exporte** una coleccion con sus enlaces si es otra pregunta, y
      esta contestada al reves a proposito: exportar es una foto de lo que hay ahora.
    */
    const { ana, beto, workspaceId, collectionId, bookmarkId } = await anaConUnEnlace();

    await api.post(
      '/shares',
      { workspaceId, nodeType: 'collection', nodeId: collectionId, granteeUserId: beto.userId, role: 'editor' },
      ana.accessToken,
    );

    const creada = await api.post(
      '/shares',
      { workspaceId, nodeType: 'bookmark', nodeId: bookmarkId, granteeUserId: beto.userId, role: 'editor' },
      ana.accessToken,
    );

    expect(creada.status, JSON.stringify(creada.body)).toBe(201);
  });

  it('se puede preguntar quien mas llega al nodo, y solo a quien llega', async () => {
    const { ana, beto, workspaceId, collectionId } = await anaConUnEnlace();
    const carmen = await createVerifiedUser(api, { displayName: 'Carmen' });

    await api.post(
      '/shares',
      { workspaceId, nodeType: 'collection', nodeId: collectionId, granteeUserId: beto.userId, role: 'viewer' },
      ana.accessToken,
    );

    const deCarmen = await api.get(`/shares/collection/${collectionId}/reach`, carmen.accessToken);
    // No es miembro ni tiene concesion: no puede ni averiguar que hay ahi.
    expect(deCarmen.status).toBe(404);

    const delDueno = await api.get(`/shares/collection/${collectionId}/reach`, ana.accessToken);
    expect(delDueno.status).toBe(200);
    expect(delDueno.body.data.count).toBe(1);
    expect(delDueno.body.data.people[0].email).toBe(beto.email);
  });

  it('quien no es del espacio no comparte, y el motivo lo dice', async () => {
    const { beto, workspaceId, collectionId } = await anaConUnEnlace();
    const ajena = await createVerifiedUser(api, { displayName: 'Ajena' });

    const creada = await api.post(
      '/shares',
      { workspaceId, nodeType: 'collection', nodeId: collectionId, granteeUserId: beto.userId, role: 'viewer' },
      ajena.accessToken,
    );

    expect(creada.status).toBe(403);
    expect(creada.body.error?.message).toMatch(/do not belong/i);
  });
});

describe('el reloj del nodo y el de lo que tiene debajo', () => {
  it('compartir una coleccion mueve el reloj de los enlaces que tiene dentro', async () => {
    /*
      El pull filtra por el reloj de **cada fila**: el bloque de `bookmarks` en
      `sync-repository.ts` pregunta por `bookmarks.updated_at`. Un enlace guardado la
      semana pasada tiene un reloj de la semana pasada, asi que sin esto la concesion
      no lo mueve, no llega, y el otro movil recibe una coleccion con cero enlaces
      dentro — el fallo exacto que el bloque de `folder` ya tuvo que arreglar para
      las listas que lleva dentro.

      Se mira la tabla y no el pull a proposito: el pull **todavia no manda**
      colecciones ni enlaces compartidos (ver `it.todo` de abajo), asi que mirar el
      pull probaria el hueco y no el cambio.
    */
    const { ana, beto, workspaceId, collectionId } = await anaConUnEnlace();
    const { db } = await getDatabase();

    const antes = await db.execute(
      `select updated_at from bookmarks where collection_id = '${collectionId}'`,
    );
    expect(antes.rows).toHaveLength(1);

    await api.post(
      '/shares',
      { workspaceId, nodeType: 'collection', nodeId: collectionId, granteeUserId: beto.userId, role: 'viewer' },
      ana.accessToken,
    );

    const despues = await db.execute(
      `select updated_at from bookmarks where collection_id = '${collectionId}'`,
    );
    expect(
      new Date(despues.rows[0].updated_at as string).getTime(),
    ).toBeGreaterThan(new Date(antes.rows[0].updated_at as string).getTime());
  });

  it.todo(
    'el pull manda al otro movil una coleccion compartida: falta la rama en ' +
      'sync-repository.ts (cadenasDeCompartido y los dos filtros de la pagina)',
  );
});

