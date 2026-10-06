/**
 * La metadata de una pagina: titulo, sitio, descripcion e imagen.
 *
 * Son los `<meta property="og:*">` leidos a mano, a proposito: un punado de
 * consultas sobre el DOM que ya se construyo, cero dependencias. Readability
 * devuelve `title` y `excerpt` ademas, asi que hay solapamiento y se fusiona por
 * precedencia, que es la unica decision que toma este archivo:
 *
 * - `title`: lo que escribio la persona > titulo de Readability > `<title>` >
 *   `og:title` > `twitter:title` > hostname.
 * - `description`: `og:description` > `twitter:description` > excerpt de
 *   Readability > `<meta name="description">`.
 * - `imageUrl`: `og:image` > `twitter:image` > imagen principal.
 * - `siteName`: `og:site_name` > hostname sin `www`.
 *
 * La cadena vive en `fusionarMetadata` y en ningun otro lado: el servicio
 * (Task 5) aplica el titulo de la persona pasando por la misma funcion, asi que
 * "no lo pisa nadie" no depende de que dos archivos coincidan.
 *
 * Todas las URLs que vienen de la pagina son no confiables, tambien `og:image`:
 * puede ser `javascript:...` o una IP interna, y el movil la va a pedir sin
 * guard. Por eso cada imagen se resuelve contra la URL final y pasa por el
 * predicado de esquema **y** por el chequeo de rangos de la Task 2, importado
 * de `ssrf.ts` y no copiado. Si no pasa, `imageUrl` queda en `null`.
 */

import { Readability } from '@mozilla/readability';

// @ts-expect-error jsdom no trae tipos, y no se instalan: ver la nota de tipos en extract-content.ts.
import * as jsdom from 'jsdom';

import { esIpProhibida, traerHtmlSeguro } from '../../lib/ssrf.js';
import { esUrlQueSePuedePedir } from '../sync/sync-service.js';
import { limpiarParaElDom } from './extract-content.js';

/* ------------------------------------------------------------------ tipos -- */

/** Lo que se guarda de la metadata de una pagina, y nada mas. */
export interface MetadataDePagina {
  title: string | null;
  siteName: string | null;
  description: string | null;
  imageUrl: string | null;
}

/**
 * Cada fuente con su nombre, antes de fusionar.
 *
 * Las imagenes (`ogImagen`, `twitterImagen`, `imagenPrincipal`) llegan ya
 * resueltas contra la URL de la pagina y validadas: la fusion no valida nada,
 * solo elige. `tituloDePersona` es `null` cuando la persona no escribio ninguno
 * y lo pone el servicio, no este archivo.
 */
export interface PiezasDeMetadata {
  tituloDeReadability: string | null;
  extracto: string | null;
  tituloDePagina: string | null;
  ogTitulo: string | null;
  ogDescripcion: string | null;
  ogImagen: string | null;
  ogSitio: string | null;
  twitterTitulo: string | null;
  twitterDescripcion: string | null;
  twitterImagen: string | null;
  metaDescripcion: string | null;
  imagenPrincipal: string | null;
  url: string;
  tituloDePersona?: string | null;
}

/**
 * El trozo de DOM que usa esta lectura, declarado aca por el mismo motivo que
 * en `extract-content.ts`: la API no tiene `lib.dom` y `jsdom` no trae tipos.
 */
interface ElementoLeible {
  getAttribute(nombre: string): string | null;
}

interface DocumentoLeible {
  readonly title: string;
  querySelector(selector: string): ElementoLeible | null;
}

/** La ventana que construye jsdom: ahi vive el `document` y ahi se cierra. */
interface VentanaLeible {
  readonly document: DocumentoLeible;
  /** Libera los timers del DOM: sin esto, cada extraccion deja handles vivos. */
  close(): void;
}

interface JSDOMComoSeUsa {
  new (html: string, opciones?: { url?: string }): { readonly window: VentanaLeible };
}

const { JSDOM } = jsdom as unknown as { JSDOM: JSDOMComoSeUsa };

/* -------------------------------------------------------------- la fusion -- */

/** El primer candidato que no viene vacio, o `null` si no hay ninguno. */
function primero(...candidatos: readonly (string | null | undefined)[]): string | null {
  for (const candidato of candidatos) {
    const texto = candidato?.trim() ?? '';
    if (texto !== '') return texto;
  }
  return null;
}

/** El hostname de la pagina, o `null` si la URL no se puede leer. */
function nombreDeAnfitrion(url: string): string | null {
  try {
    const anfitrion = new URL(url).hostname.trim();
    return anfitrion === '' ? null : anfitrion;
  } catch {
    return null;
  }
}

/** El hostname sin el `www.` inicial, que es como se nombra un sitio. */
function sinWww(anfitrion: string | null): string | null {
  if (anfitrion === null) return null;
  const sin = anfitrion.replace(/^www\./i, '');
  return sin === '' ? null : sin;
}

