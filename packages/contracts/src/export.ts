import { z } from 'zod';

import { countSchema, emailSchema, isoDateTimeSchema, uuidSchema } from './common';
import {
  attachmentSchema,
  folderSchema,
  listItemSchema,
  listSchema,
  noteSchema,
  noteTemplateSchema,
  workspaceSchema,
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
  }),
  workspaces: z.array(workspaceSchema),
  folders: z.array(folderSchema),
  lists: z.array(listSchema),
  items: z.array(listItemSchema),
  notes: z.array(noteSchema),
  attachments: z.array(exportedAttachmentSchema),
  templates: z.array(noteTemplateSchema),
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
 * Cabecera CSV de la exportacion de una lista. Una sola definicion para que
 * el builder y el test no puedan separarse.
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
