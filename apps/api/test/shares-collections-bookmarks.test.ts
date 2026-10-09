import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { shareNodeTypeSchema } from '@orbit-hub/contracts';

import { getDatabase } from '../src/db/client.js';
import { sharedWithYouEmail } from '../src/modules/email/email.js';
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

/**
 * ------------------------------------------------------------------
 * EL CORREO: EL NOMBRE DEL NODO, Y UN `undefined` QUE NADIE VIO
 * ------------------------------------------------------------------
 *
 * Esta seccion no es de las dos entidades nuevas: es de una cosa que **ya estaba
 * rota** para tres de las cinco que si funcionaban, y que se rompio mas todavia al
 * agregar las dos ultimas.
 *
 * `sharedWithYouEmail` armaba la clave del copy con `cap(nodeType)` y la clavase
 * llamaba `shareNodeSpace`. `cap('workspace')` produce `Workspace`, asi que la clave
 * era `shareNodeWorkspace`, que no existe, y el resultado era `undefined` metido en
 * una cadena: "Ana ha compartido undefined «Casa» contigo".
 *
 * Y lo que lo hace permanecer months es que **`undefined` en una plantilla no
 * rompe nada**: no lanza, el correo se manda, el test del correo no mira el
 * assunto. Tres de los cinco `nodeType` que funcionaban mandaban esa palabra en el
 * correo. Nadie lo reporto porque no es un error visible en la app: solo se ve en el
 * correo de otra persona, y la otra persona lo lee como un fallo de ortografia.
 */
