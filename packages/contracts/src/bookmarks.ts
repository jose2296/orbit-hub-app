import { z } from 'zod';

import { syncableEntitySchema } from './api.js';
import { uuidSchema } from './common.js';
import { nodeAccessSchema, TAG_MAX } from './workspace.js';

/**
 * Anchos de las columnas, no numeros inventados aqui.
 *
 * Los de las dos tablas salen de `0021_collections.sql` y `0022_bookmarks.sql`:
 * `name` varchar(120), `description` varchar(500), `emoji` varchar(16),
 * `title` varchar(300), `site_name` varchar(120), `extraction_error` varchar(200).
 * Un contrato mas estrecho que su columna no rompe nada; uno mas ancho si, y
 * falla en produccion, en el INSERT, con un error que no nombra el campo.
 *
 * `BOOKMARK_URL_MAX` y `BOOKMARK_TAGS_MAX` son la excepcion y no tienen columna:
 * `url` es `text` y `tags` es `jsonb`, asi que ahi el limite es una decision
 * del contrato y no un ancho que haya que ir a leer a la migracion.
 */
export const COLLECTION_NAME_MAX = 120;
export const COLLECTION_DESCRIPTION_MAX = 500;
export const COLLECTION_EMOJI_MAX = 16;

export const BOOKMARK_TITLE_MAX = 300;
export const BOOKMARK_SITE_NAME_MAX = 120;
export const BOOKMARK_EXTRACTION_ERROR_MAX = 200;
export const BOOKMARK_URL_MAX = 2048;
export const BOOKMARK_TAGS_MAX = 20;

/**
 * Los cuatro estados. `metadata_only` no es un fallo: es la respuesta correcta a
 * un sitio que no es un articulo, como un video de YouTube, y se muestra sin
 * disculpa. Mezclarlo con `failed` hace que compartir un video parezca un error.
 *
 * La misma lista, en el mismo orden, esta en `BOOKMARK_EXTRACTION_STATES` de
 * `apps/api/src/db/constants.ts`, y estan juntas a proposito: es el mismo
 * duplicado que `LIST_KINDS` y `listKindSchema`, y el comentario de alla lo
 * cuenta. Aca vive el `z.enum` que valida lo que llega por la red, alla el tipo
 * que usa la columna.
 */
export const bookmarkExtractionStateSchema = z.enum([
  'pending',
  'ready',
  'metadata_only',
  'failed',
]);
export type BookmarkExtractionState = z.infer<typeof bookmarkExtractionStateSchema>;

/**
 * Solo `http` y `https`, y el filtro es del contrato a proposito.
 *
 * `z.url()` acepta `data:`, y un `data:text/plain,hola` no es una pagina: es un
 * payload pegado desde el share sheet. Esto es la mitad de una defensa en dos
 * partes y la otra mitad vive en el servidor, en el servicio, que comprueba lo
 * mismo al crear. Las dos hacen falta, y por eso esta aqui y no solo alla:
 *
 *   - Si el contrato lo dejara pasar y el servidor fuera el unico filtro, un
 *     cliente que no valida --el movil propio, un script, una version vieja-- deja
 *     que un `data:` llegue a la base, y ahi ya no se puede distinguir de una URL.
 *   - Si el servidor confiara solo en el contrato, el endpoint de extraccion, que
 *     en la fase 2 va a hacer `fetch` de esta URL, seria el SSRF esperando: el
 *     `refine` de un cliente no es una frontera de confianza para una peticion
 *     que sale del servidor.
 *
 * Que una se pueda borrar creyendo que la otra sigue no es un detalle de estilo:
 * por eso el motivo esta escrito aqui y no solo en el commit.
 */
const bookmarkUrlSchema = z
  .string()
  .trim()
  .max(BOOKMARK_URL_MAX)
  .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
    message: 'A bookmark URL has to be http or https',
  });

export const collectionSchema = syncableEntitySchema
  .extend({
    workspaceId: uuidSchema,
    folderId: uuidSchema.nullable().default(null),
    name: z.string().trim().min(1).max(COLLECTION_NAME_MAX),
    description: z.string().max(COLLECTION_DESCRIPTION_MAX).nullable().default(null),
    emoji: z.string().max(COLLECTION_EMOJI_MAX).nullable().default(null),
    position: z.number().int().min(0),
    bookmarkCount: z.int().min(0).default(0),
  })
  .extend(nodeAccessSchema.shape);
export type Collection = z.infer<typeof collectionSchema>;

export const bookmarkSchema = syncableEntitySchema
  .extend({
    workspaceId: uuidSchema,
    folderId: uuidSchema.nullable().default(null),
    collectionId: uuidSchema.nullable().default(null),
    url: bookmarkUrlSchema,
    title: z.string().max(BOOKMARK_TITLE_MAX).default(''),
    siteName: z.string().max(BOOKMARK_SITE_NAME_MAX).nullable().default(null),
    /**
     * `description` e `imageUrl` se escriben en la fase 2, desde el open graph de
     * un sitio, y por eso van `string().nullable()` a secas: un filtro aqui seria
     * una opinion sobre URLs que todavia no existen, y opinionar sobre ellas es
     * una forma de cambiar de opinion mas adelante con los datos ya guardados.
     * Que sean http/https llega con la extraccion, que es quien las lee.
     */
    description: z.string().nullable().default(null),
    imageUrl: z.string().nullable().default(null),
    document: z.string().default(''),
    plainText: z.string().default(''),
    extractionState: bookmarkExtractionStateSchema.default('pending'),
    extractionError: z.string().max(BOOKMARK_EXTRACTION_ERROR_MAX).nullable().default(null),
    tags: z.array(z.string().trim().min(1).max(TAG_MAX)).max(BOOKMARK_TAGS_MAX).default([]),
    position: z.number().int().min(0),
  })
  .extend(nodeAccessSchema.shape);
export type Bookmark = z.infer<typeof bookmarkSchema>;
