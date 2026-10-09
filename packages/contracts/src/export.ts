import { z } from 'zod';

import { bookmarkSchema, collectionSchema } from './bookmarks';
import { countSchema, emailSchema, isoDateTimeSchema, uuidSchema } from './common';
import { journalEntrySchema } from './journal';
import {
  attachmentSchema,
  folderSchema,
  listItemSchema,
  listSchema,
  noteSchema,
  noteTemplateSchema,
  workspaceSchema,
  type ListKind,
} from './workspace';

/**
 * Formatos de exportacion. Una lista compartida puede bajarse como JSON o CSV;
 * una cuenta completa solo admite JSON porque un CSV de varias hojas no esta
 * construido.
 */
export const exportFormatSchema = z.enum(['json', 'csv']);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

/**
 * Version del formato de exportacion. Subira cuando cambie la forma del
 * sobre o de los arrays que contiene, no cuando cambien los schemas de sus
 * piezas.
 */
export const EXPORT_FORMAT_VERSION = 1;

/** Parametros de query para exportar toda la cuenta. Solo JSON, a proposito. */
export const accountExportQuerySchema = z.object({
  format: z.literal('json').default('json'),
});
export type AccountExportQuery = z.infer<typeof accountExportQuerySchema>;

/** Parametros de query para exportar una lista. Acepta JSON o CSV. */
export const listExportQuerySchema = z.object({
  format: exportFormatSchema.default('json'),
});
export type ListExportQuery = z.infer<typeof listExportQuerySchema>;

/**
 * Un adjunto tal como sale en la exportacion.
 *
 * Se quita `storageKey` porque el fichero exportado se lee fuera de la cuenta
 * y una clave de objeto interna no sirve para nada y no debe viajar.
 */
export const exportedAttachmentSchema = attachmentSchema.omit({ storageKey: true });
export type ExportedAttachment = z.infer<typeof exportedAttachmentSchema>;

/** Sobre de una exportacion completa de cuenta. */
export const accountExportSchema = z.object({
  format: z.literal('orbit-hub.export'),
  version: z.literal(EXPORT_FORMAT_VERSION),
  exportedAt: isoDateTimeSchema,
  account: z.object({
    id: uuidSchema,
    email: emailSchema,
    displayName: z.string(),
  }),
  counts: z.object({
    workspaces: countSchema,
    folders: countSchema,
    lists: countSchema,
    items: countSchema,
    notes: countSchema,
    attachments: countSchema,
    templates: countSchema,
    // Optional on read: an export written before the journal existed has none.
    journal: countSchema.default(0),
  }),
  workspaces: z.array(workspaceSchema),
  folders: z.array(folderSchema),
  lists: z.array(listSchema),
  items: z.array(listItemSchema),
  notes: z.array(noteSchema),
  attachments: z.array(exportedAttachmentSchema),
  templates: z.array(noteTemplateSchema),
  /** The account's own diary, tombstones included, as on notes. */
  journal: z.array(journalEntrySchema).default([]),
});
export type AccountExport = z.infer<typeof accountExportSchema>;

/** Sobre de la exportacion de una sola lista, con su contexto inmediato. */
export const listExportSchema = z.object({
  format: z.literal('orbit-hub.export'),
  version: z.literal(EXPORT_FORMAT_VERSION),
  exportedAt: isoDateTimeSchema,
  account: z.object({
    id: uuidSchema,
    email: emailSchema,
  }),
  workspace: z.object({
    id: uuidSchema,
    name: z.string(),
  }),
  folder: z.object({
    id: uuidSchema,
    name: z.string(),
  }).nullable(),
  list: listSchema,
  items: z.array(listItemSchema),
  counts: z.object({
    items: countSchema,
  }),
});
export type ListExport = z.infer<typeof listExportSchema>;

/** Parametros de query para exportar una coleccion. Acepta JSON o CSV. */
export const collectionExportQuerySchema = z.object({
  format: exportFormatSchema.default('json'),
});
export type CollectionExportQuery = z.infer<typeof collectionExportQuerySchema>;

/**
 * Sobre de la exportacion de una sola coleccion, con su contexto inmediato.
 *
 * Misma forma que el de una lista y por la misma razon: el JSON de una lista
 * lleva el espacio y la carpeta para que el fichero sepa de donde sale, y el de
 * una coleccion lleva lo mismo. **Sin `folder` no hay `null` que inventar**: una
 * coleccion vive en un espacio o en una carpeta, y `null` es "en la raiz", que es
 * un sitio de verdad —igual que en el de una lista, donde la carpeta ausente es
 * la raiz y no la ausencia de carpeta.
 *
 * Y `collection` va entero, con su `bookmarkCount`: el numero que cuenta es el
 * de los `bookmarks` que viajan en este mismo fichero, no el de los vivos en la
 * base. Un count que no cuadra con el array de al lado es un count que miente, y
 * por eso el sobre cuenta lo que lleva, no lo que hay.
 */
