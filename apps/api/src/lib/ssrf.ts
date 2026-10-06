import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';

import { esUrlQueSePuedePedir } from '../modules/sync/sync-service.js';

/**
 * El guard que decide si el servidor puede pedir una URL compartida.
 *
 * Una URL del share sheet es **input no confiable** y este proceso la va a
 * fetchear. Sin lo que hay abajo, basta con que una persona pegue una URL que
 * el atacante controla para que el servidor entre a una red a la que la persona
 * no tiene acceso: loopback, la red privada de la oficina, y
 * `169.254.169.254`, que en la nube devuelve las credenciales de la maquina.
 *
 * El riesgo no es "una URL rara": es que la validacion y la conexion sean dos
 * decisiones separadas. Por eso aca el DNS se resuelve, se mira **todas** las
 * direcciones que devuelve, y despues la conexion se hace **contra una IP
 * concreta** y no contra el nombre. Un nombre que cambia entre el chequeo y el
 * `connect` --que es lo que hace un atacante con un TTL de un segundo-- no tiene
 * donde colarse.
 *
 * Se usa `node:http`/`node:https` y no `fetch` a proposito. `fetch` resuelve el
 * nombre por su cuenta y dejarnos fijar a donde se conecta pide un `dispatcher`
 * de `undici`, que hoy en este repo solo existe como dependencia transitiva de
 * `jsdom` y no como dependencia declarada. Con `node:https` la IP fijada es la
 * unica direccion que hay en el socket, y esa propiedad no depende de que
 * alguien mantenga actualizado un `package.json`.
 */

const TIMEOUT_POR_DEFECTO_MS = 8_000;
const MAX_BYTES_POR_DEFECTO = 2_000_000;
const MAX_REDIRECTS_POR_DEFECTO = 3;

const ESTADOS_DE_REDIRECCION: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

export interface OpcionesDeBusqueda {
  /**
   * Por salto, no por llamada. Un salto es **resolver + connect + TLS + cuerpo**:
   * el reloj arranca antes de `dns.lookup` y lo cubre entero, porque el resolver
   * no se puede abortar. Con 3 redirects son 4 saltos, o sea 4 timers y un techo
   * de `4 x timeoutMs` en total.
   */
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export type ResultadoDeBusqueda =
  | { ok: true; html: string; finalUrl: string; bytes: number }
  | { ok: false; motivo: string };

/** Donde termina un salto: una IP ya validada, su familia y el nombre que hay que anunciarle. */
interface DestinoResuelto {
  url: URL;
  ip: string;
  familia: 4 | 6;
}

export type ResultadoDeDestino =
  | { ok: true; destino: DestinoResuelto }
  | { ok: false; motivo: string };

/**
 * Lo que hay que poder leer mientras se lee.
 *
 * En produccion es el `IncomingMessage` de `node:http`; en los tests es un
 * `ReadableStream` fabricado. Los dos son iterables async y los dos tienen una
 * forma de soltar lo que les quedo, que es lo que permite **dejar de leer** en
 * el momento en que se pasa el tope y no despues.
 */
export type CuerpoLegible = AsyncIterable<Uint8Array> & {
  cancel?: (reason?: unknown) => Promise<void>;
  destroy?: (error?: Error) => void;
};

/**
 * El motivo del corte por tamano, con el texto exacto que ve la persona.
 *
 * Va en ingles y es corto porque sale derecho a `extractionError` y lo lee
 * alguien: no es un codigo de error ni un stack trace, es una frase.
 */
export class CuerpoDemasiadoGrande extends Error {
  constructor() {
    super('the page is larger than the byte limit');
    this.name = 'CuerpoDemasiadoGrande';
  }
}

// ---------------------------------------------------------------------------
// Rangos prohibidos
// ---------------------------------------------------------------------------

interface RedV4 {
  red: number;
  mascara: number;
}

/**
 * Los rangos que no se piden, en bits y con la mascara explicita.
 *
 * Escribirlos con `startsWith` seria el error clasico: `172.16.0.1` y
 * `172.32.0.1` comparten el prefijo de texto `172.` y no comparten ni un bit de
 * `/12`. Con prefijo de texto se rechaza una red publica y se deja pasar una
 * privada, que es peor que no tener el filtro.
 *
 * | rango | por que |
 * | --- | --- |
 * | `0.0.0.0/8` | "any": en varias plataformas enruta a loopback |
 * | `127.0.0.0/8` | loopback: el propio servidor |
 * | `10.0.0.0/8` | red privada de una oficina o de una VPC |
 * | `172.16.0.0/12` | red privada de una oficina o de una VPC |
 * | `192.168.0.0/16` | red privada de una casa |
 * | `169.254.0.0/16` | metadatos de la nube: devuelve credenciales |
 */
const REDES_V4_PROHIBIDAS: readonly RedV4[] = [
  { red: 0x00000000, mascara: 0xff000000 }, // 0.0.0.0/8
  { red: 0x7f000000, mascara: 0xff000000 }, // 127.0.0.0/8
  { red: 0x0a000000, mascara: 0xff000000 }, // 10.0.0.0/8
  { red: 0xac100000, mascara: 0xfff00000 }, // 172.16.0.0/12
  { red: 0xc0a80000, mascara: 0xffff0000 }, // 192.168.0.0/16
  { red: 0xa9fe0000, mascara: 0xffff0000 }, // 169.254.0.0/16
];

function aNumeroV4(texto: string): number | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(texto)) return null;
  let numero = 0;
  for (const octeto of texto.split('.')) {
    const valor = Number(octeto);
    if (valor > 255) return null;
    numero = numero * 256 + valor;
  }
  return numero >>> 0;
}

