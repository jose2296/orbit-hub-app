import {
  BOOKMARK_EXTRACTION_ERROR_MAX,
  BOOKMARK_SITE_NAME_MAX,
  BOOKMARK_TITLE_MAX,
} from '@orbit-hub/contracts';
import { and, eq } from 'drizzle-orm';

import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import { MEMBERSHIP_ROLE_RANK } from '../../db/constants.js';
import type { BookmarkExtractionStateName, MembershipRoleName } from '../../db/constants.js';
import type { BookmarkRow } from '../../db/schema.js';
import { bookmarks, memberships } from '../../db/schema.js';
import { HttpError } from '../../lib/http-error.js';
import { comprobarDestinoSeguro, traerHtmlSeguro } from '../../lib/ssrf.js';
import type { ResultadoDeBusqueda } from '../../lib/ssrf.js';
import { extraerContenido } from './extract-content.js';
import type { ResultadoDeContenido } from './extract-content.js';
import { metadataDeYoutube, sacarmetadata } from './extract-metadata.js';
import type { MetadataDePagina } from './extract-metadata.js';

/**
 * El servicio que extrae: une las cuatro piezas y es el unico que escribe los
 * siete campos del servidor.
 *
 * El orden es una cadena de decisiones y cada una puede terminar el proceso:
 * 404 si no hay bookmark o no hay membresia, 403 si no llega a editor, 204
 * silencioso si ya esta `ready`, `failed` si el fetch no entra, metadata
 * siempre que el fetch entre, documento solo si el texto entra, titulo solo si
 * estaba vacio, y `version`/`updatedAt` sumados en cada escritura para que el
 * pull del proximo ciclo lo traiga.
 */

/** Lo que el servicio pide a la red, separado para poder inyectarlo en tests. */
export interface DependenciasDeExtraccion {
  traerHtml: (url: string) => Promise<ResultadoDeBusqueda>;
  contenidoDe: (html: string, url: string) => Promise<ResultadoDeContenido>;
  metadataDe: (html: string, url: string) => MetadataDePagina;
  youtubeDe: (url: string) => Promise<MetadataDePagina | null>;
  /** Confirma que la imagen resuelve a publica, o la deja en `null`. */
  imagenResuelveAPublica: (url: string) => Promise<boolean>;
  /**
   * El techo total del endpoint, en ms.
   *
   * El guard es por salto (hasta 4 x 8 s = 32 s) y lo dice en su propio
   * comentario; este techo es lo que lo acota. Cubre la pagina, el oembed y la
   * comprobacion de la imagen juntos, porque cada uno es una llamada con su
   * propio reloj y sin esto el total seria la suma.
   */
  techoMs: number;
}

/**
 * El techo total, en ms.
 *
 * Por debajo de los 32 s del guard (4 saltos x 8 s): si el techo no fuera
 * menor, no acotaria nada. Es best-effort de fondo —un timeout deja `failed`
 * con el motivo y la proxima vez se reintenta— asi que cortar antes es barato.
 */
const TECHO_TOTAL_MS = 20_000;

/** El reloj de la comprobacion de la imagen, que es solo un DNS. */
const TECHO_IMAGEN_MS = 5_000;

/**
 * Confirma que una imagen resuelve a una direccion publica.
 *
 * La funcion de metadata es sincrona y no resuelve DNS: un
 * `http://interno.local/x.png` pasa su predicado de esquema y su chequeo de
 * literales, y el movil la pediria despues sin guard. Por eso la imagen pasa
 * por `comprobarDestinoSeguro` —el mismo guard que la pagina— y si no pasa,
 * `imageUrl` queda en `null`.
 */
async function imagenResuelveAPublica(url: string): Promise<boolean> {
  const controller = new AbortController();
  const reloj = setTimeout(() => controller.abort(), TECHO_IMAGEN_MS);
  try {
    return (await comprobarDestinoSeguro(url, controller.signal)).ok;
  } catch {
    return false;
  } finally {
    clearTimeout(reloj);
  }
}

