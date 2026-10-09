import {
  accountExportSchema,
  BOOKMARK_EXPORT_CSV_COLUMNS,
  BOARD_EXPORT_CSV_COLUMNS,
  collectionExportSchema,
  LIST_EXPORT_CSV_COLUMNS,
  listExportSchema,
} from '@orbit-hub/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { extraerContenido } from '../src/modules/bookmarks/extract-content.js';
import { extractBookmark } from '../src/modules/bookmarks/extract-service.js';
import { sacarmetadata } from '../src/modules/bookmarks/extract-metadata.js';

import { createVerifiedUser, espacioPropio, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * La exportacion de contenidos.
 *
 * Las respuestas de estos endpoints no pasan por `api.get()`: el helper hace
 * `JSON.parse(text)` siempre y reventaria con un CSV. Se llama a `fetch`
 * directamente, que es el precedente de `attachments.test.ts`.
 */
let api: TestServer;

beforeAll(async () => {
  api = await startTestServer();
});

afterAll(async () => {
  await api.close();
});

type OperationInput = {
  entity: string;
  kind: 'create' | 'update' | 'delete';
  entityId: string;
  baseVersion?: number;
  payload?: Record<string, unknown> | null;
  base?: Record<string, unknown> | null;
};

async function sync(user: TestUser, operations: OperationInput[]) {
  return api.post(
    '/sync/push',
    {
      deviceId: randomUUID(),
      lastPulledAt: null,
      operations: operations.map((operation) => ({
        operationId: randomUUID(),
        clientId: 'test-client-export',
        entityId: operation.entityId,
        baseVersion: operation.baseVersion ?? 0,
        payload: operation.payload ?? null,
        base: operation.base ?? null,
        clientTimestamp: new Date().toISOString(),
        entity: operation.entity,
        kind: operation.kind,
      })),
    },
    user.accessToken,
  );
}

async function createFolder(user: TestUser, workspaceId: string, name: string): Promise<string> {
  const id = randomUUID();
  const response = await sync(user, [
    { entity: 'folder', kind: 'create', entityId: id, payload: { workspaceId, name } },
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

async function createList(
  user: TestUser,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID();
  const response = await sync(user, [
    {
      entity: 'list',
      kind: 'create',
      entityId: id,
      payload: { workspaceId, kind: 'tasks', title: 'Lista', ...overrides },
    },
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

async function createItem(
  user: TestUser,
  listId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID();
  const response = await sync(user, [
    {
      entity: 'list_item',
      kind: 'create',
      entityId: id,
      payload: { listId, title: 'Elemento', ...overrides },
    },
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

async function createNote(user: TestUser, workspaceId: string, title: string): Promise<string> {
  const id = randomUUID();
  const response = await sync(user, [
    {
      entity: 'note',
      kind: 'create',
      entityId: id,
      payload: { workspaceId, title, document: '<p>Con foto</p>' },
    },
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

async function deleteEntity(user: TestUser, entity: string, entityId: string): Promise<void> {
  const response = await sync(user, [{ entity, kind: 'delete', entityId }]);
  expect(response.body.data.results[0].status).toBe('applied');
}

/** Una coleccion por sync, con la misma forma de payload que usa la app. */
async function createCollection(
  user: TestUser,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID();
  const response = await sync(user, [
    {
      entity: 'collection',
      kind: 'create',
      entityId: id,
      payload: { workspaceId, folderId: null, name: 'Recetas', position: 0, ...overrides },
    },
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

/**
 * Un enlace, y **el `collectionId` va siempre explicito**: es la clave que
 * `bookmarks-destino.test.ts` dejo anotada —la que falta no es la que vale
 * `null`—, y un enlace creado sin ella no lo recoge el export de una coleccion.
 */
async function createBookmark(
  user: TestUser,
  workspaceId: string,
  collectionId: string | null,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID();
  const response = await sync(user, [
    {
      entity: 'bookmark',
      kind: 'create',
      entityId: id,
      payload: {
        workspaceId,
        folderId: null,
        collectionId,
        url: 'https://example.com/receta',
        title: 'Tortilla',
        tags: [],
        position: 0,
        ...overrides,
      },
    },
  ]);
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

/**
 * Un enlace con el articulo dentro, **pasando por la extraccion de verdad**.
 *
 * `document`, `plainText`, `siteName`, `description` e `imageUrl` los escribe la
 * extraccion y **nadie mas**: el sanitizador de `sync` los tira al crear y al
 * actualizar (`sync-service.ts`, "los siete campos del servidor"). Un fixture que
 * los escribiera por la puerta de al lado estaria probando una fila que la base
 * no puede tener, asi que el enlace se extrae con dependencias falsas —el mismo
 * camino que `bookmarks-extract.test.ts`— y lo que se comprueba despues es lo que
 * de verdad quedo guardado.
 */
const PAGINA_EXTRAIDA =
  '<!doctype html><html><head><title>La pagina</title>' +
  '<meta property="og:site_name" content="El sitio">' +
  '<meta property="og:description" content="La descripcion del sitio">' +
  '</head><body><article><h1>La pagina</h1><p>' +
  'palabra '.repeat(60) +
  '</p></article></body></html>';

/**
 * Extrae con una `og:description` propia, que es como se mete un `;` o un salto
 * de linea en la descripcion de un enlace sin tener que falsear el sanitizador.
 *
 * Solo sirve sobre un enlace **sin extraer**: `extractBookmark` sale sin hacer
 * nada cuando la fila ya esta `ready`, asi que volver a llamar sobre el enlace
 * del fixture no cambiaria ni una celda. Por eso el test que la usa crea el suyo.
 */
async function extraerConDescripcion(
  user: TestUser,
  bookmarkId: string,
  descripcion: string,
): Promise<void> {
  const html =
    '<!doctype html><html><head><title>La pagina</title>' +
    `<meta property="og:site_name" content="El sitio">` +
    `<meta property="og:description" content="${descripcion.replace(/"/g, '&quot;')}">` +
    '</head><body><article><h1>La pagina</h1><p>' +
    'palabra '.repeat(60) +
    '</p></article></body></html>';

  await extractBookmark(user.userId, bookmarkId, {
    traerHtml: async (url) => ({ ok: true, html, finalUrl: url, bytes: html.length }),
    contenidoDe: (contenido, url) => extraerContenido(contenido, url),
    metadataDe: (contenido, url) => sacarmetadata(contenido, url),
    youtubeDe: async () => null,
    imagenResuelveAPublica: async () => true,
    techoMs: 5_000,
  });
}

async function extraer(user: TestUser, bookmarkId: string): Promise<void> {
  await extractBookmark(user.userId, bookmarkId, {
    traerHtml: async (url) => ({ ok: true, html: PAGINA_EXTRAIDA, finalUrl: url, bytes: 1 }),
    contenidoDe: (html, url) => extraerContenido(html, url),
    metadataDe: (html, url) => sacarmetadata(html, url),
    youtubeDe: async () => null,
    imagenResuelveAPublica: async () => true,
    techoMs: 5_000,
  });
}

interface Coleccion {
  user: TestUser;
  workspaceId: string;
  folderId: string;
  collectionId: string;
  bookmarkId: string;
  deletedBookmarkId: string;
  /** Un enlace en la misma carpeta, pero en otra coleccion. */
  otraCollectionId: string;
  /** Un enlace sin coleccion: es de "Sin clasificar" y no viaja. */
  sueltaId: string;
}

/**
 * Una coleccion con dos enlaces, uno borrado, una hermana y un enlace suelto.
 *
 * Los tres ultimos son los que hacen que el CSV diga algo: una coleccion sin
 * enlaces sale igual de verde que una con ellos, y un `where(eq(...))` mal
 * puesto —por rango de ids, o sin `collectionId`— trae lo mismo en verde con
 * cualquier otro filtro mal puesto.
 */
async function coleccionConEnlaces(): Promise<Coleccion> {
  const user = await createVerifiedUser(api);
  const workspaceId = await espacioPropio(api, user, 'Casa');
  const folderId = await createFolder(user, workspaceId, 'Cocina');

  const collectionId = await createCollection(user, workspaceId, { folderId, name: 'Recetas' });
  const bookmarkId = await createBookmark(user, workspaceId, collectionId, { title: 'Tortilla' });
  // El sitio y la descripcion los pone la extraccion, que es el unico sitio que
  // los escribe —ver `extraer`— y el CSV los saca de ahi.
  await extraer(user, bookmarkId);
  const deletedBookmarkId = await createBookmark(user, workspaceId, collectionId, {
    title: 'En desuso',
  });
  await deleteEntity(user, 'bookmark', deletedBookmarkId);

  const otraCollectionId = await createCollection(user, workspaceId, { name: 'Postres' });
  await createBookmark(user, workspaceId, otraCollectionId, { title: 'Tarta' });

  const sueltaId = await createBookmark(user, workspaceId, null, { title: 'Sin clasificar' });

  return {
    user,
    workspaceId,
    folderId,
    collectionId,
    bookmarkId,
    deletedBookmarkId,
    otraCollectionId,
    sueltaId,
  };
}

/** Una plantilla creada por REST, que es como las crea la app. */
async function createTemplate(
  user: TestUser,
  args: { workspaceId: string | null; name: string; scope: 'personal' | 'workspace' },
): Promise<string> {
  const response = await api.post(
    '/notes/templates',
    {
      workspaceId: args.workspaceId,
      name: args.name,
      scope: args.scope,
      document: '<p>Plantilla</p>',
    },
    user.accessToken,
  );
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

/** Los bytes que se suben, iguales que en attachments.test.ts. */
const BYTES = 'falso binario';

/** La subida completa de un adjunto, para que el export tenga uno que omitir. */
async function subirAdjunto(user: TestUser, noteId: string): Promise<void> {
  const meta = {
    fileName: 'salsa.png',
    mimeType: 'image/png',
    sizeBytes: BYTES.length,
    width: 800,
    height: 600,
  };

  const ticket = await api.post(`/notes/${noteId}/attachments`, meta, user.accessToken);
  expect(ticket.status).toBe(201);

  await fetch(`${api.url}/attachments/upload/${ticket.body.data.storageKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': meta.mimeType },
    body: BYTES,
  });

  const confirm = await api.post(
    `/notes/${noteId}/attachments/confirm`,
    { ...meta, storageKey: ticket.body.data.storageKey },
    user.accessToken,
  );
  expect(confirm.status).toBe(201);
}

/**
 * Descarga cruda: estado, cabeceras, texto y cuerpo parseado si es JSON.
 *
 * El `body` se parsea desde el `text` ya leido: pedir `response.json()`
 * despues de `response.text()` es leer dos veces el mismo stream y siempre
 * daria `null`.
 */
async function bajar(api: TestServer, path: string, token?: string) {
  const response = await fetch(`${api.url}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  // Decodificado desde los bytes y no con `response.text()`: el text() del fetch
  // aplica el "UTF-8 decode" del estandar, que QUITA el BOM inicial, y justo el
  // BOM del CSV es lo que uno de estos tests comprueba. Desde aqui el texto sale
  // con el BOM puesto, igual que el fichero que se guarda en disco.
  const text = Buffer.from(await response.arrayBuffer()).toString('utf8');
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Un CSV no es JSON y aqui no pasa nada: quien lo llama usa `text`.
  }
  return {
    status: response.status,
    headers: response.headers,
    text,
    body: body as any,
  };
}

/**
 * Parte una linea de CSV sabiendo que las celdas van siempre citadas.
 * Suficiente para estos fixtures: ninguna celda lleva `;` ni saltos de linea.
 */
function celdas(linea: string): string[] {
  return linea.split(';').map((celda) => celda.replace(/^"|"$/g, ''));
}

interface Contenido {
  user: TestUser;
  workspaceId: string;
  folderId: string;
  listId: string;
  itemId: string;
  deletedItemId: string;
  deletedListId: string;
  deletedListItemId: string;
  moviesId: string;
  movieItemId: string;
  noteId: string;
}

/**
 * Una cuenta con contenido de todo tipo, incluida UNA CARPETA.
 *
 * La carpeta no es decorado: `folderSchema` extiende `nodeAccessSchema` y su
 * `role` no tiene default, asi que sin una carpeta en los fixtures un
 * `accountExportSchema.parse()` sobre un sobre sin carpetas pasaria igual y el
 * fallo del `role` olvidado saldria en produccion.
 */
async function cuentaConContenido(): Promise<Contenido> {
  const user = await createVerifiedUser(api);
  const workspaceId = await espacioPropio(api, user, 'Casa');
  const folderId = await createFolder(user, workspaceId, 'Cocina');

  const listId = await createList(user, workspaceId, { folderId, title: 'Compra' });
  const itemId = await createItem(user, listId, { title: 'Tomate' });
  const deletedItemId = await createItem(user, listId, { title: 'Pan' });
  await deleteEntity(user, 'list_item', deletedItemId);

  const deletedListId = await createList(user, workspaceId, { title: 'Borrada' });
  const deletedListItemId = await createItem(user, deletedListId, { title: 'Dentro de la borrada' });
  await deleteEntity(user, 'list', deletedListId);

  const moviesId = await createList(user, workspaceId, { kind: 'movies', title: 'Peliculas' });
  const movieItemId = await createItem(user, moviesId, {
    title: 'El bola',
    metadata: { year: 2000, claveRara: 'valor raro' },
  });

  const noteId = await createNote(user, workspaceId, 'Salsa');
  await subirAdjunto(user, noteId);

  return {
    user,
    workspaceId,
    folderId,
    listId,
    itemId,
    deletedItemId,
    deletedListId,
    deletedListItemId,
    moviesId,
    movieItemId,
    noteId,
  };
}

describe('GET /account/export', () => {
  it('devuelve un fichero con las cabeceras de descarga', async () => {
    const fix = await cuentaConContenido();

    const descarga = await bajar(api, '/account/export', fix.user.accessToken);

    expect(descarga.status).toBe(200);
    expect(descarga.headers.get('content-type')).toMatch(/^application\/json/);
    expect(descarga.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(descarga.headers.get('cache-control')).toBe('no-store');
    expect(Number(descarga.headers.get('content-length'))).toBe(
      Buffer.byteLength(descarga.text),
    );
  });

  it('el sobre pasa el parse del contrato, con la carpeta y su role', async () => {
    const fix = await cuentaConContenido();

    const descarga = await bajar(api, '/account/export', fix.user.accessToken);
    const sobre = accountExportSchema.parse(JSON.parse(descarga.text));

    // La puerta del role en las CUATRO entidades: carpetas, listas, items y
    // notas extienden nodeAccessSchema y el role es obligatorio en las cuatro.
    const carpeta = sobre.folders.find((folder) => folder.id === fix.folderId);
    expect(carpeta?.role).toBe('owner');
    expect(carpeta?.shared).toBe(false);
    expect(sobre.lists.find((list) => list.id === fix.listId)?.role).toBe('owner');
    expect(sobre.items.find((item) => item.id === fix.itemId)?.role).toBe('owner');
    expect(sobre.notes.find((note) => note.id === fix.noteId)?.role).toBe('owner');
    expect(sobre.workspaces.find((space) => space.id === fix.workspaceId)?.role).toBe('owner');
  });

  it('los counts cuadran con los arrays y los items estan', async () => {
    const fix = await cuentaConContenido();

    const descarga = await bajar(api, '/account/export', fix.user.accessToken);
    const sobre = accountExportSchema.parse(JSON.parse(descarga.text));

    expect(sobre.counts.workspaces).toBe(sobre.workspaces.length);
    expect(sobre.counts.folders).toBe(sobre.folders.length);
    expect(sobre.counts.lists).toBe(sobre.lists.length);
    expect(sobre.counts.items).toBe(sobre.items.length);
    expect(sobre.counts.notes).toBe(sobre.notes.length);
    expect(sobre.counts.attachments).toBe(sobre.attachments.length);
    expect(sobre.counts.templates).toBe(sobre.templates.length);

    const ids = sobre.items.map((item) => item.id);
    expect(ids).toContain(fix.itemId);
    expect(ids).toContain(fix.movieItemId);
  });

  it('un item borrado sigue en el JSON con su deletedAt', async () => {
    const fix = await cuentaConContenido();

    const descarga = await bajar(api, '/account/export', fix.user.accessToken);
    const sobre = accountExportSchema.parse(JSON.parse(descarga.text));

    const borrado = sobre.items.find((item) => item.id === fix.deletedItemId);
    expect(borrado).toBeDefined();
    expect(borrado?.deletedAt).not.toBeNull();
  });

  it('una lista borrada sigue en el JSON con sus items', async () => {
    const fix = await cuentaConContenido();

    const descarga = await bajar(api, '/account/export', fix.user.accessToken);
    const sobre = accountExportSchema.parse(JSON.parse(descarga.text));

    // La lista desaparece de GET /lists y aun asi tiene que estar aqui: es el
    // caso donde un isNull(deletedAt) copiado del servicio de lectura se nota.
    const lista = sobre.lists.find((list) => list.id === fix.deletedListId);
    expect(lista).toBeDefined();
    expect(lista?.deletedAt).not.toBeNull();

    const item = sobre.items.find((row) => row.id === fix.deletedListItemId);
    expect(item).toBeDefined();
    expect(item?.listId).toBe(fix.deletedListId);
  });

  it('un adjunto no lleva storageKey', async () => {
    const fix = await cuentaConContenido();

    const descarga = await bajar(api, '/account/export', fix.user.accessToken);
    const sobre = accountExportSchema.parse(JSON.parse(descarga.text));

    // Sin esta comprobacion el not.toContain de abajo pasaria con cero adjuntos.
    expect(sobre.counts.attachments).toBeGreaterThanOrEqual(1);
    expect(sobre.attachments[0]?.fileName).toBe('salsa.png');
    expect(descarga.text).not.toContain('storageKey');
  });

  it('metadata con una clave desconocida sale intacta', async () => {
    const fix = await cuentaConContenido();

    const descarga = await bajar(api, '/account/export', fix.user.accessToken);
    const sobre = accountExportSchema.parse(JSON.parse(descarga.text));

    const item = sobre.items.find((row) => row.id === fix.movieItemId);
    expect(item?.metadata).toEqual({ year: 2000, claveRara: 'valor raro' });
  });

  it('una cuenta recien creada sale vacia pero completa', async () => {
    const user = await createVerifiedUser(api);

    const descarga = await bajar(api, '/account/export', user.accessToken);
    const sobre = accountExportSchema.parse(JSON.parse(descarga.text));

    expect(descarga.status).toBe(200);
    expect(sobre.counts).toEqual({
      workspaces: 0,
      folders: 0,
      lists: 0,
      items: 0,
      notes: 0,
      attachments: 0,
      templates: 0,
    });
    expect(sobre.workspaces).toEqual([]);
    expect(sobre.folders).toEqual([]);
    expect(sobre.lists).toEqual([]);
    expect(sobre.items).toEqual([]);
    expect(sobre.notes).toEqual([]);
    expect(sobre.attachments).toEqual([]);
    expect(sobre.templates).toEqual([]);
  });

  it('una plantilla personal de la persona sale en el sobre', async () => {
    const fix = await cuentaConContenido();
    // Las personales tienen workspaceId null: no cuelgan de ningun espacio y
    // un export que solo mirara ids las perderia en silencio.
    const mia = await createTemplate(fix.user, {
      workspaceId: null,
      name: 'Mia',
      scope: 'personal',
    });

    const descarga = await bajar(api, '/account/export', fix.user.accessToken);
    const sobre = accountExportSchema.parse(JSON.parse(descarga.text));

    const plantilla = sobre.templates.find((template) => template.id === mia);
    expect(plantilla).toBeDefined();
    expect(plantilla?.workspaceId).toBeNull();
    expect(plantilla?.scope).toBe('personal');
  });

  it('una plantilla personal de otra persona no sale en el sobre', async () => {
    const fix = await cuentaConContenido();
    const otra = await createVerifiedUser(api);
    const ajena = await createTemplate(otra, {
      workspaceId: null,
      name: 'Ajena',
      scope: 'personal',
    });

    const descarga = await bajar(api, '/account/export', fix.user.accessToken);
    const sobre = accountExportSchema.parse(JSON.parse(descarga.text));

    expect(sobre.templates.map((template) => template.id)).not.toContain(ajena);
  });

  it('una plantilla de su espacio sale en el sobre', async () => {
    const fix = await cuentaConContenido();
    const delEspacio = await createTemplate(fix.user, {
      workspaceId: fix.workspaceId,
      name: 'Del espacio',
      scope: 'workspace',
    });

    const descarga = await bajar(api, '/account/export', fix.user.accessToken);
    const sobre = accountExportSchema.parse(JSON.parse(descarga.text));

    const plantilla = sobre.templates.find((template) => template.id === delEspacio);
    expect(plantilla).toBeDefined();
    expect(plantilla?.workspaceId).toBe(fix.workspaceId);
  });

  it('lo de otra persona no sale ni una vez en el JSON', async () => {
    const fix = await cuentaConContenido();

    // Que lo de otra persona NO aparezca es la mitad del contrato de este
    // endpoint. Este test existe para que un refactor futuro no pueda cambiar
    // `visibleWorkspaceIds` ni el `inArray(workspaceId, workspaceIds)` de
    // carpetas, listas, items o notas por un `isNotNull(...)` o un
    // `where(id, 'is not', null)` — el fallo se veria porque la suite entera
    // seguiria en verde al no haber ningun otro caso negativo que comprobara
    // esos cuatro `inArray`. El unico caso negativo que habia era la plantilla
    // personal, y esa rama es el `createdBy`, no el `workspaceId`.
    const otra = await createVerifiedUser(api);
    const suEspacioId = await espacioPropio(api, otra, 'Espacio Ajeno');
    const suCarpetaId = await createFolder(otra, suEspacioId, 'Carpeta Ajena');
    const suListaId = await createList(otra, suEspacioId, {
      folderId: suCarpetaId,
      title: 'Lista Ajena',
    });
    const suItemId = await createItem(otra, suListaId, { title: 'Item Ajeno' });
    const suNotaId = await createNote(otra, suEspacioId, 'Nota Ajena');

    const descarga = await bajar(api, '/account/export', fix.user.accessToken);
    const sobre = accountExportSchema.parse(JSON.parse(descarga.text));

    // El texto crudo y no el objeto parseado: los ids son uuid, no hay forma de
    // que un `toContain` sobre arrays mas-selectivos los dejara pasar, pero
    // sobre el texto tambien se ve un id colado en un sitio raro — un `createdBy`,
    // un `document` de una nota compartida — y eso tambien es una fuga.
    expect(descarga.text).not.toContain(suEspacioId);
    expect(descarga.text).not.toContain(suCarpetaId);
    expect(descarga.text).not.toContain(suListaId);
    expect(descarga.text).not.toContain(suItemId);
    expect(descarga.text).not.toContain(suNotaId);

    // Y el sobre sigue siendo el de la primera persona y solo el suyo: unos
    // counts inflados serian la otra forma de que un filtro desapareciera sin
    // que ningun id ajeno apareciera. Los numeros son los del fixture de
    // `cuentaConContenido` —un espacio, una carpeta, tres listas (una borrada),
    // cuatro items (uno borrado y otro en la lista borrada), una nota y un
    // adjunto— y ningun otro.
    expect(sobre.counts).toEqual({
      workspaces: 1,
      folders: 1,
      lists: 3,
      items: 4,
      notes: 1,
      attachments: 1,
      templates: 0,
    });
    expect(sobre.workspaces.map((w) => w.id)).toEqual([fix.workspaceId]);
    expect(sobre.folders.map((f) => f.id)).toEqual([fix.folderId]);
    expect(sobre.notes.map((n) => n.id)).toEqual([fix.noteId]);
    expect(sobre.items.map((i) => i.id)).toContain(fix.itemId);
  });

  it('?format=csv da 422 validation_failed, no un error inventado', async () => {
    const fix = await cuentaConContenido();

    const descarga = await bajar(api, '/account/export?format=csv', fix.user.accessToken);

    // accountExportQuerySchema es z.literal('json'): el parse de la query es el
    // que decide, y en esta API no existe el codigo invalid_format.
    expect(descarga.status).toBe(422);
    expect(descarga.body.error.code).toBe('validation_failed');
  });

  it('sin token da 401', async () => {
    const descarga = await bajar(api, '/account/export');

    expect(descarga.status).toBe(401);
  });
});

describe('GET /lists/:id/export', () => {
  it('en JSON da el sobre del contrato con su contexto', async () => {
    const fix = await cuentaConContenido();

    const descarga = await bajar(api, `/lists/${fix.listId}/export`, fix.user.accessToken);
    const sobre = listExportSchema.parse(JSON.parse(descarga.text));

    expect(descarga.status).toBe(200);
    expect(descarga.headers.get('content-type')).toMatch(/^application\/json/);
    expect(descarga.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(descarga.headers.get('cache-control')).toBe('no-store');
    expect(sobre.list.id).toBe(fix.listId);
    expect(sobre.list.role).toBe('owner');
    expect(sobre.workspace.id).toBe(fix.workspaceId);
    expect(sobre.folder?.id).toBe(fix.folderId);
    expect(sobre.counts.items).toBe(sobre.items.length);
    // Y el `itemCount` de la lista cuenta **este** array, no los items vivos: los
    // dos numeros dicen lo mismo, y por eso los dos son del mismo fichero.
    expect(sobre.list.itemCount).toBe(sobre.items.length);
  });

  it('la cuenta del sobre de una lista es id y email, sin displayName', async () => {
    // Un displayName que no aparece en ningun otro sitio del JSON, para que el
    // `not.toContain` no pueda pasar por casualidad.
    const user = await createVerifiedUser(api, { displayName: 'Nombre Que No Viaja' });
    const workspaceId = await espacioPropio(api, user, 'Casa');
    const listId = await createList(user, workspaceId, { title: 'Compra' });

    const descarga = await bajar(api, `/lists/${listId}/export`, user.accessToken);

    // El texto crudo y NO el objeto parseado: `listExportSchema` es un
    // `z.object`, y un z.object quita las claves que no conoce en vez de
    // fallar. Un `displayName` de mas pasaria por el parse sin quejarse, que es
    // justo lo que hacia falta que este test notase. El parametro anotado del
    // builder es `{ id, email }`, asi que TypeScript estrecha el tipo y no el
    // valor: solo mirar el sobre ya construido lo detecta.
    expect(descarga.text).not.toContain('displayName');
    expect(descarga.text).not.toContain('Nombre Que No Viaja');

    const cuenta = (JSON.parse(descarga.text) as { account: Record<string, unknown> }).account;
    expect(Object.keys(cuenta).sort()).toEqual(['email', 'id']);
  });

  it('?format=csv da un CSV con BOM y la cabecera del contrato', async () => {
    const fix = await cuentaConContenido();

    const descarga = await bajar(
      api,
      `/lists/${fix.moviesId}/export?format=csv`,
      fix.user.accessToken,
    );

    expect(descarga.status).toBe(200);
    expect(descarga.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(descarga.text.startsWith('\uFEFF')).toBe(true);
    expect(descarga.text.startsWith(`\uFEFF${LIST_EXPORT_CSV_COLUMNS.join(';')}\r\n`)).toBe(true);
  });

  it('el CSV de peliculas trae el year del metadata', async () => {
    const fix = await cuentaConContenido();

    const descarga = await bajar(
      api,
      `/lists/${fix.moviesId}/export?format=csv`,
      fix.user.accessToken,
    );

    const lineas = descarga.text.replace(/^\uFEFF/, '').split('\r\n');
    const fila = lineas.find((linea) => linea.includes('El bola'));
    expect(fila).toBeDefined();
    // year es la columna 9 (indice 8) de LIST_EXPORT_CSV_COLUMNS.
    expect(celdas(fila as string)[8]).toBe('2000');
  });

  it('el CSV de un tablero dice el titulo de la columna, no su id', async () => {
    // This test is here because the builder one cannot see any of the way the
    // columns travel: a `List` full of states only exists because `toList` read
    // them out of Postgres, and dropping that one line would leave every board
    // CSV with an empty cell in every row and no test anywhere saying so.
    const user = await createVerifiedUser(api);
    const workspaceId = await espacioPropio(api, user, 'Casa');
    const listId = await createList(user, workspaceId, {
      kind: 'board',
      states: [
        { id: 's1', title: 'Por hacer', color: 'neutral' },
        { id: 's2', title: 'Hecho', color: 'green' },
      ],
    });
    await createItem(user, listId, { title: 'Tarea', stateId: 's2' });

    const descarga = await bajar(api, `/lists/${listId}/export?format=csv`, user.accessToken);

    expect(descarga.status).toBe(200);
    const lineas = descarga.text.replace(/^\uFEFF/, '').split('\r\n');
    expect(lineas[0]).toBe(BOARD_EXPORT_CSV_COLUMNS.join(';'));
    expect(descarga.text).not.toContain('completado');

    const fila = lineas.find((linea) => linea.includes('Tarea'));
    expect(fila).toBeDefined();
    // estado es la columna 4 (indice 3), la que ocupaba completado.
    expect(celdas(fila as string)[3]).toBe('Hecho');
    expect(descarga.text).not.toContain('"s2"');
  });

  it('el CSV se llama por el titulo de la lista, no por su id', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await espacioPropio(api, user, 'Casa');
    const listId = await createList(user, workspaceId, {
      kind: 'movies',
      title: 'Películas para ver',
    });

    const descarga = await bajar(api, `/lists/${listId}/export?format=csv`, user.accessToken);
    const disposition = descarga.headers.get('content-disposition') ?? '';
    const ascii = /filename="([^"]*)"/.exec(disposition)?.[1] ?? '';

    // El nombre y la hoja salen del mismo servicio, que es el unico que ha
    // cargado la lista: el slug sale del titulo y el uuid no aparece. Es el
    // nombre que el telefono calcula con el mismo exportFilename.
    expect(ascii).toMatch(/^orbit-hub-peliculas-para-ver-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(ascii).not.toContain(listId);
  });

  it('otro usuario contra una lista que no es suya recibe 404, no 403', async () => {
    const fix = await cuentaConContenido();
    const extrano = await createVerifiedUser(api);

    const descarga = await bajar(api, `/lists/${fix.listId}/export`, extrano.accessToken);

    // Invisible e inexistente son la misma respuesta a proposito.
    expect(descarga.status).toBe(404);
    expect(descarga.body.error.code).toBe('not_found');
  });

  it('una lista que no existe da 404', async () => {
    const fix = await cuentaConContenido();

    const descarga = await bajar(api, `/lists/${randomUUID()}/export`, fix.user.accessToken);

    expect(descarga.status).toBe(404);
    expect(descarga.body.error.code).toBe('not_found');
  });

  it('sin token da 401', async () => {
    const fix = await cuentaConContenido();

    const descarga = await bajar(api, `/lists/${fix.listId}/export`);

    expect(descarga.status).toBe(401);
  });

  it('el nombre del fichero sale sin acentos en las dos formas del Content-Disposition', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await espacioPropio(api, user, 'Casa');
    const listId = await createList(user, workspaceId, { kind: 'movies', title: 'Películas' });

    const descarga = await bajar(api, `/lists/${listId}/export`, user.accessToken);
    const disposition = descarga.headers.get('content-disposition') ?? '';

    // El nombre lo hace exportFilename, que limpia el acento del titulo, y las
    // dos formas llevan el mismo nombre: la ASCII para los clientes que no leen
    // filename* y la RFC 5987 percent-encoded para los que si.
    const ascii = /filename="([^"]*)"/.exec(disposition)?.[1] ?? '';
    const starred = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1] ?? '';

    expect(ascii).toMatch(/^orbit-hub-peliculas-\d{4}-\d{2}-\d{2}\.json$/);
    expect(ascii).not.toContain('í');
    expect(starred).not.toBe('');
    expect(decodeURIComponent(starred)).toBe(ascii);
  });
});

/**
 * La coleccion como fichero, y el mismo trato que una lista.
 *
 * Los bloques de arriba no se repiten aqui: `bajar` ya lee los bytes sin
 * quitar el BOM —que es justo lo que uno de estos tests comprueba— y `celdas`
 * parte una linea sabia que las celdas van citadas.
 */
describe('GET /collections/:id/export', () => {
  it('en JSON da el sobre del contrato con su contexto', async () => {
    const fix = await coleccionConEnlaces();

    const descarga = await bajar(api, `/collections/${fix.collectionId}/export`, fix.user.accessToken);
    const sobre = collectionExportSchema.parse(JSON.parse(descarga.text));

    expect(descarga.status).toBe(200);
    expect(descarga.headers.get('content-type')).toMatch(/^application\/json/);
    expect(descarga.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(descarga.headers.get('cache-control')).toBe('no-store');
    expect(sobre.collection.id).toBe(fix.collectionId);
    expect(sobre.collection.role).toBe('owner');
    expect(sobre.workspace.id).toBe(fix.workspaceId);
    expect(sobre.folder?.id).toBe(fix.folderId);
    expect(sobre.counts.bookmarks).toBe(sobre.bookmarks.length);
  });

  it('la cuenta del sobre de una coleccion es id y email, sin displayName', async () => {
    // El mismo motivo que en el sobre de una lista, y el mismo modo de mirar: el
    // **texto crudo** y no el objeto parseado, porque `collectionExportSchema` es un
    // `z.object` y uno quita las claves que no conoce en vez de fallar. Un
    // `displayName` de mas pasaria el parse sin quejarse.
    const user = await createVerifiedUser(api, { displayName: 'Nombre Que No Viaja' });
    const workspaceId = await espacioPropio(api, user, 'Casa');
    const collectionId = await createCollection(user, workspaceId, { name: 'Recetas' });

    const descarga = await bajar(api, `/collections/${collectionId}/export`, user.accessToken);

    expect(descarga.text).not.toContain('displayName');
    expect(descarga.text).not.toContain('Nombre Que No Viaja');

    const cuenta = (JSON.parse(descarga.text) as { account: Record<string, unknown> }).account;
    expect(Object.keys(cuenta).sort()).toEqual(['email', 'id']);
  });

  it('trae sus enlaces y solo los suyos, con el borrado incluido', async () => {
    const fix = await coleccionConEnlaces();

    const descarga = await bajar(api, `/collections/${fix.collectionId}/export`, fix.user.accessToken);
    const sobre = collectionExportSchema.parse(JSON.parse(descarga.text));

    const ids = sobre.bookmarks.map((bookmark) => bookmark.id);
    expect(ids).toContain(fix.bookmarkId);
    // El borrado tambien: es el caso donde el fichero hace falta, y sin su
    // `deletedAt` seria indistinguible de uno que nunca existio.
    const borrado = sobre.bookmarks.find((bookmark) => bookmark.id === fix.deletedBookmarkId);
    expect(borrado).toBeDefined();
    expect(borrado?.deletedAt).not.toBeNull();

    // Y los de otra coleccion, o sin coleccion, no entran. Sin esta mitad, un
    // `inArray(bookmarks.collectionId, ...)` equivocado pasaria en verde con una
    // coleccion de un solo enlace.
    expect(ids).not.toContain(fix.sueltaId);
    expect(descarga.text).not.toContain(fix.otraCollectionId);
  });

  it('el enlace del JSON lleva el articulo entero y el role del espacio', async () => {
    const fix = await coleccionConEnlaces();

    const descarga = await bajar(api, `/collections/${fix.collectionId}/export`, fix.user.accessToken);
    const sobre = collectionExportSchema.parse(JSON.parse(descarga.text));

    const enlace = sobre.bookmarks.find((bookmark) => bookmark.id === fix.bookmarkId);
    // El JSON es la copia completa: el articulo viaja entero, porque es lo que la
    // persona se lleva cuando exporta. Sin el, el enlace exportado seria un
    // enlace sin contenido, que es lo mismo que no haberlo exportado.
    expect(enlace?.document).not.toBe('');
    expect(enlace?.plainText).toContain('palabra');
    expect(enlace?.extractionState).toBe('ready');
    expect(enlace?.role).toBe('owner');
    expect(enlace?.shared).toBe(false);
    // Y el `bookmarkCount` de la coleccion cuenta **este** array, no los vivos: un
    // count que no cuadra con el array de al lado es un count que miente.
    expect(sobre.collection.bookmarkCount).toBe(sobre.bookmarks.length);
    expect(sobre.counts.bookmarks).toBe(sobre.bookmarks.length);
  });

  it('?format=csv da un CSV con BOM y la cabecera del contrato', async () => {
    const fix = await coleccionConEnlaces();

    const descarga = await bajar(
      api,
      `/collections/${fix.collectionId}/export?format=csv`,
      fix.user.accessToken,
    );

    expect(descarga.status).toBe(200);
    expect(descarga.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(descarga.text.startsWith('\uFEFF')).toBe(true);
    expect(descarga.text.startsWith(`\uFEFF${BOOKMARK_EXPORT_CSV_COLUMNS.join(';')}\r\n`)).toBe(
      true,
    );
  });

  it('el CSV trae la fila con sus datos y no lo de las otras colecciones', async () => {
    const fix = await coleccionConEnlaces();

    const descarga = await bajar(
      api,
      `/collections/${fix.collectionId}/export?format=csv`,
      fix.user.accessToken,
    );
    const lineas = descarga.text.replace(/^\uFEFF/, '').split('\r\n');
    const fila = lineas.find((linea) => linea.includes('Tortilla'));

    expect(fila).toBeDefined();
    const columnas = celdas(fila as string);
    expect(columnas).toHaveLength(BOOKMARK_EXPORT_CSV_COLUMNS.length);
    expect(columnas[1]).toBe('https://example.com/receta');
    // El sitio y la descripcion los escribio la extraccion, no el fixture: asi lo
    // que se comprueba es una fila que la base de datos puede tener de verdad.
    expect(columnas[3]).toBe('El sitio');
    expect(columnas[4]).toBe('La descripcion del sitio');
    // "Tarta" es de la otra coleccion y sin clasificar no es de ninguna: si el
    // filtro se cayera, aqui estarian las dos.
    expect(descarga.text).not.toContain('Tarta');
    expect(descarga.text).not.toContain('Sin clasificar');
  });

  it('el CSV no lleva el articulo, y el motivo esta en el contrato', async () => {
    const fix = await coleccionConEnlaces();

    const descarga = await bajar(
      api,
      `/collections/${fix.collectionId}/export?format=csv`,
      fix.user.accessToken,
    );

    // Es la decision que define este formato: en una celda de una hoja de
    // calculo el HTML completo no se lee. Quien lo quiera lo pide en JSON, que
    // si lo lleva —el test de arriba lo comprueba—. Y la columna no existe ni
    // para cuando alguien la agregue por error.
    expect(BOOKMARK_EXPORT_CSV_COLUMNS).not.toContain('document');
    expect(BOOKMARK_EXPORT_CSV_COLUMNS).not.toContain('plain_text');
    expect(descarga.text).not.toContain('palabra ');
  });

  it('el CSV cita siempre, y una descripcion con `;` no parte la fila', async () => {
    // Su propia coleccion y su propio enlace, y no el del fixture: ese ya esta
    // `ready` y `extractBookmark` no vuelve a extraer un enlace que lo esta
    // (`extract-service.ts`), asi que la descripcion nueva no llegaria a existir.
    const user = await createVerifiedUser(api);
    const workspaceId = await espacioPropio(api, user, 'Casa');
    const collectionId = await createCollection(user, workspaceId, { name: 'Recetas' });
    const bookmarkId = await createBookmark(user, workspaceId, collectionId, { title: 'Tortilla' });
    await extraerConDescripcion(user, bookmarkId, 'uno; dos y tres');

    const descarga = await bajar(
      api,
      `/collections/${collectionId}/export?format=csv`,
      user.accessToken,
    );

    const sobre = collectionExportSchema.parse(
      JSON.parse((await bajar(api, `/collections/${collectionId}/export`, user.accessToken)).text),
    );
    // El `\r\n` final deja una ultima entrada vacia, que no es una fila: se quita
    // para que el numero de lineas sea el de filas de verdad.
    const lineas = descarga.text
      .replace(/^\uFEFF/, '')
      .split('\r\n')
      .filter((linea) => linea !== '');
    // Sin citar, el `;` de la descripcion partia la fila en dos y el numero de
    // filas no cuadraba con el `counts.bookmarks` del mismo fichero en JSON. Ese
    // count es la mitad de la comprobacion: sin el, dos filas por enlace y el
    // test seguiria verde.
    expect(lineas).toHaveLength(sobre.counts.bookmarks + 1);

    // Y la celda sale **citada**, que es lo que un parser que respeta comillas
    // lee como un solo campo. Se mira la linea tal cual y no con `celdas()`: ese
    // helper parte por `;` sin mirar comillas —su propio comentario lo dice— y
    // con un `;` dentro de la celda daria dos campos que no existen.
    const fila = lineas.find((linea) => linea.includes('Tortilla'));
    expect(fila).toContain('"uno; dos y tres"');
  });

  it('el nombre del fichero sale del nombre de la coleccion, no de su id', async () => {
    const fix = await coleccionConEnlaces();

    const descarga = await bajar(
      api,
      `/collections/${fix.collectionId}/export?format=csv`,
      fix.user.accessToken,
    );
    const disposition = descarga.headers.get('content-disposition') ?? '';
    const ascii = /filename="([^"]*)"/.exec(disposition)?.[1] ?? '';

    // `collection.name` y no un `title` que no existe: el nombre que ve la
    // persona en el menu es este, y el que sale del `Content-Disposition` tiene
    // que ser el mismo que el que el telefono calcula con el mismo contrato.
    expect(ascii).toMatch(/^orbit-hub-recetas-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(ascii).not.toContain(fix.collectionId);
  });

  it('sin `?format` sale el JSON, y no un error de formato', async () => {
    const fix = await coleccionConEnlaces();

    const descarga = await bajar(api, `/collections/${fix.collectionId}/export`, fix.user.accessToken);

    // `collectionExportQuerySchema` trae `default('json')`, igual que el de una
    // lista: la hoja manda siempre el formato, pero un enlace escrito a mano que
    // no lo mande tiene que recibir el fichero y no un 422.
    expect(descarga.status).toBe(200);
    expect(descarga.headers.get('content-type')).toMatch(/^application\/json/);
  });

  it('?format=xml da 422 validation_failed, no un error inventado', async () => {
    const fix = await coleccionConEnlaces();

    const descarga = await bajar(
      api,
      `/collections/${fix.collectionId}/export?format=xml`,
      fix.user.accessToken,
    );

    expect(descarga.status).toBe(422);
    expect(descarga.body.error.code).toBe('validation_failed');
  });

  it('otro usuario contra una coleccion que no es suya recibe 404, no 403', async () => {
    const fix = await coleccionConEnlaces();
    const extrano = await createVerifiedUser(api);

    const descarga = await bajar(
      api,
      `/collections/${fix.collectionId}/export`,
      extrano.accessToken,
    );

    // Invisible e inexistente son la misma respuesta a proposito.
    expect(descarga.status).toBe(404);
    expect(descarga.body.error.code).toBe('not_found');
  });

  it('una coleccion que no existe da 404', async () => {
    const fix = await coleccionConEnlaces();

    const descarga = await bajar(
      api,
      `/collections/${randomUUID()}/export`,
      fix.user.accessToken,
    );

    expect(descarga.status).toBe(404);
    expect(descarga.body.error.code).toBe('not_found');
  });

  it('sin token da 401', async () => {
    const fix = await coleccionConEnlaces();

    const descarga = await bajar(api, `/collections/${fix.collectionId}/export`);

    expect(descarga.status).toBe(401);
  });
});