function esNumeroV4Prohibido(numero: number): boolean {
  return REDES_V4_PROHIBIDAS.some(
    (r) => (numero & r.mascara) >>> 0 === (r.red & r.mascara) >>> 0,
  );
}

/**
 * Expande una IPv6 a sus 16 bytes, o `null` si el texto no se puede leer.
 *
 * A mano, porque `URL` no expande y normalizar el texto no alcanza: el chequeo
 * tiene que comparar bytes, no cadenas.
 */
function aBytesV6(texto: string): number[] | null {
  // `%eth0` es una zona, que solo tiene sentido local y nunca viaja.
  const sinZona = texto.split('%')[0] ?? '';
  if (sinZona === '') return null;

  const tercios = sinZona.split('::');
  if (tercios.length > 2) return null;

  const izquierda = tercios[0] === '' ? [] : (tercios[0] ?? '').split(':');
  const derecha =
    tercios.length === 2 ? (tercios[1] === '' ? [] : (tercios[1] ?? '').split(':')) : [];

  const grupos: number[] = [];
  for (const parte of [...izquierda, ...derecha]) {
    // `::ffff:127.0.0.1` son dos grupos hexadecimales escritos como IPv4.
    if (parte.includes('.')) {
      const embebida = aNumeroV4(parte);
      if (embebida === null) return null;
      grupos.push((embebida >>> 16) & 0xffff, embebida & 0xffff);
      continue;
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(parte)) return null;
    grupos.push(Number.parseInt(parte, 16));
  }

  const faltan = 8 - grupos.length;
  if (tercios.length === 2) {
    if (faltan < 1) return null;
    grupos.splice(izquierda.length, 0, ...new Array<number>(faltan).fill(0));
  } else if (faltan !== 0) {
    return null;
  }

  const bytes: number[] = [];
  for (const grupo of grupos) bytes.push((grupo >> 8) & 0xff, grupo & 0xff);
  return bytes;
}

/**
 * La IPv4 metida dentro de una IPv6, si la hay.
 *
 * `::ffff:0:0/96` (IPv4 mapeada) y `64:ff9b::/96` (NAT64) son dos notaciones
 * para la misma direccion IPv4. `::ffff:169.254.169.254` es pedir los metadatos
 * de la nube con otra notacion, asi que se deshace y se mira la IPv4 de verdad.
 */
function v4EmbebidaEn(bytes: readonly number[], byte: (i: number) => number): number | null {
  const sonCeros = (desde: number, hasta: number): boolean =>
    bytes.slice(desde, hasta).every((b) => b === 0);

  const mapeada = sonCeros(0, 10) && byte(10) === 0xff && byte(11) === 0xff;
  const nat64 =
    byte(0) === 0x00 &&
    byte(1) === 0x64 &&
    byte(2) === 0xff &&
    byte(3) === 0x9b &&
    sonCeros(4, 12);

  if (!mapeada && !nat64) return null;
  return ((byte(12) << 24) | (byte(13) << 16) | (byte(14) << 8) | byte(15)) >>> 0;
}