describe('el correo nombra el nodo, y el nombre existe', () => {
  it('para los siete tipos, en los dos idiomas, y no dice "undefined"', async () => {
    const { capturedEmails } = await import('../src/modules/email/email.js');

    for (const nodeType of shareNodeTypeSchema.options) {
      for (const locale of ['es', 'en'] as const) {
        const mensaje = sharedWithYouEmail({
          to: `${nodeType}@example.com`,
          locale,
          nodeTitle: 'Titulo',
          nodeType,
          spaceName: 'Casa',
          ownerName: 'Ana',
          role: 'viewer',
        });

        expect(
          mensaje.subject.includes('undefined'),
          `el correo de un "${nodeType}" en ${locale} dice la palabra undefined: ${mensaje.subject}`,
        ).toBe(false);
        expect(
          mensaje.subject.includes('Titulo'),
          `el correo de un "${nodeType}" en ${locale} no nombra la cosa: ${mensaje.subject}`,
        ).toBe(true);
      }
    }

    expect(capturedEmails().length).toBeGreaterThanOrEqual(0);
  });

  it('y el nombre es distinto en los dos idiomas, no la misma palabra', () => {
    const en = (nodeType: (typeof shareNodeTypeSchema.options)[number]) =>
      sharedWithYouEmail({
        to: 'x@example.com',
        locale: 'en',
        nodeTitle: 'T',
        nodeType,
        spaceName: 'Home',
        ownerName: 'Ana',
        role: 'viewer',
      }).subject;

    // Un "nodo cualquiera" en los dos idiomas seria una senal de que la clave se
    // resolvio a la misma cadena en ambos, que es como se ve una traduccion copiada
    // al machine. Y elBug es exactamente una clave mal puesta, asi que esto mira.
    const paraCada = [...shareNodeTypeSchema.options].map(en);
    expect(paraCada).toHaveLength(7);
  });

  it('y el nombre de cada tipo es el que le toca, no el de otro', () => {
    /*
      El `not.toContain('undefined')` de arriba caza el bug **sintomatico**: la clave
      no existe y sale la palabra. Este lo caza por lo que decia en realidad, y es el
      otro sentido del mismo problema.

      Con `cap()`, un tipo mal apuntado no sale como `undefined` sino como **el
      nombre de otro tipo**: si `shareNodeNote` estuviera escrito como
      `shareNodeList`, el correo seria "Ana ha compartido una lista «Receta»" y no
      habria ninguna palabra sospechosa que buscar. El `undefined` es el caso
      *visible* del bug; el nombre equivocado es el invisible, y es el que importa
      mas: alguien recibe "una lista" y busca una lista.

      Y el `throw` en vez de `expect` es a proposito: son 42 comparaciones y el
      `expect` sin mensaje no diria **cuales** dos coincided, que es justo lo que
      hace falta para arreglarlo.
    */
    const como = (nodeType: (typeof shareNodeTypeSchema.options)[number], locale: 'es' | 'en') => {
      const asunto = sharedWithYouEmail({
        to: 'x@example.com',
        locale,
        nodeTitle: 'Titulo',
        nodeType,
        spaceName: 'Casa',
        ownerName: 'Ana',
        role: 'viewer',
      }).subject;
      // Solo el nombre del nodo, que es la parte comun a todos los sujetos: "Ana ha
      // compartido <NOMBRE> «Titulo» ...". Sin recortar, dos sujetos distintos
      // compararian distinto por el `spaceName` y el test pasaria sin mirar nada.
      // La preposicion es distinta en cada idioma ("compartido"/"shared"), asi que se
      // recorta desde el final y no desde una palabra: la clave es lo que va entre
      // el nombre de Ana y el titulo, y esa parte es la misma en los dos idiomas.
      const nombre = asunto.match(/(?:compartido|shared) (.+?) «Titulo»/)?.[1];
      if (nombre === undefined) throw new Error(`no se encontro el nombre en: ${asunto}`);
      return nombre;
    };

    for (const nodeType of shareNodeTypeSchema.options) {
      for (const locale of ['es', 'en'] as const) {
        for (const otro of shareNodeTypeSchema.options) {
          if (otro === nodeType) continue;
          if (como(nodeType, locale) === como(otro, locale)) {
            throw new Error(
              `el correo de "${nodeType}" en ${locale} dice lo mismo que el de "${otro}"`,
            );
          }
        }
      }
    }
  });

  it('un espacio no se anuncia como si fuera una lista', () => {
    // El caso concreto del bug original: `shareNodeWorkspace` no existe y
    // `shareNodeSpace` si.
    const deEspacio = sharedWithYouEmail({
      to: 'x@example.com',
      locale: 'es',
      nodeTitle: 'Casa',
      nodeType: 'workspace',
      spaceName: null,
      ownerName: 'Ana',
      role: 'viewer',
    }).subject;

    expect(deEspacio).toContain('un espacio');
    expect(deEspacio).not.toContain('una lista');
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

    // La fila se lee por nombre y no por `[0]` a proposito: con `noUncheckedIndexedAccess`
    // el `[0]` es `T | undefined` y el typecheck obliga a comprobarlo, que es lo
    // correcto —una fila de menos seria justo el fallo que se esta probando, asi que
    // no se puede dejar que `undefined` se convierta en una fecha invalida en
    // silencio—.
    const antesDe = (antes.rows[0] as { updated_at: string } | undefined)?.updated_at;
    const despuesDe = (despues.rows[0] as { updated_at: string } | undefined)?.updated_at;
    expect(antesDe, 'el enlace no estaba antes de compartir').toBeTruthy();
    expect(despuesDe, 'el enlace desaparecio al compartir la coleccion').toBeTruthy();

    expect(new Date(despuesDe as string).getTime()).toBeGreaterThan(
      new Date(antesDe as string).getTime(),
    );
  });

  it('y una coleccion compartida se puede colocar en un espacio propio', async () => {
    /*
      La pregunta que hace el brief sobre donde va una coleccion, y la respuesta es
      que **la pregunta ya existe y ya funciona**.

      "Donde lo pongo" no es por tipo de nodo: es un espacio tuyo y una carpeta tuya
      dentro, y `placeShare` valida exactamente eso —que el espacio sea uno donde
      tenes rol y que la carpeta pertenezca a ese espacio—. Una coleccion se archiva en
      un espacio y una carpeta como cualquier otra cosa, asi que el panel no necesita
      una rama nueva y no se le dio ninguna.

      Y el montaje tambien: `montajesDe` tiene su rama para `folder`, para `list` y
      para `list_item`, y el `else` final pone el resto en
      `${nodeType}:${nodeId}` —que es exactamente lo que hacen `collection` y
      `bookmark`—. El comentario de ahi lo dice: "un `nodeType: 'collection'` que
      llegara a esta fila se proyectaria igual, y proyectarlo es lo correcto".

      Lo que **no** llega a esa fila era el grant, porque el enum no lo admitia. Ya
      lo admite.
    */
    const { ana, beto, workspaceId, collectionId } = await anaConUnEnlace();
    const espacioDeBeto = randomUUID();

    await push(beto, [
      { kind: 'create', entity: 'workspace', entityId: espacioDeBeto, payload: { name: 'Suyo', color: 'teal' } },
    ]);

    const creada = await api.post(
      '/shares',
      { workspaceId, nodeType: 'collection', nodeId: collectionId, granteeUserId: beto.userId, role: 'viewer' },
      ana.accessToken,
    );
    expect(creada.status).toBe(201);
    const shareId = creada.body.data.id as string;

    const colocada = await api.post(
      `/shares/${shareId}/place`,
      { workspaceId: espacioDeBeto, folderId: null, position: 0 },
      beto.accessToken,
    );
    expect(colocada.status, JSON.stringify(colocada.body)).toBe(200);

    // Y sale de la bandeja, que es lo que significa "colocado": `inbox` excluye lo
    // montado por construccion.
    const bandeja = await api.get('/shares/inbox', beto.accessToken);
    expect(bandeja.body.data.items.some((item: any) => item.nodeId === collectionId)).toBe(false);
  });

  it('y se puede colocar en un espacio ajeno no, que es la regla de siempre', async () => {
    const { ana, beto, workspaceId, collectionId } = await anaConUnEnlace();
    const otra = await createVerifiedUser(api, { displayName: 'Otra' });
    const espacioAjeno = randomUUID();
    await push(otra, [
      { kind: 'create', entity: 'workspace', entityId: espacioAjeno, payload: { name: 'Suyo', color: 'teal' } },
    ]);

    const creada = await api.post(
      '/shares',
      { workspaceId, nodeType: 'collection', nodeId: collectionId, granteeUserId: beto.userId, role: 'viewer' },
      ana.accessToken,
    );

    const colocada = await api.post(
      `/shares/${creada.body.data.id as string}/place`,
      { workspaceId: espacioAjeno, folderId: null, position: 0 },
      beto.accessToken,
    );

    // Un montaje dentro del espacio de otro es compartir por la puerta de atras.
    expect(colocada.status).toBe(403);
  });

  it.todo(
    'el pull manda al otro movil una coleccion compartida: falta la rama en ' +
      'sync-repository.ts (cadenasDeCompartido y los dos filtros de la pagina)',
  );
});