export const collectionExportSchema = z.object({
  format: z.literal('orbit-hub.export'),
  version: z.literal(EXPORT_FORMAT_VERSION),
  exportedAt: isoDateTimeSchema,
  account: z.object({
    id: uuidSchema,
    email: emailSchema,
  }),
  workspace: z.object({
    id: uuidSchema,
    name: z.string(),
  }),
  folder: z.object({
    id: uuidSchema,
    name: z.string(),
  }).nullable(),
  collection: collectionSchema,
  bookmarks: z.array(bookmarkSchema),
  counts: z.object({
    bookmarks: countSchema,
  }),
});
export type CollectionExport = z.infer<typeof collectionExportSchema>;

/**
 * Genera el nombre de fichero que usa el servidor en `Content-Disposition`
 * y el cliente en su destino local.
 *
 * Normaliza el titulo a minusculas sin acentos ni simbolos, junta cada racha
 * de caracteres no alfanumericos en un guion, recorta a 40 caracteres y cae
 * al `fallbackId` si el titulo no deja nada usable. Asi los dos lados del
 * contrato producen exactamente la misma cadena.
 */
export function exportFilename(args: {
  title: string;
  fallbackId: string;
  extension: ExportFormat;
  date: string;
}): string {
  const { title, fallbackId, extension, date } = args;

  const normalized = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

  const slug = normalized.length > 0 ? normalized : fallbackId;

  return `orbit-hub-${slug}-${date}.${extension}`;
}

/**
 * The CSV header of a list that is not a board, and of every kind that keeps a
 * checkbox. `exportCsvColumnsFor` is what the builder asks, so the builder and
 * the test cannot read two different arrays.
 *
 * The board's is below: the same fifteen names, with `estado` where `completado`
 * stands. The two are kept apart rather than folded into one another because the
 * order of a CSV is its format, and a test asserting `year` at index 8 of this
 * array is asserting that the format did not move.
 */
export const LIST_EXPORT_CSV_COLUMNS = [
  'id',
  'titulo',
  'tipo',
  'completado',
  'prioridad',
  'tags',
  'posicion',
  'anotacion',
  'year',
  'release_date',
  'image_url',
  'provider',
  'external_id',
  'created_at',
  'updated_at',
] as const;

/**
 * The header of a CSV of a board: `LIST_EXPORT_CSV_COLUMNS` with `completado`
 * traded for `estado`, in the very same place, and nothing else moved.
 *
 * The place is the whole reason this is a second list and not an extra column
 * at the end. A CSV is read by position and not by header name, and index 3 is
 * where the column that stopped meaning anything the day a list could carry
 * states instead of a checkbox was standing: `estado` says which column a task
 * is in, and `completado` on a board says nothing at all. Appending it instead
 * of replacing it would keep the fifteen columns and push `year` from index 8 to
 * index 9, so every reader that indexes into a row — the tests that take a
 * film's year out of a CSV, and any spreadsheet somebody built on top of this
 * export — would read the wrong cell.
 *
 * Fifteen columns either way, so a row of a board is as wide as a row of any
 * other list and both are read with the same code.
 */
export const BOARD_EXPORT_CSV_COLUMNS = [
  'id',
  'titulo',
  'tipo',
  'estado',
  'prioridad',
  'tags',
  'posicion',
  'anotacion',
  'year',
  'release_date',
  'image_url',
  'provider',
  'external_id',
  'created_at',
  'updated_at',
] as const;

/**
 * The columns of a CSV of items, by kind of list.
 *
 * The kind decides and nothing else does. A board is the only list whose tasks
 * carry a column instead of a checkbox, and every other kind holds `[]` in
 * `states`, so there is nothing else on the list that could tell them apart.
 */
export function exportCsvColumnsFor(kind: ListKind): readonly string[] {
  return kind === 'board' ? BOARD_EXPORT_CSV_COLUMNS : LIST_EXPORT_CSV_COLUMNS;
}

/**
 * La cabecera del CSV de una coleccion: lo que el enlace **es**, no lo que se
 * extrajo de el.
 *
 * El orden es el mismo que el del CSV de items y por la misma razon —un CSV se
 * lee por posicion— asi que anadir una columna en medio seria mover las que ya
 * hay. Por eso `id` va el primero, como alli: es lo que permite volver a meter
 * el enlace en la coleccion sin duplicarlo.
 *
 * `document` y `plain_text` **no estan**, y es la decision que define este
 * formato. Son el articulo entero: HTML completo en una celda de una hoja de
 * calculo no se lee, no se ordena y multiplica el tamano del fichero por un
 * factor que nadie pidio. Quien quiera el articulo lo pide en JSON, que es donde
 * si viaja entero; el CSV es el formato de la persona que quiere sus enlaces en
 * una tabla, y ahi lo que sirve es la URL, el titulo, el sitio y las etiquetas.
 *
 * `estado_extraccion` si esta, y con el valor crudo del contrato
 * (`pending`/`ready`/`metadata_only`/`failed`) y no con una traduccion: una
 * columna es un dato, y el JSON ya dice lo mismo. Es lo que explica una fila sin
 * descripcion, que de otro modo no tiene explicacion ninguna.
 */
export const BOOKMARK_EXPORT_CSV_COLUMNS = [
  'id',
  'url',
  'titulo',
  'sitio',
  'descripcion',
  'tags',
  'posicion',
  'estado_extraccion',
  'created_at',
  'updated_at',
] as const;