/**
 * Dice si una direccion IP no se puede pedir.
 *
 * **Falla cerrado**: una direccion que no se sabe leer se da por prohibida. Un
 * filtro que deja pasar lo que no entiende no es un filtro, es una lista de
 * excepciones que todavia no se escribio.
 *
 * Se exporta suelta porque la Task 4 la necesita para las imagenes de un
 * articulo, que son URLs de un tercero y se validan igual que la pagina.
 */
export function esIpProhibida(direccion: string): boolean {
  const comoV4 = aNumeroV4(direccion);
  if (comoV4 !== null) return esNumeroV4Prohibido(comoV4);

  const bytes = aBytesV6(direccion);
  if (bytes === null || bytes.length !== 16) return true;

  // Los 16 bytes existen, asi que el default no se usa nunca.
  const byte = (i: number): number => bytes[i] ?? 0;

  const embebida = v4EmbebidaEn(bytes, byte);
  if (embebida !== null) return esNumeroV4Prohibido(embebida);

  const esLoopback = byte(15) === 1 && bytes.slice(0, 15).every((b) => b === 0); // ::1
  const esSinEspecificar = bytes.every((b) => b === 0); // ::, el "any" de IPv6
  const esUniqueLocal = (byte(0) & 0xfe) === 0xfc; // fc00::/7
  const esLinkLocal = byte(0) === 0xfe && (byte(1) & 0xc0) === 0x80; // fe80::/10

  return esLoopback || esSinEspecificar || esUniqueLocal || esLinkLocal;
}

/**
 * La regla entera del DNS: **una sola direccion prohibida tumba el nombre**.
 *
 * Se exporta la regla y no solo el chequeo de una direccion porque "miro todas"
 * es justo la parte que se rompe en silencio. Un nombre con una A publica y una
 * AAAA a `169.254.169.254` es aceptable en apariencia, y si el codigo se queda
 * con la primera direccion de la lista se conecta ahi sin que ningun test de la
 * tabla de rangos lo note: la tabla prueba rangos, no esto.
 */
export function hayDestinoProhibido(
  direcciones: readonly { address: string }[],
): boolean {
  return direcciones.some((direccion) => esIpProhibida(direccion.address));
}

// ---------------------------------------------------------------------------
// Validacion de un salto
// ---------------------------------------------------------------------------

/**
 * Gana el que llega primero: el resolver, o el reloj de quien llama.
 *
 * `dns.lookup` es `getaddrinfo(3)` en el threadpool de libuv: **no acepta un
 * signal y Node no le puede poner timeout**. Contra un dominio cuyo nameserver
 * no contesta, la promesa no se resuelve en un tiempo que esta funcion pueda
 * acotar, y cada salto repite la espera.
 *
 * Eso no es una molestia, es un agujero: el pool de libuv tiene cuatro hilos por
 * defecto, asi que cuatro URLs hostiles concurrentes lo agotan y los lookups de
 * los demas modulos del proceso --la base de datos incluida-- empiezan a
 * encolar.
 *
 * **Perder la carrera no cancela el lookup.** El hilo se libera cuando el
 * sistema operativo se aburre con ese nameserver, que no es inmediato, y no hay
 * forma de pedirle que se aburra antes. Lo que se recupera es el control del
 * caller, que es lo que `timeoutMs` promete: el teto que el endpoint necesita no
 * necesita que los hilos del threadpool cooperen.
 *
 * `dns.Resolver` (c-ares) resolveria el problema en la raiz, y por eso esta
 * descartado: cambia la semantica de `lookup` respecto a `/etc/hosts` y a los
 * dominios de busqueda del sistema. Eso es un cambio de comportamiento, no un
 * arreglo.
 */
function esperarAlResolver(
  pendiente: Promise<LookupAddress[]>,
  signal: AbortSignal,
): Promise<LookupAddress[]> {
  return new Promise<LookupAddress[]>((resolve, reject) => {
    const alAbortar = (): void => reject(new Error('dns lookup abandoned'));

    if (signal.aborted) alAbortar();
    else signal.addEventListener('abort', alAbortar, { once: true });

    // Siempre con manejador, incluso cuando el reloj ya gano: si el lookup
    // rechaza despues, ese rechazo no puede quedar sin tocar.
    pendiente.then(
      (valor) => {
        signal.removeEventListener('abort', alAbortar);
        resolve(valor);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', alAbortar);
        reject(error);
      },
    );
  });
}

