import {
  BOOKMARK_EXPORT_CSV_COLUMNS,
  EXPORT_FORMAT_VERSION,
  exportCsvColumnsFor,
  stateOf,
  type AccountExport,
  type Bookmark,
  type Collection,
  type CollectionExport,
  type ExportedAttachment,
  type JournalEntry,
  type Folder,
  type List,
  type ListExport,
  type ListItem,
  type Note,
  type NoteTemplate,
  type Workspace,
} from '@orbit-hub/contracts';

/**
 * Filas planas que el servicio de exportacion lee de la base de datos.
 *
 * Es un tipo local, no parte del contrato, porque solo describe como Task 3
 * pasa datos a Task 2; el JSON que viaja al cliente es `AccountExport`.
 */
export interface AccountExportRows {
  account: {
    id: string;
    email: string;
    displayName: string;
  };
  exportedAt: string;
  workspaces: Workspace[];
  folders: Folder[];
  lists: List[];
  items: ListItem[];
  notes: Note[];
  attachments: ExportedAttachment[];
  templates: NoteTemplate[];
  journal: JournalEntry[];
}

/**
 * Sobre JSON de una cuenta completa.
 *
 * Los counts se calculan a partir de los arrays: si el llamador los mantuviera
 * a mano, algun dia un array cambiaria y el count no, y la exportacion mentiria.
 */
export function accountExportEnvelope(rows: AccountExportRows): AccountExport {
  return {
    format: 'orbit-hub.export',
    version: EXPORT_FORMAT_VERSION,
    exportedAt: rows.exportedAt,
    account: rows.account,
    counts: {
      workspaces: rows.workspaces.length,
      folders: rows.folders.length,
      lists: rows.lists.length,
      items: rows.items.length,
      notes: rows.notes.length,
      attachments: rows.attachments.length,
      templates: rows.templates.length,
      journal: rows.journal.length,
    },
    workspaces: rows.workspaces,
    folders: rows.folders,
    lists: rows.lists,
    items: rows.items,
    notes: rows.notes,
    attachments: rows.attachments,
    templates: rows.templates,
    journal: rows.journal,
  };
}

/**
 * Sobre JSON de una sola lista, con el contexto minimo para saber de donde sale.
 */
export function listExportEnvelope(args: {
  account: { id: string; email: string };
  workspace: { id: string; name: string };
  folder: { id: string; name: string } | null;
  list: List;
  items: ListItem[];
  exportedAt: string;
}): ListExport {
  return {
    format: 'orbit-hub.export',
    version: EXPORT_FORMAT_VERSION,
    exportedAt: args.exportedAt,
    account: args.account,
    workspace: args.workspace,
    folder: args.folder,
    list: args.list,
    items: args.items,
    counts: {
      items: args.items.length,
    },
  };
}

/**
 * Sobre JSON de una sola coleccion, con el contexto minimo para saber de donde sale.
 *
 * Misma forma y misma razon que el de una lista —los dos se van a leer fuera de
 * la cuenta—, y los `counts` se cuentan igual que alla: sobre el array que viaja
 * en este fichero y no sobre lo que hay vivo en la base.
 */
export function collectionExportEnvelope(args: {
  account: { id: string; email: string };
  workspace: { id: string; name: string };
  folder: { id: string; name: string } | null;
  collection: Collection;
  bookmarks: Bookmark[];
  exportedAt: string;
}): CollectionExport {
  return {
    format: 'orbit-hub.export',
    version: EXPORT_FORMAT_VERSION,
    exportedAt: args.exportedAt,
    account: args.account,
    workspace: args.workspace,
    folder: args.folder,
    collection: args.collection,
    bookmarks: args.bookmarks,
    counts: {
      bookmarks: args.bookmarks.length,
    },
  };
}

/**
 * CSV de una coleccion: una fila por enlace, con la cabecera del contrato.
 *
 * Mismo BOM y mismo CRLF que `itemsToCsv`, y por el mismo motivo —los acentos y
 * Excel—, asi que las dos mitades de la exportacion se abren igual en cualquier
 * lado. Y las celdas se citan siempre, con el mismo `csvCell`: una descripcion
 * con un `;` o un salto de linea dentro no puede partir la fila.
 *
 * Lo que **no** viaja es `document` ni `plainText`, y la razon esta escrita en
 * `BOOKMARK_EXPORT_CSV_COLUMNS`: en una celda de una hoja de calculo el articulo
 * entero no se lee. Quien lo necesite lo pide en JSON.
 */
export function bookmarksToCsv(bookmarks: Bookmark[]): string {
  const header = BOOKMARK_EXPORT_CSV_COLUMNS.join(';');
  const rows = bookmarks.map(bookmarkToCsvRow);

  return '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n';
}

