import { describe, expect, it } from 'vitest';

import {
  BOARD_EXPORT_CSV_COLUMNS,
  BOOKMARK_EXPORT_CSV_COLUMNS,
  EXPORT_FORMAT_VERSION,
  LIST_EXPORT_CSV_COLUMNS,
  exportCsvColumnsFor,
  type AccountExport,
  type Bookmark,
  type Collection,
  type ExportedAttachment,
  type Folder,
  type List,
  type ListItem,
  type Note,
  type NoteTemplate,
  type Workspace,
} from '@orbit-hub/contracts';

import {
  accountExportEnvelope,
  bookmarksToCsv,
  collectionExportEnvelope,
  csvStateCell,
  itemsToCsv,
  listExportEnvelope,
  metadataCell,
  type AccountExportRows,
} from '../src/modules/export/export-builders.js';

/**
 * Parser CSV minimo que respeta las comillas.
 *
 * Necesario porque los tests cuentan registros, no bytes: un campo citado
 * puede contener `;` o `\r\n` sin que eso cree una fila nueva. El parser
 * devuelve los campos ya sin comillas exteriores y con `""` desescapado.
 */
function parseCsvRecords(csv: string): string[][] {
  const records: string[][] = [];
  let currentRecord: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = csv.startsWith('\uFEFF') ? 1 : 0;

  function endField(): void {
    currentRecord.push(field);
    field = '';
  }

  function endRecord(): void {
    records.push(currentRecord);
    currentRecord = [];
  }

  while (i < csv.length) {
    const char = csv[i];
    const next = csv[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 2;
      } else {
        inQuotes = !inQuotes;
        i += 1;
      }
      continue;
    }

    if (!inQuotes && char === ';') {
      endField();
      i += 1;
      continue;
    }

    if (!inQuotes && (char === '\r' || char === '\n')) {
      endField();
      endRecord();
      i += char === '\r' && next === '\n' ? 2 : 1;
      continue;
    }

    field += char;
    i += 1;
  }

  endField();
  endRecord();

  // El fichero termina en CRLF, asi que el parser crea un ultimo registro vacio.
  const lastRecord = records[records.length - 1];
  if (lastRecord && lastRecord.length === 1 && lastRecord[0] === '') {
    records.pop();
  }

  return records;
}