/**
 * La precedencia de la spec, en un solo lugar.
 *
 * `title`: lo que escribio la persona > titulo de Readability > `<title>` >
 * `og:title` > `twitter:title` > hostname. `description`: `og:description` >
 * `twitter:description` > excerpt > `<meta name="description">`. `imageUrl`:
 * `og:image` > `twitter:image` > imagen principal. `siteName`: `og:site_name` >
 * hostname sin `www`.
 *
 * Un detalle que se midio y no se supuso: Readability lee `og:title` por su
 * cuenta para armar su titulo, asi que cuando devuelve uno y la pagina trae
 * `og:title` suelen coincidir —en la watch de YouTube el stub de nueve palabras
 * trae justo el `og:title`, sin el " - YouTube" del `<title>`. La parte de la
 * cadena que decide es cuando Readability no da nada, que es una pagina sin
 * cuerpo: ahi `<title>` va antes que `og:title`.
 */
export function fusionarMetadata(piezas: PiezasDeMetadata): MetadataDePagina {
  const anfitrion = nombreDeAnfitrion(piezas.url);
  return {
    title: primero(
      piezas.tituloDePersona,
      piezas.tituloDeReadability,
      piezas.tituloDePagina,
      piezas.ogTitulo,
      piezas.twitterTitulo,
      anfitrion,
    ),
    siteName: primero(piezas.ogSitio, sinWww(anfitrion)),
    description: primero(
      piezas.ogDescripcion,
      piezas.twitterDescripcion,
      piezas.extracto,
      piezas.metaDescripcion,
    ),
    imageUrl: primero(piezas.ogImagen, piezas.twitterImagen, piezas.imagenPrincipal),
  };
}

/* -------------------------------------------------------- la lectura del -- */
/* ------------------------------------------------------------------- DOM -- */

/** El `content` de un `<meta>`, o `null` si no esta o viene vacio. */
function contenidoDe(documento: DocumentoLeible, selector: string): string | null {
  return primero(documento.querySelector(selector)?.getAttribute('content'));
}

/**
 * Una imagen de la pagina, resuelta contra la pagina y validada, o `null`.
 *
 * El esquema lo mira `esUrlQueSePuedePedir`, el mismo predicado del guard: un
 * `javascript:` o un `data:` en un `og:image` no es una imagen. Los rangos los
 * mira `esIpProhibida`, la funcion que exporta `ssrf.ts` para esta tarea: un
 * `http://169.254.169.254/x.png` pasa el predicado de esquema y solo lo para
 * el chequeo de rangos.
 *
 * Solo se puede mirar el literal: un nombre necesitaria DNS y esta funcion es
 * sincrona por contrato, asi que un anfitrion que no se lee como IP pasa. Es
 * una limitacion honesta y queda escrita: el caso del ataque —el literal de la
 * nube o del loopback— queda en `null`.
 */
function imagenUtilizable(valor: string | null, base: string): string | null {
  const recortado = valor?.trim() ?? '';
  if (recortado === '') return null;
  let absoluta: string;
  try {
    absoluta = new URL(recortado, base).toString();
  } catch {
    return null;
  }
  if (!esUrlQueSePuedePedir(absoluta)) return null;
  let anfitrion: string;
  try {
    anfitrion = new URL(absoluta).hostname;
  } catch {
    return null;
  }
  // `URL` deja los corchetes de una IPv6 literal en `hostname`, igual que en el
  // guard: se sacan antes de mirar rangos.
  const literal = anfitrion.replace(/^\[/, '').replace(/\]$/, '');
  if (esLiteralNumerico(literal) && esIpProhibida(literal)) return null;
  return absoluta;
}

/**
 * Si el anfitrion se puede leer como IP sin pasar por DNS.
 *
 * Un nombre nunca contiene `:` y casi nunca es solo digitos y puntos: del otro
 * lado, `::ffff:169.254.169.254` y `2130706433` si se leen como IP. El
 * hexadecimal (`0x7f000001`) no lo lee `esIpProhibida` como IPv4, pero tampoco
 * como nombre valido: falla cerrado y la imagen queda en `null` igual.
 */
function esLiteralNumerico(anfitrion: string): boolean {
  if (anfitrion.includes(':')) return true;
  if (/^[\d.]+$/.test(anfitrion)) return true;
  if (/^0[xX][\da-fA-F]+$/.test(anfitrion)) return true;
  return false;
}

/** La primera imagen del articulo, si hay articulo, o de la pagina. */
function imagenPrincipal(documento: DocumentoLeible, base: string): string | null {
  const enArticulo = documento.querySelector('article img, main img')?.getAttribute('src');
  // El `?.` da `undefined` cuando no hay `img` y `imagenUtilizable` pide
  // `string | null`: sin el `?? null` no typecheckea.
  const cualquiera = enArticulo ?? documento.querySelector('img')?.getAttribute('src') ?? null;
  return imagenUtilizable(cualquiera, base);
}

/* -------------------------------------------------------------- la funcion -- */