function bookmarkToCsvRow(bookmark: Bookmark): string {
  const cells = [
    bookmark.id,
    bookmark.url,
    bookmark.title,
    bookmark.siteName ?? '',
    bookmark.description ?? '',
    // Los tags con pipe y no con `;`: el separador de celdas es el `;`, y un tag
    // que lo llevara —"receta; Facil"— partiria la fila en dos. Es el mismo
    // criterio que usa el CSV de items.
    bookmark.tags.join('|'),
    String(bookmark.position),
    // El valor crudo del contrato y no una frase: una celda es un dato, y el
    // JSON ya dice lo mismo con su propio vocabulario.
    bookmark.extractionState,
    bookmark.createdAt,
    bookmark.updatedAt,
  ];

  return cells.map(csvCell).join(';');
}

/**
 * Extrae un valor de metadata para una celda CSV.
 *
 * `list_items.metadata` es jsonb sin tipo: un proveedor podria dejar un objeto,
 * un array o `null`. Si se pasara a String directamente, saldrian `[object Object]`
 * o `a,b`, asi que solo se escriben strings y numbers; todo lo demas es vacio.
 */
export function metadataCell(
  metadata: Record<string, unknown> | null,
  key: string,
): string {
  if (metadata === null || metadata === undefined) {
    return '';
  }

  const value = metadata[key];
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  return '';
}

/**
 * The state cell of a board row: the title of the state the task is in.
 *
 * It asks the contract's own `stateOf` instead of finding the state here,
 * because that is the function the board screen draws with: a task with no state
 * of its own, and a task whose state another device deleted, both land in the
 * first column on screen, and a CSV that put them anywhere else would be a
 * second answer to a question the app has already answered once.
 *
 * The title and not the id, because the id is the one thing in a column that
 * nobody ever reads and the whole point of a column is that it has a name. A
 * list with no states — which is what a list that is not a board yet carries —
 * has nothing to name, and writes an empty cell rather than an id that means
 * nothing to whoever opens the file.
 */
export function csvStateCell(list: List, item: ListItem): string {
  return stateOf(list.states, item.stateId)?.title ?? '';
}

/**
 * CSV of a list: cells always quoted, rows separated by CRLF, and the whole file
 * starts with a BOM so Excel does not break the accents.
 *
 * The header is not a fixed one: there are two fixed headers and the kind of the
 * list picks which, because a board has no `completado` column and a list of any
 * other kind has no `estado` one. What `exportCsvColumnsFor` returns for the
 * header and `csvStateCell` returns for the cell under index 3 come from the same
 * decision, which is what keeps a cell from being written under a header that
 * names something else.
 *
 * The BOM and the CRLF are the same either way: they are what keeps Excel from
 * breaking the accents, and nothing about a board changes that.
 */
export function itemsToCsv(args: { list: List; items: ListItem[] }): string {
  const header = exportCsvColumnsFor(args.list.kind).join(';');
  const rows = args.items.map((item) => itemToCsvRow(args.list, item));

  return '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n';
}

function itemToCsvRow(list: List, item: ListItem): string {
  const metadata = item.metadata;

  const releaseDate =
    metadataCell(metadata, 'releaseDate') ||
    metadataCell(metadata, 'publishedDate');

  const year = yearCell(metadata);

  const cells = [
    item.id,
    item.title,
    list.kind,
    // The one cell that changes with the kind of list. `completed` stays in
    // place for every other kind because a board has no checkbox: what index 3
    // holds is decided by `exportCsvColumnsFor`, and the cell under it has to be
    // the value that header names.
    list.kind === 'board' ? csvStateCell(list, item) : String(item.completed),
    item.priority,
    item.tags.join('|'),
    String(item.position),
    item.annotation ?? '',
    year,
    releaseDate,
    metadataCell(metadata, 'imageUrl'),
    metadataCell(metadata, 'provider'),
    item.externalId ?? '',
    item.createdAt,
    item.updatedAt,
  ];

  return cells.map(csvCell).join(';');
}

/**
 * El year puede venir directo o deducirse de los primeros cuatro caracteres
 * de una fecha de estreno o publicacion.
 *
 * El guarda se hace sobre el valor crudo, no sobre la salida de `metadataCell`,
 * porque `metadataCell` convierte numeros a string: un timestamp como
 * 780422400000 saldria como "7804" si solo miraramos los primeros cuatro
 * caracteres de su representacion.
 */
function yearCell(metadata: Record<string, unknown> | null): string {
  const explicit = metadataCell(metadata, 'year');
  if (explicit !== '') {
    return explicit;
  }

  const releaseDate = metadata?.releaseDate;
  if (typeof releaseDate === 'string' && releaseDate.length >= 4) {
    return releaseDate.slice(0, 4);
  }

  const publishedDate = metadata?.publishedDate;
  if (typeof publishedDate === 'string' && publishedDate.length >= 4) {
    return publishedDate.slice(0, 4);
  }

  return '';
}

/**
 * Cita siempre con comillas dobles y duplica las comillas internas.
 *
 * Citar siempre es mas simple que decidir, y evita que un `;` o un salto de
 * linea dentro de un titulo o una anotacion partan la fila. Los datos viajan
 * exactamente como estan almacenados: un CRLF dentro de una celda citada es
 * un CRLF en el CSV, y un parser que respete las comillas lo leera como un
 * solo campo.
 */
function csvCell(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}