function item(over: Partial<ListItem> = {}): ListItem {
  return {
    id: 'i1',
    listId: 'l1',
    title: 'Pan',
    position: 0,
    completed: false,
    stateId: null,
    priority: 'none',
    icon: null,
    tags: [],
    externalId: null,
    metadata: null,
    annotation: null,
    role: 'owner',
    shared: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}

function list(over: Partial<List> = {}): List {
  return {
    id: 'l1',
    workspaceId: 'w1',
    folderId: null,
    kind: 'tasks',
    title: 'Compras',
    description: null,
    icon: null,
    tags: [],
    tagColors: {},
    states: [],
    position: 0,
    itemCount: 0,
    orderMode: 'manual',
    role: 'owner',
    shared: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}

/**
 * A board with two columns, which is the smallest one where a task can be in
 * something other than the first — the case where writing a state's id instead
 * of its title would be visible.
 */
function board(over: Partial<List> = {}): List {
  return list({
    kind: 'board',
    states: [
      { id: 's1', title: 'Por hacer', color: 'neutral' },
      { id: 's2', title: 'Hecho', color: 'green' },
    ],
    ...over,
  });
}

function workspace(over: Partial<Workspace> = {}): Workspace {
  return {
    id: 'w1',
    name: 'Personal',
    description: null,
    icon: null,
    color: 'slate',
    role: 'owner',
    memberCount: 1,
    shared: false,
    wash: 'diagonal',
    colorTo: null,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}

function folder(over: Partial<Folder> = {}): Folder {
  return {
    id: 'f1',
    workspaceId: 'w1',
    parentId: null,
    name: 'Carpeta',
    icon: null,
    position: 0,
    role: 'owner',
    shared: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    workspaceId: 'w1',
    folderId: null,
    title: 'Nota',
    document: '<p>texto</p>',
    plainText: 'texto',
    tags: [],
    icon: null,
    attachmentCount: 0,
    position: 0,
    role: 'owner',
    shared: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}

function attachment(over: Partial<ExportedAttachment> = {}): ExportedAttachment {
  return {
    id: 'at1',
    noteId: 'n1',
    fileName: 'foto.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1000,
    width: null,
    height: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function template(over: Partial<NoteTemplate> = {}): NoteTemplate {
  return {
    id: 't1',
    workspaceId: null,
    name: 'Plantilla',
    description: '',
    icon: 'document-text-outline',
    scope: 'personal',
    document: '<p>plantilla</p>',
    plainText: 'plantilla',
    builtInKey: null,
    createdBy: null,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}

function collection(over: Partial<Collection> = {}): Collection {
  return {
    id: 'c1',
    workspaceId: 'w1',
    folderId: null,
    name: 'Recetas',
    description: null,
    emoji: null,
    position: 0,
    bookmarkCount: 0,
    role: 'owner',
    shared: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}

/**
 * Un enlace, y **con el articulo dentro**: el CSV lo tira y el JSON lo lleva, y
 * un fixture con `document: ''` no distinguiria los dos formatos —el CSV pasaria
 * el `not.toContain` con una fila que no tenia nada que tirar—.
 */
function bookmark(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'b1',
    workspaceId: 'w1',
    folderId: null,
    collectionId: 'c1',
    url: 'https://example.com/receta',
    title: 'Tortilla',
    siteName: 'El sitio',
    description: 'La descripcion',
    imageUrl: null,
    document: '<p>palabra</p>',
    plainText: 'palabra',
    extractionState: 'ready',
    extractionError: null,
    tags: [],
    position: 0,
    role: 'owner',
    shared: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}

function accountRows(over: Partial<AccountExportRows> = {}): AccountExportRows {
  return {
    account: { id: 'a1', email: 'a@example.com', displayName: 'A' },
    exportedAt: '2026-01-01T00:00:00.000Z',
    workspaces: [],
    folders: [],
    lists: [],
    items: [],
    notes: [],
    attachments: [],
    templates: [],
    ...over,
  };
}

describe('accountExportEnvelope', () => {
  it('cuenta dos items y los siete counts cuadran con las longitudes', () => {
    const rows = accountRows({
      workspaces: [workspace()],
      folders: [folder(), folder({ id: 'f2' })],
      lists: [list()],
      items: [item(), item({ id: 'i2' })],
      notes: [note(), note({ id: 'n2' }), note({ id: 'n3' })],
      attachments: [attachment()],
      templates: [template(), template({ id: 't2' })],
    });

    const envelope = accountExportEnvelope(rows);

    expect(envelope.counts).toEqual({
      workspaces: 1,
      folders: 2,
      lists: 1,
      items: 2,
      notes: 3,
      attachments: 1,
      templates: 2,
    });
  });

  it('un item borrado sobrevive al sobre', () => {
    const rows = accountRows({
      items: [item({ deletedAt: '2026-03-01T00:00:00.000Z' })],
    });

    const envelope = accountExportEnvelope(rows);

    expect(envelope.items[0]!.deletedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('metadata con objeto anidado sale exacto, sin aplanar', () => {
    const rows = accountRows({
      items: [item({ metadata: { imageUrl: 'x.jpg', AlgoRaro: { anidado: true } } })],
    });

    const envelope = accountExportEnvelope(rows);

    expect(envelope.items[0]!.metadata).toEqual({
      imageUrl: 'x.jpg',
      AlgoRaro: { anidado: true },
    });
  });

  it('una cuenta vacia tiene counts a cero y arrays vacios', () => {
    const envelope = accountExportEnvelope(accountRows());

    expect(envelope.counts).toEqual({
      workspaces: 0,
      folders: 0,
      lists: 0,
      items: 0,
      notes: 0,
      attachments: 0,
      templates: 0,
    });
    expect(envelope.workspaces).toEqual([]);
    expect(envelope.folders).toEqual([]);
    expect(envelope.lists).toEqual([]);
    expect(envelope.items).toEqual([]);
    expect(envelope.notes).toEqual([]);
    expect(envelope.attachments).toEqual([]);
    expect(envelope.templates).toEqual([]);
  });

  it('sobrevive a una serializacion de ida y vuelta', () => {
    const rows = accountRows({
      workspaces: [workspace()],
      folders: [folder()],
      lists: [list()],
      items: [item()],
      notes: [note()],
      attachments: [attachment()],
      templates: [template()],
    });

    const envelope = accountExportEnvelope(rows);
    const roundTrip: AccountExport = JSON.parse(JSON.stringify(envelope));

    expect(roundTrip).toEqual(envelope);
  });
});

describe('listExportEnvelope', () => {
  it('construye el sobre con la cuenta, espacio, carpeta, lista e items', () => {
    const envelope = listExportEnvelope({
      account: { id: 'a1', email: 'a@example.com' },
      workspace: { id: 'w1', name: 'Personal' },
      folder: { id: 'f1', name: 'Carpeta' },
      list: list(),
      items: [item(), item({ id: 'i2' })],
      exportedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(envelope.format).toBe('orbit-hub.export');
    expect(envelope.version).toBe(EXPORT_FORMAT_VERSION);
    expect(envelope.account).toEqual({ id: 'a1', email: 'a@example.com' });
    expect(envelope.workspace).toEqual({ id: 'w1', name: 'Personal' });
    expect(envelope.folder).toEqual({ id: 'f1', name: 'Carpeta' });
    expect(envelope.list.id).toBe('l1');
    expect(envelope.items).toHaveLength(2);
    expect(envelope.counts.items).toBe(2);
  });

  it('acepta carpeta nula', () => {
    const envelope = listExportEnvelope({
      account: { id: 'a1', email: 'a@example.com' },
      workspace: { id: 'w1', name: 'Personal' },
      folder: null,
      list: list(),
      items: [],
      exportedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(envelope.folder).toBeNull();
    expect(envelope.counts.items).toBe(0);
  });
});

describe('collectionExportEnvelope', () => {
  it('construye el sobre con la cuenta, espacio, carpeta, coleccion y enlaces', () => {
    const envelope = collectionExportEnvelope({
      account: { id: 'a1', email: 'a@example.com' },
      workspace: { id: 'w1', name: 'Personal' },
      folder: { id: 'f1', name: 'Cocina' },
      collection: collection(),
      bookmarks: [bookmark(), bookmark({ id: 'b2' })],
      exportedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(envelope.format).toBe('orbit-hub.export');
    expect(envelope.version).toBe(EXPORT_FORMAT_VERSION);
    expect(envelope.account).toEqual({ id: 'a1', email: 'a@example.com' });
    expect(envelope.workspace).toEqual({ id: 'w1', name: 'Personal' });
    expect(envelope.folder).toEqual({ id: 'f1', name: 'Cocina' });
    expect(envelope.collection.id).toBe('c1');
    expect(envelope.bookmarks).toHaveLength(2);
    expect(envelope.counts.bookmarks).toBe(2);
  });

  it('acepta carpeta nula, que es la raiz y no la ausencia de carpeta', () => {
    // `folderId: null` es "en la raiz del espacio" en el contrato, asi que el
    // sobre lo dice con `null` en vez de inventar una carpeta que no existe.
    const envelope = collectionExportEnvelope({
      account: { id: 'a1', email: 'a@example.com' },
      workspace: { id: 'w1', name: 'Personal' },
      folder: null,
      collection: collection(),
      bookmarks: [],
      exportedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(envelope.folder).toBeNull();
    expect(envelope.counts.bookmarks).toBe(0);
  });

  it('el count se cuenta aqui, y la coleccion viaja tal cual la dio el servicio', () => {
    // `counts` lo cuenta **este** builder, sobre el array que le pasaron: es el
    // mismo array del sobre, y por eso no puede mentir. El `bookmarkCount` de la
    // coleccion lo calcula el servicio —que es quien consulto los enlaces— y el
    // builder no lo toca: inventar un numero aqui seria tapar el unico sitio que
    // tiene el dato. Que los dos digan lo mismo lo comprueba el test del
    // endpoint, que es donde los dos se escriben.
    const envelope = collectionExportEnvelope({
      account: { id: 'a1', email: 'a@example.com' },
      workspace: { id: 'w1', name: 'Personal' },
      folder: null,
      collection: collection({ bookmarkCount: 99 }),
      bookmarks: [bookmark()],
      exportedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(envelope.counts.bookmarks).toBe(envelope.bookmarks.length);
    expect(envelope.collection.bookmarkCount).toBe(99);
  });

  it('sobrevive a una serializacion de ida y vuelta', () => {
    const envelope = collectionExportEnvelope({
      account: { id: 'a1', email: 'a@example.com' },
      workspace: { id: 'w1', name: 'Personal' },
      folder: null,
      collection: collection(),
      bookmarks: [bookmark()],
      exportedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope);
  });
});

describe('bookmarksToCsv', () => {
  it('empieza con la cabecera del contrato precedida del BOM, y termina en CRLF', () => {
    const csv = bookmarksToCsv([bookmark()]);

    expect(csv.startsWith(`\uFEFF${BOOKMARK_EXPORT_CSV_COLUMNS.join(';')}\r\n`)).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('una coleccion sin enlaces sale con cabecera y nada mas', () => {
    // Sin esto, una coleccion vacia podria salir como un fichero de cero bytes o
    // con una fila fantasma, y las dos cosas se ven en una hoja de calculo.
    const records = parseCsvRecords(bookmarksToCsv([]));

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual([...BOOKMARK_EXPORT_CSV_COLUMNS]);
  });

  it('el articulo no viaja, y el motivo son las columnas', () => {
    // La decision que define este formato esta en el contrato y no solo en el
    // builder: si alguien agrega `document` a `BOOKMARK_EXPORT_CSV_COLUMNS`, esta
    // linea falla y dice que revisar la decision, no a reescribir el test.
    expect(BOOKMARK_EXPORT_CSV_COLUMNS).not.toContain('document');
    expect(BOOKMARK_EXPORT_CSV_COLUMNS).not.toContain('plain_text');
    expect(bookmarksToCsv([bookmark()])).not.toContain('palabra');
  });

  it('el estado de extraccion sale con el valor crudo del contrato', () => {
    // Una columna es un dato: el JSON ya dice lo mismo con su vocabulario, y una
    // traduccion en el CSV seria una segunda version de la misma palabra.
    for (const estado of ['pending', 'ready', 'metadata_only', 'failed'] as const) {
      const records = parseCsvRecords(bookmarksToCsv([bookmark({ extractionState: estado })]));

      expect(records[1]![7], estado).toBe(estado);
    }
  });

  it('una fila es tan ancha como la cabecera, y las columnas van en su sitio', () => {
    const records = parseCsvRecords(bookmarksToCsv([bookmark({ tags: ['rapida', 'facil'] })]));

    expect(records[1]).toHaveLength(BOOKMARK_EXPORT_CSV_COLUMNS.length);
    expect(records[1]![1]).toBe('https://example.com/receta');
    expect(records[1]![2]).toBe('Tortilla');
    expect(records[1]![3]).toBe('El sitio');
    // Los tags con pipe y no con `;`, que es el separador de celdas: un tag con
    // el separador dentro partiria la fila en dos.
    expect(records[1]![5]).toBe('rapida|facil');
    expect(records[1]![6]).toBe('0');
  });

  it('sitio y descripcion ausentes salen como celdas vacias, no como "null"', () => {
    const records = parseCsvRecords(
      bookmarksToCsv([bookmark({ siteName: null, description: null })]),
    );

    expect(records[1]![3]).toBe('');
    expect(records[1]![4]).toBe('');
    expect(bookmarksToCsv([bookmark({ siteName: null, description: null })])).not.toContain('null');
  });

  it('cita una descripcion con `;` y con salto de linea sin partir la fila', () => {
    const descripcion = 'uno; dos\ny tres';
    const csv = bookmarksToCsv([
      bookmark({ description: descripcion }),
      bookmark({ id: 'b2', description: 'otra' }),
    ]);

    const records = parseCsvRecords(csv);
    // Cabecera mas dos filas: sin las comillas, el `;` de la descripcion partia
    // la primera en dos y el numero de filas no cuadraba con el de enlaces.
    expect(records).toHaveLength(3);
    expect(records[1]![4]).toBe(descripcion);
    expect(records[1]![4]).toContain('\n');
  });

  it('duplica las comillas internas de una descripcion', () => {
    const records = parseCsvRecords(bookmarksToCsv([bookmark({ description: 'dice "hola"' })]));

    expect(records[1]![4]).toBe('dice "hola"');
  });

  it('un enlace borrado sale con su fecha, sin que se pierda la fila', () => {
    // El export incluye los borrados a proposito —sin su `deletedAt` un borrado
    // seria indistinguible de uno que nunca existio— y el CSV no tiene donde
    // poner esa fecha: sale la fila, que es lo que no se pierde.
    const csv = bookmarksToCsv([bookmark({ deletedAt: '2026-03-01T00:00:00.000Z' })]);

    expect(csv).toContain('Tortilla');
    expect(parseCsvRecords(csv)).toHaveLength(2);
  });
});

describe('itemsToCsv', () => {
  it('empieza con la cabecera sin comillas precedida del BOM', () => {
    const csv = itemsToCsv({ list: list(), items: [] });

    expect(csv.startsWith('\uFEFF' + LIST_EXPORT_CSV_COLUMNS.join(';'))).toBe(true);
  });

  it('termina en CRLF y usa punto y coma', () => {
    const csv = itemsToCsv({ list: list(), items: [item()] });

    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv).toContain(';');
  });

  it('saca year y release_date de los metadatos de una pelicula', () => {
    const csv = itemsToCsv({
      list: list({ kind: 'movies' }),
      items: [
        item({
          metadata: {
            year: 1994,
            releaseDate: '1994-09-10',
            imageUrl: 'https://x/y.jpg',
            provider: 'tmdb',
          },
        }),
      ],
    });

    const records = parseCsvRecords(csv);
    const row = records[1]!;

    expect(row[8]).toBe('1994');
    expect(row[9]).toBe('1994-09-10');
    expect(row[10]).toBe('https://x/y.jpg');
    expect(row[11]).toBe('tmdb');
  });

  it('deriva year de releaseDate cuando no hay year explicito', () => {
    const csv = itemsToCsv({
      list: list({ kind: 'movies' }),
      items: [item({ metadata: { releaseDate: '1994-09-10' } })],
    });

    const records = parseCsvRecords(csv);
    const row = records[1]!;

    expect(row[8]).toBe('1994');
    expect(row[9]).toBe('1994-09-10');
  });

  it('usa publishedDate como release_date para un libro', () => {
    const csv = itemsToCsv({
      list: list({ kind: 'books' }),
      items: [
        item({
          metadata: {
            publishedDate: '2005-03-02',
          },
        }),
      ],
    });

    const records = parseCsvRecords(csv);
    const row = records[1]!;

    expect(row[8]).toBe('2005');
    expect(row[9]).toBe('2005-03-02');
  });

  it('no deriva year de un releaseDate numerico', () => {
    const csv = itemsToCsv({
      list: list({ kind: 'movies' }),
      items: [item({ metadata: { releaseDate: 780422400000 } })],
    });

    const records = parseCsvRecords(csv);

    expect(records[1]![8]).toBe('');
    expect(records[1]![8]).not.toContain('7804');
  });

  it('deja vacias las celdas de metadata cuando metadata es null', () => {
    const csv = itemsToCsv({
      list: list(),
      items: [item({ metadata: null })],
    });

    expect(csv).not.toContain('undefined');

    const records = parseCsvRecords(csv);
    const row = records[1]!;
    expect(row[8]).toBe(''); // year
    expect(row[9]).toBe(''); // release_date
    expect(row[10]).toBe(''); // image_url
    expect(row[11]).toBe(''); // provider
  });

  it('no convierte un array de releaseDate en a,b', () => {
    const csv = itemsToCsv({
      list: list(),
      items: [item({ metadata: { releaseDate: ['a', 'b'] } })],
    });

    const records = parseCsvRecords(csv);
    expect(csv).not.toContain('a,b');
    expect(records[1]![9]).toBe('');
  });

  it('une los tags con pipe', () => {
    const csv = itemsToCsv({
      list: list(),
      items: [item({ tags: ['Mercadona', 'urgente'] })],
    });

    expect(csv).toContain('"Mercadona|urgente"');
  });

  it('cita titulos con comillas, punto y coma y CRLF sin partir la fila', () => {
    const title = 'dice "hola"; o no\r\nquizas';
    const csv = itemsToCsv({
      list: list(),
      items: [
        item({ title }),
        item({ id: 'i2', title: 'otro' }),
      ],
    });

    const records = parseCsvRecords(csv);

    expect(records).toHaveLength(3); // cabecera + 2 items
    expect(records[1]).toHaveLength(LIST_EXPORT_CSV_COLUMNS.length);
    expect(records[1]![1]).toBe(title);
  });

  it('cita anotaciones con CRLF sin partir la fila', () => {
    const annotation = 'linea uno\r\nlinea dos';
    const csv = itemsToCsv({
      list: list(),
      items: [
        item({ annotation }),
        item({ id: 'i2', title: 'otro' }),
      ],
    });

    const records = parseCsvRecords(csv);

    expect(records).toHaveLength(3);
    expect(records[1]).toHaveLength(LIST_EXPORT_CSV_COLUMNS.length);
    expect(records[1]![7]).toBe(annotation);
  });

  it('preserva CRLF dentro de una celda citada', () => {
    const annotation = 'primera\r\nsegunda';
    const csv = itemsToCsv({
      list: list(),
      items: [item({ annotation })],
    });

    const records = parseCsvRecords(csv);

    expect(records[1]![7]).toBe(annotation);
    expect(records[1]![7]).toContain('\r\n');
  });

  it('escribe true y false como palabras', () => {
    const csv = itemsToCsv({
      list: list(),
      items: [item({ completed: true }), item({ id: 'i2', completed: false })],
    });

    expect(csv).toContain('"true"');
    expect(csv).toContain('"false"');
  });

  it('la cabecera tiene quince columnas', () => {
    expect(LIST_EXPORT_CSV_COLUMNS).toHaveLength(15);
  });

  it('la cabecera de un tablero son las columnas del tablero', () => {
    const csv = itemsToCsv({ list: board(), items: [] });

    const records = parseCsvRecords(csv);

    expect(records[0]).toEqual([...BOARD_EXPORT_CSV_COLUMNS]);
    expect(records[0]).not.toContain('completado');
  });

  it('escribe el titulo del estado de la tarea, no su id', () => {
    const csv = itemsToCsv({
      list: board(),
      items: [item({ id: 'i1', stateId: 's1' }), item({ id: 'i2', stateId: 's2' })],
    });

    const records = parseCsvRecords(csv);

    expect(records[1]![3]).toBe('Por hacer');
    expect(records[2]![3]).toBe('Hecho');
    // The row is still fifteen cells wide: both headers have the same number of
    // columns, which is what lets a spreadsheet read a board and a list with the
    // same code.
    expect(records[1]).toHaveLength(BOARD_EXPORT_CSV_COLUMNS.length);
    // The id does not travel. It is the one thing in the row that says nothing
    // to whoever opens the file in a spreadsheet.
    expect(csv).not.toContain('"s1"');
    expect(csv).not.toContain('"s2"');
  });

  it('deja vacia la celda de estado de un tablero que aun no tiene columnas', () => {
    const csv = itemsToCsv({
      // `states: []` is what a list that is not a board yet carries, and the
      // contract allows it: there is no state to name, so the cell says nothing
      // instead of saying an id.
      list: list({ kind: 'board' }),
      items: [item({ stateId: null }), item({ id: 'i2', stateId: 's1' })],
    });

    const records = parseCsvRecords(csv);

    expect(records[1]![3]).toBe('');
    expect(records[2]![3]).toBe('');
  });
});

describe('exportCsvColumnsFor', () => {
  it('el CSV de un tablero lleva estado y no completado', () => {
    expect(exportCsvColumnsFor('board')).toBe(BOARD_EXPORT_CSV_COLUMNS);
    expect(exportCsvColumnsFor('board')).not.toContain('completado');
    expect(exportCsvColumnsFor('tasks')).toBe(LIST_EXPORT_CSV_COLUMNS);
    expect(exportCsvColumnsFor('tasks')).not.toContain('estado');
    // And the state takes the place `completado` had, so that no other column
    // moves and `year` stays at the index the rest of the suite reads it from.
    expect(BOARD_EXPORT_CSV_COLUMNS.indexOf('estado')).toBe(
      LIST_EXPORT_CSV_COLUMNS.indexOf('completado'),
    );
    expect(BOARD_EXPORT_CSV_COLUMNS[3]).toBe('estado');
    // And the other fourteen are the fourteen they always were. Without this, a
    // name mistyped in the board array only — `createdat` instead of
    // `created_at` — would pass every other assertion here, because they all
    // compare the header against the same constant the header is built from, and
    // the two CSV headers would then disagree in silence.
    expect(BOARD_EXPORT_CSV_COLUMNS.filter((_, i) => i !== 3)).toEqual(
      LIST_EXPORT_CSV_COLUMNS.filter((_, i) => i !== 3),
    );
    expect(BOARD_EXPORT_CSV_COLUMNS).toHaveLength(LIST_EXPORT_CSV_COLUMNS.length);
  });
});

describe('csvStateCell', () => {
  it('una tarea sin estado cae en la primera columna, como en la pantalla', () => {
    expect(csvStateCell(board(), item({ stateId: null }))).toBe('Por hacer');
    // An id another device deleted lands in the first one too: that is what
    // `stateOf` does, and therefore what the person looking at the board sees.
    expect(csvStateCell(board(), item({ stateId: 'columna-borrada' }))).toBe('Por hacer');
  });

  it('una lista sin columnas escribe una celda vacia, no el id', () => {
    expect(csvStateCell(list({ kind: 'board' }), item({ stateId: 's1' }))).toBe('');
    expect(csvStateCell(list({ kind: 'board' }), item({ stateId: null }))).toBe('');
  });
});

describe('metadataCell', () => {
  it('devuelve string y number tal cual', () => {
    expect(metadataCell({ year: 1994 }, 'year')).toBe('1994');
    expect(metadataCell({ releaseDate: '1994-09-10' }, 'releaseDate')).toBe('1994-09-10');
  });

  it('devuelve vacio para clave ausente, metadata null o valor no escalar', () => {
    expect(metadataCell(null, 'year')).toBe('');
    expect(metadataCell({ year: undefined }, 'year')).toBe('');
    expect(metadataCell({ year: { anidado: true } }, 'year')).toBe('');
    expect(metadataCell({ year: ['a', 'b'] }, 'year')).toBe('');
  });
});
