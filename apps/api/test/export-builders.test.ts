import { describe, expect, it } from 'vitest';

import {
  EXPORT_FORMAT_VERSION,
  LIST_EXPORT_CSV_COLUMNS,
  type AccountExport,
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
    priority: 'none',
    icon: null,
    iconStyle: 'outline',
    iconColor: 'neutral',
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
    emoji: null,
    tags: [],
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

function workspace(over: Partial<Workspace> = {}): Workspace {
  return {
    id: 'w1',
    name: 'Personal',
    description: null,
    emoji: null,
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
    emoji: null,
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
