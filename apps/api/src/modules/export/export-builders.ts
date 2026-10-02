import {
  EXPORT_FORMAT_VERSION,
  LIST_EXPORT_CSV_COLUMNS,
  type AccountExport,
  type ExportedAttachment,
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
    },
    workspaces: rows.workspaces,
    folders: rows.folders,
    lists: rows.lists,
    items: rows.items,
    notes: rows.notes,
    attachments: rows.attachments,
    templates: rows.templates,
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
 * CSV de una lista: cabecera fija, celdas siempre entre comillas, filas separadas
 * por CRLF y todo el fichero empieza con BOM para que Excel no rompa las tildes.
 */
export function itemsToCsv(args: { list: List; items: ListItem[] }): string {
  const header = [...LIST_EXPORT_CSV_COLUMNS].join(';');
  const rows = args.items.map((item) => itemToCsvRow(args.list, item));

  return '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n';
}

function itemToCsvRow(list: List, item: ListItem): string {
  const metadata = item.metadata;

  const releaseDate =
    metadataCell(metadata, 'releaseDate') ||
    metadataCell(metadata, 'publishedDate');

  const year = yearCell(metadata, releaseDate);

  const cells = [
    item.id,
    item.title,
    list.kind,
    String(item.completed),
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
 */
function yearCell(
  metadata: Record<string, unknown> | null,
  releaseDate: string,
): string {
  const explicit = metadataCell(metadata, 'year');
  if (explicit !== '') {
    return explicit;
  }

  if (releaseDate.length >= 4) {
    return releaseDate.slice(0, 4);
  }

  return '';
}

/**
 * Cita siempre con comillas dobles y duplica las comillas internas.
 *
 * Citar siempre es mas simple que decidir, y evita que un `;` o un salto de
 * linea dentro de un titulo o una anotacion partan la fila. Los CRLF internos
 * se normalizan a LF: un `\r\n` dentro de una celda citada confundiria a los
 * lectores que dividen por `\r\n`, y el valor leido sigue siendo un salto de
 * linea.
 */
function csvCell(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n');
  const escaped = normalized.replace(/"/g, '""');
  return `"${escaped}"`;
}