/** Metadata vacia: lo que se devuelve cuando no hay DOM del que leer. */
const METADATA_VACIA: MetadataDePagina = {
  title: null,
  siteName: null,
  description: null,
  imageUrl: null,
};

/**
 * Saca la metadata de una pagina.
 *
 * Nunca tira: sin DOM no hay metadata, y una pagina rota da campos en `null`,
 * no una excepcion.
 *
 * `url` es la URL **final** del fetch, no la que escribio la persona: las
 * imagenes relativas se resuelven contra ella, igual que en el extractor de
 * contenido.
 *
 * El DOM se construye **una sola vez**: los OG se leen del mismo documento
 * sobre el que corre Readability. Pasa antes por `limpiarParaElDom`, que no
 * toca `<meta>` ni `<title>` y baja una watch de YouTube de 1,4 MB a 23 KB.
 */
export function sacarmetadata(html: string, url: string): MetadataDePagina {
  const limpio = limpiarParaElDom(html);
  let ventana: VentanaLeible | null = null;
  try {
    ventana = new JSDOM(limpio, { url }).window;
  } catch {
    // Un `url` que no es URL: se lee sin base y lo relativo queda en `null`.
    ventana = null;
  }
  if (ventana === null) {
    try {
      ventana = new JSDOM(limpio).window;
    } catch {
      return METADATA_VACIA;
    }
  }

  try {
    const documento = ventana.document;
    let tituloDeReadability: string | null = null;
    let extracto: string | null = null;
    try {
      const articulo = new Readability(documento as never).parse();
      tituloDeReadability = primero(articulo?.title);
      extracto = primero(articulo?.excerpt);
    } catch {
      // Readability lanza sobre DOMs que rompen sus suposiciones. Sin titulo
      // ni extracto, no sin metadata: los OG se leen igual.
    }

    return fusionarMetadata({
      tituloDeReadability,
      extracto,
      tituloDePagina: primero(documento.title),
      ogTitulo: contenidoDe(documento, 'meta[property="og:title"], meta[name="og:title"]'),
      ogDescripcion: contenidoDe(
        documento,
        'meta[property="og:description"], meta[name="og:description"]',
      ),
      ogImagen: imagenUtilizable(
        contenidoDe(documento, 'meta[property="og:image"], meta[name="og:image"]'),
        url,
      ),
      ogSitio: contenidoDe(documento, 'meta[property="og:site_name"], meta[name="og:site_name"]'),
      twitterTitulo: contenidoDe(
        documento,
        'meta[name="twitter:title"], meta[property="twitter:title"]',
      ),
      twitterDescripcion: contenidoDe(
        documento,
        'meta[name="twitter:description"], meta[property="twitter:description"]',
      ),
      twitterImagen: imagenUtilizable(
        contenidoDe(documento, 'meta[name="twitter:image"], meta[property="twitter:image"]'),
        url,
      ),
      metaDescripcion: contenidoDe(documento, 'meta[name="description"]'),
      imagenPrincipal: imagenPrincipal(documento, url),
      url,
    });
  } catch {
    return METADATA_VACIA;
  } finally {
    // El DOM de una pagina real pesa decenas de MB: se cierra siempre.
    ventana.close();
  }
}

/* --------------------------------------------------------------- YouTube -- */

/** Lo que el oembed trae, que viaja como texto aunque sea JSON. */
interface RespuestaDeOembed {
  title?: unknown;
  thumbnail_url?: unknown;
}

/** El oembed no trae descripcion: un video se guarda sin ella. */
const MAX_BYTES_DE_OEMBED = 64_000;

/**
 * La metadata de un video de YouTube por `oembed`, sin API key.
 *
 * `https://www.youtube.com/oembed?url=<url>&format=json` no pide credencial y
 * devuelve titulo, autor y thumbnail. Si la respuesta no es un JSON con
 * `title`, se devuelve `null` y la metadata se arma con los OG del HTML, que
 * YouTube tambien trae.
 *
 * Va por `traerHtmlSeguro` y no por un `fetch` pelado: timeout por salto,
 * redirects revalidados y guard SSRF, que es lo mismo que protege la pagina.
 */
export async function metadataDeYoutube(url: string): Promise<MetadataDePagina | null> {
  const pedido = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const respuesta = await traerHtmlSeguro(pedido, { maxBytes: MAX_BYTES_DE_OEMBED });
  if (!respuesta.ok) return null;

  let cuerpo: RespuestaDeOembed;
  try {
    const parsed: unknown = JSON.parse(respuesta.html);
    if (typeof parsed !== 'object' || parsed === null) return null;
    cuerpo = parsed as RespuestaDeOembed;
  } catch {
    return null;
  }
  if (typeof cuerpo.title !== 'string' || cuerpo.title.trim() === '') return null;

  return {
    title: cuerpo.title.trim(),
    siteName: 'YouTube',
    description: null,
    imageUrl:
      typeof cuerpo.thumbnail_url === 'string'
        ? imagenUtilizable(cuerpo.thumbnail_url, url)
        : null,
  };
}