/**
 * Valida una URL y devuelve **a que IP se conecta**, no solo si se puede.
 *
 * Devolver la IP es el punto: el nombre se resuelve una vez, se mira todas las
 * direcciones que salieron, y el socket se abre contra una de ellas. Si el
 * nombre vuelve a cambiar entre este chequeo y el `connect`, el cambio no
 * importa porque el nombre ya no participa.
 *
 * `signal` es obligatorio a proposito. El resolver no se puede abortar, asi que
 * la unica forma de acotar cuanto se espera es que el que llama ponga el reloj
 * y esta funcion se deje ganar: un timeout opcional es exactamente como vuelve
 * el tiempo sin acotar.
 *
 * Se exporta porque el bucle de redirects la vuelve a usar en cada salto, y
 * porque es la unica forma de que un test la ejercite sin abrir un puerto.
 */
export async function comprobarDestinoSeguro(
  rawUrl: string,
  signal: AbortSignal,
): Promise<ResultadoDeDestino> {
  if (!esUrlQueSePuedePedir(rawUrl)) {
    return { ok: false, motivo: 'only http and https urls can be requested' };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, motivo: 'the url could not be parsed' };
  }

  // `URL` deja los corchetes de una IPv6 literal en `hostname`; el resolver no
  // los quiere y el rango se comprueba sobre lo que devolvio el resolver.
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (host === '') return { ok: false, motivo: 'the url has no host' };

  let direcciones: LookupAddress[];
  try {
    // `order: 'verbatim'` y no `verbatim: true`, que Node ya deprecado. El orden
    // no decide seguridad -- abajo se miran todas --, solo cual de las IPs
    // publicas se fija.
    direcciones = await esperarAlResolver(
      lookup(host, { all: true, order: 'verbatim' }),
      signal,
    );
  } catch {
    return { ok: false, motivo: 'the host does not resolve' };
  }

  // Una sola direccion prohibida tumba el nombre entero. Mirar solo la primera
  // deja el hueco clasico: un nombre con una A publica y una AAAA a `169.254`,
  // donde el `fetch` elige la que quiere.
  if (hayDestinoProhibido(direcciones)) {
    return { ok: false, motivo: 'dns resolves to a private address' };
  }

  const elegida = direcciones[0];
  if (elegida === undefined) return { ok: false, motivo: 'the host does not resolve' };

  return {
    ok: true,
    destino: { url, ip: elegida.address, familia: elegida.family === 6 ? 6 : 4 },
  };
}

/**
 * Resuelve la cabecera `location` de un redirect contra la URL actual.
 *
 * Solo resuelve. No valida, y esa separacion es a proposito: el bucle vuelve a
 * llamar a `comprobarDestinoSeguro` con el resultado, asi que el salto pasa por
 * el filtro de esquema, por la longitud, por el DNS y por los rangos **otra
 * vez**. Un `//169.254.169.254/x` relativo al protocolo sale de aqui como una
 * URL normal y se cae en el chequeo de rangos del siguiente salto.
 */
export function resolverSalto(
  location: string,
  actual: URL,
): { ok: true; url: string } | { ok: false; motivo: string } {
  let resuelto: URL;
  try {
    resuelto = new URL(location, actual);
  } catch {
    return { ok: false, motivo: 'the redirect points nowhere' };
  }
  return { ok: true, url: resuelto.href };
}

// ---------------------------------------------------------------------------
// Lectura con tope
// ---------------------------------------------------------------------------

/**
 * Lee el cuerpo entero y **corta en el momento en que se pasa el tope**.
 *
 * `content-length` no sirve: el servidor puede mentir, y contra una respuesta
 * infinita no manda nada. La unica forma de ganar contra un `curl` que no
 * termina es dejar de pedirle chunks, y por eso el corte va adentro del loop y
 * no despues de acumular.
 *
 * Se exporta para poder probarlo con un `ReadableStream` fabricado y endless,
 * sin abrir un puerto ni meter un punto de inyeccion en el guard.
 */