const DEPENDENCIAS_POR_DEFECTO: DependenciasDeExtraccion = {
  traerHtml: (url) => traerHtmlSeguro(url),
  contenidoDe: (html, url) => extraerContenido(html, url),
  metadataDe: (html, url) => sacarmetadata(html, url),
  youtubeDe: (url) => metadataDeYoutube(url),
  imagenResuelveAPublica,
  techoMs: TECHO_TOTAL_MS,
};

async function db(): Promise<Database> {
  return (await getDatabase()).db;
}

async function rolEn(userId: string, workspaceId: string): Promise<MembershipRoleName | null> {
  const database = await db();
  const [fila] = await database
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
    .limit(1);
  return fila ? (fila.role as MembershipRoleName) : null;
}

/** Los anfitriones que son YouTube, para pedir el oembed. */
const ANFITRIONES_DE_YOUTUBE: ReadonlySet<string> = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
]);

function esYoutube(url: string): boolean {
  try {
    return ANFITRIONES_DE_YOUTUBE.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Corre una promesa de red contra el tiempo que queda del techo total.
 *
 * Perder la carrera no cancela lo que corre por debajo —igual que el resolver
 * del guard—, pero recupera el control del endpoint, que es lo que el techo
 * promete. El motivo es el del reloj y no el del fetch, porque son dos fallas
 * distintas para quien lee.
 */
async function conTecho<T>(
  promesa: Promise<T>,
  limite: number,
): Promise<{ agoto: true } | { agoto: false; valor: T }> {
  const resto = limite - Date.now();
  if (resto <= 0) return { agoto: true };
  let reloj: ReturnType<typeof setTimeout> | null = null;
  try {
    const valor = await Promise.race([
      promesa,
      new Promise<null>((resolve) => {
        reloj = setTimeout(() => resolve(null), resto);
      }),
    ]);
    if (valor === null) return { agoto: true };
    return { agoto: false, valor: valor as T };
  } finally {
    if (reloj !== null) clearTimeout(reloj);
  }
}

function recortar(texto: string | null, tope: number): string | null {
  if (texto === null) return null;
  const recortado = texto.trim();
  if (recortado === '') return null;
  return recortado.slice(0, tope);
}

interface EscrituraDeExtraccion {
  document: string;
  plainText: string;
  title: string;
  siteName: string | null;
  description: string | null;
  imageUrl: string | null;
  extractionState: BookmarkExtractionStateName;
  extractionError: string | null;
}

async function guardar(
  fila: BookmarkRow,
  escritura: EscrituraDeExtraccion,
): Promise<void> {
  const database = await db();
  await database
    .update(bookmarks)
    .set({
      document: escritura.document,
      plainText: escritura.plainText,
      title: escritura.title,
      siteName: escritura.siteName,
      description: escritura.description,
      imageUrl: escritura.imageUrl,
      extractionState: escritura.extractionState,
      extractionError: escritura.extractionError,
      version: fila.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(bookmarks.id, fila.id));
}

/**
 * Extrae un bookmark: trae la pagina, saca metadata y contenido, y guarda.
 *
 * Nunca tira por la red o por una pagina rota: esos motivos van a
 * `extractionError` y se leen por una persona. Solo tira `HttpError` por
 * permiso o existencia, que es lo que el endpoint contesta.
 */
export async function extractBookmark(
  userId: string,
  id: string,
  dependencias: DependenciasDeExtraccion = DEPENDENCIAS_POR_DEFECTO,
): Promise<void> {
  const database = await db();
  const [fila] = await database.select().from(bookmarks).where(eq(bookmarks.id, id)).limit(1);
  if (!fila || fila.deletedAt) {
    throw HttpError.notFound('Bookmark not found');
  }
  const rol = await rolEn(userId, fila.workspaceId);
  if (rol === null) {
    throw HttpError.notFound('Bookmark not found');
  }
  if (MEMBERSHIP_ROLE_RANK[rol] < MEMBERSHIP_ROLE_RANK.editor) {
    throw HttpError.forbidden('This space is read only for you');
  }

  if (fila.extractionState === 'ready') {
    return;
  }

  // El techo total arranca aca y cubre las tres llamadas de red juntas: la
  // pagina, el oembed y la comprobacion de la imagen. Ver `conTecho`.
  const limite = Date.now() + dependencias.techoMs;

  let busqueda: ResultadoDeBusqueda;
  try {
    const carrera = await conTecho(dependencias.traerHtml(fila.url), limite);
    if (carrera.agoto) {
      busqueda = { ok: false, motivo: 'the request timed out' };
    } else {
      busqueda = carrera.valor;
    }
  } catch {
    busqueda = { ok: false, motivo: 'the request failed' };
  }
  if (!busqueda.ok) {
    await guardar(fila, {
      document: '',
      plainText: '',
      title: fila.title,
      siteName: fila.siteName,
      description: fila.description,
      imageUrl: fila.imageUrl,
      extractionState: 'failed',
      extractionError: recortar(busqueda.motivo, BOOKMARK_EXTRACTION_ERROR_MAX) ?? 'the request failed',
    });
    return;
  }

  const finalUrl = busqueda.finalUrl;
  const metaBase = dependencias.metadataDe(busqueda.html, finalUrl);

  let meta = metaBase;
  if (esYoutube(finalUrl)) {
    try {
      const carrera = await conTecho(dependencias.youtubeDe(finalUrl), limite);
      const deYoutube = !carrera.agoto ? carrera.valor : null;
      if (deYoutube !== null) {
        // El oembed no trae descripcion: el video se guarda sin ella, y la de
        // la pagina tampoco sirve porque es la del player, no la del video.
        meta = {
          title: deYoutube.title ?? metaBase.title,
          siteName: deYoutube.siteName ?? metaBase.siteName,
          description: null,
          imageUrl: deYoutube.imageUrl ?? metaBase.imageUrl,
        };
      }
    } catch {
      // Sin oembed no hay video sin metadata: quedan los OG del HTML.
    }
  }

  // La imagen paso el predicado de esquema en la funcion sincrona, pero un
  // nombre no se puede juzgar sin DNS. Se confirma que resuelve a publica y
  // si no, `imageUrl` queda en `null` antes de guardar.
  let imageUrl = meta.imageUrl;
  if (imageUrl !== null) {
    try {
      const carrera = await conTecho(dependencias.imagenResuelveAPublica(imageUrl), limite);
      if (carrera.agoto || !carrera.valor) {
        imageUrl = null;
      }
    } catch {
      imageUrl = null;
    }
  }

  // El titulo escrito a mano no lo pisa nadie: solo se escribe si estaba vacio.
  const titulo = fila.title !== '' ? fila.title : (meta.title ?? '');

  let contenido: ResultadoDeContenido;
  try {
    contenido = await dependencias.contenidoDe(busqueda.html, finalUrl);
  } catch {
    contenido = { ok: false, motivo: 'unreadable' };
  }

  if (!contenido.ok) {
    // El texto no entro pero la metadata si: un articulo del que no se pudo
    // sacar el texto igual tiene titulo, sitio e imagen, y eso ya es el
    // `metadata_only` del spec. `unreadable` es la excepcion: ni el HTML se
    // pudo leer con confianza, asi que es `failed`.
    const estado: BookmarkExtractionStateName =
      contenido.motivo === 'unreadable' ? 'failed' : 'metadata_only';
    await guardar(fila, {
      document: '',
      plainText: '',
      title: recortar(titulo, BOOKMARK_TITLE_MAX) ?? '',
      siteName: recortar(meta.siteName, BOOKMARK_SITE_NAME_MAX),
      description: meta.description,
      imageUrl,
      extractionState: estado,
      extractionError: recortar(contenido.motivo, BOOKMARK_EXTRACTION_ERROR_MAX) ?? contenido.motivo,
    });
    return;
  }

  await guardar(fila, {
    document: contenido.contenido.document,
    plainText: contenido.contenido.plainText,
    title: recortar(titulo, BOOKMARK_TITLE_MAX) ?? '',
    siteName: recortar(meta.siteName, BOOKMARK_SITE_NAME_MAX),
    description: meta.description,
    imageUrl,
    extractionState: 'ready',
    extractionError: null,
  });
}