export async function leerCuerpoConTope(
  cuerpo: CuerpoLegible,
  maxBytes: number,
): Promise<{ texto: string; bytes: number }> {
  const trozos: Uint8Array[] = [];
  let bytes = 0;

  for await (const trozo of cuerpo) {
    bytes += trozo.length;
    if (bytes > maxBytes) {
      await soltarCuerpo(cuerpo);
      throw new CuerpoDemasiadoGrande();
    }
    trozos.push(trozo);
  }

  return { texto: Buffer.concat(trozos).toString('utf8'), bytes };
}

/** Suelta el cuerpo: si no se cancela, el peer sigue mandando bytes al pedo. */
async function soltarCuerpo(cuerpo: CuerpoLegible): Promise<void> {
  try {
    if (typeof cuerpo.cancel === 'function') await cuerpo.cancel();
    else cuerpo.destroy?.();
  } catch {
    // Soltar el cuerpo es una cortesia con el socket, no una parte del corte.
  }
}

// ---------------------------------------------------------------------------
// El request
// ---------------------------------------------------------------------------

function esHttps(url: URL): boolean {
  return url.protocol === 'https:';
}

function puertoDe(url: URL): number {
  if (url.port !== '') return Number(url.port);
  return esHttps(url) ? 443 : 80;
}

/**
 * Un solo request, contra la IP ya validada.
 *
 * `host` es la IP y `servername` es el nombre: por eso la conexion no puede
 * terminar en otra parte, y por eso el certificado se sigue validando contra el
 * nombre y no contra la IP. El `Host` se manda a mano porque si no Node lo arma
 * con `host`, y un `Host` con la IP delante rompe el sitio y delata el patron.
 *
 * `accept-encoding: identity` porque `node:http` no descomprime: sin esto el
 * `html` seria gzip crudo y el extractor leeria basura sin decir por que.
 */
function pedirUnSalto(destino: DestinoResuelto, signal: AbortSignal): Promise<IncomingMessage> {
  const { url, ip, familia } = destino;
  const usarHttps = esHttps(url);

  return new Promise<IncomingMessage>((resolve, reject) => {
    const peticion = (usarHttps ? https : http).request(
      {
        method: 'GET',
        host: ip,
        // La familia va explicita aunque `host` sea un literal y `net.connect`
        // la deduzca sola. Es defensa en profundidad: si alguien vuelve a poner
        // un nombre en `host`, la restriccion de familia sigue vigente en vez de
        // desaparecer con el nombre.
        family: familia,
        ...(usarHttps ? { servername: url.hostname.replace(/^\[/, '').replace(/\]$/, '') } : {}),
        port: puertoDe(url),
        path: `${url.pathname}${url.search}`,
        headers: {
          host: url.host,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'accept-encoding': 'identity',
          'user-agent': 'OrbitHubBot/1.0 (+bookmark extractor)',
        },
        // Sin agente compartido: un socket guardado se reutiliza y un socket
        // guardado es un socket que ya no sabe a que IP estaba abierto.
        agent: false,
        signal,
      },
      (respuesta) => resolve(respuesta),
    );
    peticion.on('error', reject);
    peticion.end();
  });
}

// ---------------------------------------------------------------------------
// El guard
// ---------------------------------------------------------------------------

function opcionesInvalidas(opciones: OpcionesDeBusqueda): boolean {
  return (
    (opciones.timeoutMs !== undefined &&
      (!Number.isFinite(opciones.timeoutMs) || opciones.timeoutMs <= 0)) ||
    (opciones.maxBytes !== undefined &&
      (!Number.isInteger(opciones.maxBytes) || opciones.maxBytes <= 0)) ||
    (opciones.maxRedirects !== undefined &&
      (!Number.isInteger(opciones.maxRedirects) || opciones.maxRedirects < 0))
  );
}

/**
 * Trae el HTML de una URL compartida, si el servidor puede pedirla.
 *
 * El bucle de redirects es el corazon del asunto. Con `redirect: 'follow'`--o
 * con `fetch` y la promesa de que revalida-- el primer request se valida y el
 * segundo va a donde quiera el `Location`. Aca cada salto vuelve a pasar por
 * `comprobarDestinoSeguro` entero, y un `Location` a `169.254.169.254` se cae en
 * el primer `continue`.
 *
 * El timeout es **por salto**, y un salto es resolver + connect + TLS + cuerpo.
 * El reloj arranca **antes** del resolver porque `dns.lookup` no se puede
 * abortar, y si arrancara despues el tiempo de espera contra un nameserver que
 * no contesta no lo acota nadie. Con 3 redirects son hasta 4 x 8 s = 32 s: ese
 * total lo acota el endpoint (Task 4), no esta funcion.
 *
 * Nunca tira. `traerHtmlSeguro` devuelve siempre un resultado, porque el motivo
 * va derecho a `extractionError` y lo lee una persona.
 */
export async function traerHtmlSeguro(
  rawUrl: string,
  opciones: OpcionesDeBusqueda = {},
): Promise<ResultadoDeBusqueda> {
  if (opcionesInvalidas(opciones)) {
    return { ok: false, motivo: 'the search options are not valid' };
  }
  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS;
  const maxBytes = opciones.maxBytes ?? MAX_BYTES_POR_DEFECTO;
  const maxRedirects = opciones.maxRedirects ?? MAX_REDIRECTS_POR_DEFECTO;

  let actual = rawUrl;

  for (let salto = 0; ; salto += 1) {
    // **Un solo controlador por salto, y arranca antes del resolver.** Esa es
    // la parte que faltaba: `dns.lookup` no se puede abortar, asi que si el
    // reloj empieza despues de await el lookup, contra un nameserver que no
    // contesta el caller se queda esperando lo que tarde el resolver del
    // sistema y `timeoutMs` no acota nada. El `try` arranca con el reloj por el
    // mismo motivo: si empezara despues, el `finally` que lo limpia no
    // alcanzaria a cubrir la fase de resolver.
    const controller = new AbortController();
    let seAgotoElTiempo = false;
    const reloj = setTimeout(() => {
      seAgotoElTiempo = true;
      controller.abort();
    }, timeoutMs);

    try {
      const chequeo = await comprobarDestinoSeguro(actual, controller.signal);
      // Si el reloj gano la carrera contra el resolver, el motivo honesto es el
      // del reloj y no "no resuelve": son dos fallas distintas para quien lee.
      if (!chequeo.ok) {
        return {
          ok: false,
          motivo: seAgotoElTiempo ? 'the request timed out' : chequeo.motivo,
        };
      }
      const destino = chequeo.destino;

      let respuesta: IncomingMessage;
      try {
        respuesta = await pedirUnSalto(destino, controller.signal);
      } catch {
        return { ok: false, motivo: seAgotoElTiempo ? 'the request timed out' : 'the request failed' };
      }

      const estado = respuesta.statusCode ?? 0;

      if (ESTADOS_DE_REDIRECCION.has(estado)) {
        const location = respuesta.headers.location;
        respuesta.destroy();
        if (location === undefined) {
          return { ok: false, motivo: 'the redirect has no destination' };
        }
        if (salto >= maxRedirects) {
          return { ok: false, motivo: 'too many redirects' };
        }
        const saltoResuelto = resolverSalto(location, destino.url);
        if (!saltoResuelto.ok) return { ok: false, motivo: saltoResuelto.motivo };
        // Vuelve al principio del `for`: se revalida desde el filtro de esquema.
        actual = saltoResuelto.url;
        continue;
      }

      if (estado < 200 || estado >= 300) {
        respuesta.destroy();
        return { ok: false, motivo: `the page answered ${estado}` };
      }

      const codificacion = respuesta.headers['content-encoding'];
      if (codificacion !== undefined && codificacion !== 'identity') {
        respuesta.destroy();
        return { ok: false, motivo: 'the page is compressed and cannot be read' };
      }

      try {
        const cuerpo = await leerCuerpoConTope(respuesta, maxBytes);
        return {
          ok: true,
          html: cuerpo.texto,
          finalUrl: destino.url.href,
          bytes: cuerpo.bytes,
        };
      } catch (error) {
        respuesta.destroy();
        if (error instanceof CuerpoDemasiadoGrande) {
          return { ok: false, motivo: error.message };
        }
        return { ok: false, motivo: seAgotoElTiempo ? 'the request timed out' : 'the request failed' };
      }
    } finally {
      clearTimeout(reloj);
    }
  }
}
