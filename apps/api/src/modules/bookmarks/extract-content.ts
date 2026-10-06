/**
 * El contenido de un articulo: lo que Readability saca de una pagina, reducido
 * al formato de documento de las notas.
 *
 * Las dos mitades estan aqui porque son el mismo problema. La primera es
 * encontrar el articulo —Readability, que es lo unico que hay— y la segunda es
 * que **Readability nunca devuelve un documento valido**: el formato de las
 * notas es un conjunto cerrado de tags definido por lo que el editor acepta
 * (`packages/contracts/src/note-document.ts`), y el spike fallo el validador en
 * **5 de 5** paginas, con el 57,5 % de los elementos de Wikipedia fuera del
 * conjunto. Un sitio con tags que nadie preve (`gu-island`, `source`, `svg`, y
 * `sup` ciento veintiuna veces) vuelve imposible escribir la lista de tags a
 * reducir: se reduce **por default**, desarrollando lo que no se reconoce.
 *
 * **La regla que el spike cobro cara: reducir es desarrollar, no descartar.** Al
 * desenvolver cada tag conservando hijos y texto sobrevive el 99,8 % del texto de
 * un articulo real. Si se descarta el tag entero, se tira prosa que el usuario
 * guardo a proposito.
 *
 * Y con un detalle que parece pequeno y no lo es: desarrollar tiene que ser
 * **envolviendo el texto suelto en `<p>`**. El tokenizador del contrato es
 * estricto y sin DOM, y su comentario dice lo que cambia el algoritmo: *"A tag
 * it cannot read is reported as a `close`, which the walk below then fails on,
 * so an unreadable input is rejected rather than silently skipped."* Si
 * `<sup>[1]</sup>` se desarrolla a `[1]` suelto, ese texto queda fuera de todo
 * tag permitido y el validador **rechaza el documento entero**, porque el
 * formato no tiene un nodo de texto en la raiz. Son dos algoritmos que se
 * parecen en el papel y dan resultados opuestos.
 *
 * Al final, igual, el que decide es `noteDocumentSchema`: la reduccion es un
 * intento y el validador es la frontera. Por eso el extractor no necesita una
 * frontera de seguridad nueva, y por eso un documento que no pasa no se guarda.
 */

import { Readability } from '@mozilla/readability';
import { noteDocumentSchema, noteDocumentToPlainText } from '@orbit-hub/contracts';

// @ts-expect-error jsdom no trae tipos, y no se instalan: ver la nota de tipos de mas abajo.
import * as jsdom from 'jsdom';

/* ------------------------------------------------------------------ tipos -- */

/**
 * El trozo de DOM que usa esta reduccion, declarado aca.
 *
 * `jsdom` no trae tipos y la API **no tiene `lib.dom` a proposito**: es un
 * servidor, y meterle los globales del navegador al proyecto entero haria que
 * `document` typecheckeara en cualquier archivo y revantara en produccion. O sea
 * que en vez de dejar `any` repartido, esta interfaz declara la superficie que el
 * extractor toca, que son doce metodos, y si manana hace falta uno mas el
 * typecheck lo dice en vez de dejar pasar un `undefined`.
 */
interface Nodo {
  readonly nodeType: number;
  readonly nodeValue: string | null;
  readonly tagName: string;
  readonly childNodes: Iterable<Nodo>;
  readonly parentNode: Nodo | null;
  readonly firstChild: Nodo | null;
  readonly nextSibling: Nodo | null;
  innerHTML: string;
  appendChild(hijo: Nodo): Nodo;
  before(hermano: Nodo): void;
  replaceWith(...nodos: Nodo[]): void;
  getAttribute(nombre: string): string | null;
  setAttribute(nombre: string, valor: string): void;
  querySelectorAll(selector: string): Iterable<Nodo>;
}

interface Documento {
  createElement(etiqueta: string): Nodo;
  createTextNode(datos: string): Nodo;
}

/** La ventana que construye jsdom: ahi vive el `document` y ahi se cierra. */
interface Ventana {
  readonly document: Documento;
  /** Libera los timers del DOM: sin esto, cada extraccion deja handles vivos. */
  close(): void;
}

interface JSDOMComoSeUsa {
  new (html: string, opciones?: { url?: string }): { readonly window: Ventana };
}

const { JSDOM } = jsdom as unknown as { JSDOM: JSDOMComoSeUsa };

/** `Node.TEXT_NODE` y `Node.ELEMENT_NODE`, sin depender de un DOM global. */
const NODO_TEXTO = 3;
const NODO_ELEMENTO = 1;

/* ------------------------------------------------------------ el formato -- */

/**
 * Los tags del formato de documento, duplicados aca.
 *
 * El contrato no exporta el conjunto cerrado, asi que esta lista es una copia.
 * **Y que sea una copia no es un problema**, por dos razones que conviene tener
 * presentes antes de querer "arreglarla": el validador es la frontera y se ejecuta
 * igual, asi que una lista desfasada no deja pasar nada invalido; y si el
 * contrato suma un tag, este archivo no lo pierde, porque el tag nuevo cae en
 * "desarrollar" y su texto sobrevive igual. Lo que se perderia es el formato, no
 * la prosa.
 */
const PERMITIDAS: ReadonlySet<string> = new Set<string>([
  // En linea.
  'b', 'i', 'u', 's', 'code', 'a', 'img', 'br',
  // Parrafo entero.
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'codeblock',
  // Listas.
  'ul', 'ol', 'li',
  'p',
]);

/**
 * Tags que se renombran en vez de desarrollarse.
 *
 * Son los que el editor ya tiene con otro nombre, y el mapeo es el que probo el
 * spike: `pre -> codeblock` es el que permite guardar un bloque de codigo, y
 * `em -> i` / `strong -> b` es lo que evita dejar la enfasis suelta.
 */
const RENOMBRES: Readonly<Record<string, string>> = {
  em: 'i',
  strong: 'b',
  del: 's',
  strike: 's',
  ins: 'u',
  pre: 'codeblock',
};

/**
 * Lo que se borra **con su contenido**, porque su contenido no es prosa.
 *
 * El caso obvio es `script`, `style` y `noscript`. Los demas son cosas cuyo
 * texto es un comando, una coordenada o un boton: `svg` y `path` dibujan, `form`
 * es una interfaz, `source` y `track` son punteros a otro archivo, y `math` es
 * la misma formula que Wikipedia ya entrega en un `img alt`. Todo lo que no esta
 * aca **se desarrolla**, que es la regla.
 */
const DESCARTADOS: ReadonlySet<string> = new Set<string>([
  'script', 'style', 'noscript', 'template',
  'svg', 'math', 'canvas',
  'iframe', 'object', 'embed', 'applet', 'frame', 'frameset',
  'form', 'input', 'select', 'textarea', 'button', 'option', 'optgroup', 'datalist',
  'video', 'audio', 'source', 'track', 'param', 'map', 'area',
  'col', 'colgroup',
  'head', 'meta', 'link', 'base', 'title',
]);

/** Tags cuyo contenido es texto del documento, donde un nodo suelto es legal. */
const CONTENEDOR_DE_TEXTO: ReadonlySet<string> = new Set<string>([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'codeblock', 'li',
]);

/**
 * Tags que abren un bloque, para el colapso del paso final.
 *
 * La lista es de bloque y no de texto: `<p><ul>` se deja como esta, porque una
 * lista anidada es un formato que el editor compone, y `li > p` es comun en
 * paginas reales. Lo que no puede quedar es un parrafo dentro de un parrafo.
 */
const BLOQUE: ReadonlySet<string> = new Set<string>([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'codeblock', 'ul', 'ol',
]);

/** El mismo tope que el contrato, para no mandar una medida que sera rechazada. */
const MAX_EDGE_DE_IMAGEN = 16384;

/** `length` de un `alt`, para que una pagina con una descripcion enorme no infle la nota. */
const MAX_ALT = 300;

/**
 * Los esquemas de un `href` que se guardan.
 *
 * `javascript:`, `data:` y `vbscript:` no son enlaces: son codigo. El contrato no
 * los restringe —es una pregunta abierta de la spec— y filtrarlos aqui sale
 * gratis mientras el texto del enlace sobrevive. Un `a` sin href escribible no
 * puede guardarse en el formato (`<a> needs an href`), asi que se desarrolla con
 * su texto: se pierde el enlace, no la frase.
 */
const ESQUEMAS_DE_ENLACE = /^(?:https?:|mailto:|tel:)/i;

/**
 * Los esquemas de un `src` que se guardan.
 *
 * Solo `http` y `https`, a diferencia del `href`. La razon es que `data:` en un
 * `src` no ejecuta nada, pero **cabe un documento entero dentro de la nota** y no
 * hay ningun motivo para pagarlo: si una imagen es un archivo, tiene una URL.
 */
const ESQUEMAS_DE_IMAGEN = /^https?:\/\//i;

/**
 * Cuantas palabras tiene que tener algo para ser un articulo.
 *
 * Sin este numero, limpiar `<script>` antes de construir el DOM —que es la
 * optimizacion mas grande que midio el spike, hasta 7x— **empeora la senal**: una
 * watch de YouTube deja de devolver `null` y devuelve nueve palabras ("(c) 2026
 * Google LLC, YouTube, una empresa de Google"). Un `ready` con nueve palabras es
 * **peor** que un `metadata_only`, porque parece que se leyo el articulo y no se
 * leyo.
 *
 * 50 es un numero, no una regla, asi que va con el motivo: el articulo mas corto
 * que funciono en el spike dio 947 palabras, y las nueve palabras de YouTube estan
 * un orden de magnitud por debajo del piso. Quien quiera bajarlo deberia traer el
 * caso que lo justifica.
 */
const PALABRAS_MINIMAS = 50;

/* ------------------------------------------------------------ la limpieza -- */

const COMENTARIOS_Y_DECLARACIONES = /<!--[\s\S]*?(?:-->|$)/g;
const SCRIPT_ESTILO_Y_NOSCRIPT = /<(script|style|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
const ETIQUETAS_LINK = /<link\b[^>]*>/gi;
const ESTILO_EN_LINEA = /\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

/**
 * Borra lo que no es prosa **antes** de construir el DOM.
 *
 * Es la optimizacion mas grande que midio el spike: **hasta 7x mas rapido y la
 * mitad de memoria**, porque en una pagina real el peso del HTML no esta en el
 * texto sino en las cadenas de JavaScript. En la watch de YouTube, 1,4 MB de los
 * 1,4 MB, en 53 scripts.
 *
 * **Por que antes y no despues**: borrarlos con una regex sobre el crudo es gratis
 * y evita pagar el parser entero. Con el DOM ya construido el trabajo ya esta
 * pagado, y bajar 1,4 MB de cadenas seria comparar cadenas.
 *
 * **Y por que una regex alcanza**: el objetivo aca es *reducir trabajo*, no ser la
 * frontera de seguridad. Una regex falla —un `<script>` dentro de un atributo o de
 * un comentario, una etiqueta sin cerrar— y por eso **esta funcion no es la
 * defensa**: la defensa es el `noteDocumentSchema.parse` del final, que corre
 * sobre un documento que ya no tiene por donde colarse un script. Quien lea esto
 * y lo tome por el filtro de XSS se equivoco de archivo.
 *
 * Se exporta suelta porque el test que prueba que la limpieza ocurre **antes** del
 * DOM no puede verla de otra manera: desde afuera, `extraerContenido` no expone el
 * HTML que se le paso a jsdom.
 */
export function limpiarParaElDom(html: string): string {
  return html
    .replace(COMENTARIOS_Y_DECLARACIONES, '')
    .replace(SCRIPT_ESTILO_Y_NOSCRIPT, '')
    .replace(ETIQUETAS_LINK, '')
    .replace(ESTILO_EN_LINEA, '');
}

/* ---------------------------------------------------------------- el URL -- */

/**
 * Una URL de la pagina, resuelta contra la pagina.
 *
 * Es donde `url` se vuelve necesario: sin el, un `src="imagen.png"` de un sitio
 * con redirect queda apuntando a un relative, y la nota guarda una imagen que no
 * dibuja nada. Es el unico acoplamiento entre el guard de la Task 2 y este
 * archivo, y por eso el endpoint tiene que pasarle la **URL final**, no la que
 * escribio la persona.
 */
function resolver(valor: string | null, base: string): string | null {
  if (valor === null) return null;
  const recortado = valor.trim();
  if (recortado === '') return null;
  try {
    return new URL(recortado, base).toString();
  } catch {
    // Un `src` que no es URL ni relativa (una plantilla sin interpolar) se
    // descarta, porque el validador exige que `img` tenga `src`.
    return null;
  }
}

/** Una medida de imagen, o `null` si el validador la va a rechazar. */
function enteroDeImagen(valor: string | null): string | null {
  if (valor === null) return null;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0 || numero > MAX_EDGE_DE_IMAGEN) return null;
  return String(numero);
}

/* ------------------------------------------------------------ la reduccion -- */

/**
 * Estado de la recursion, para saber si el ultimo hijo admite mas texto.
 *
 * El texto suelto se fusiona con el parrafo abierto: 862 celdas de navbox que se
 * convierten en 862 parrafos son un documento que el movil no puede mostrar
 * comodo, y el spike midio como un algoritmo sin fusionar iba de 93 `<p>` a 418.
 */
interface Estado {
  /** El `<p>` que se abrio para texto suelto y que todavia admite mas texto. */
  parrafoAbierto: Nodo | null;
}

function agregar(estado: Estado, destino: Nodo, nodo: Nodo): void {
  destino.appendChild(nodo);
  if (nodo !== estado.parrafoAbierto) estado.parrafoAbierto = null;
}

/**
 * Suelta la prosa que no quedo dentro de ningun tag permitido, **dentro de un
 * `<p>`**.
 *
 * Esta es la funcion de la que depende toda la tarea. Si el texto suelto se
 * soltaba en vez de envolverse, el validador rechaza el documento entero.
 */
function envolverEnParrafo(estado: Estado, destino: Nodo, texto: string, documento: Documento): void {
  const abierto = estado.parrafoAbierto;
  if (abierto !== null && abierto.parentNode === destino) {
    abierto.appendChild(documento.createTextNode(texto));
    return;
  }
  const parrafo = documento.createElement('p');
  parrafo.appendChild(documento.createTextNode(texto));
  agregar(estado, destino, parrafo);
  estado.parrafoAbierto = parrafo;
}

/** Copia los hijos de `origen` en `destino`, reduciendo cada uno. */
function copiarHijos(
  origen: Nodo,
  destino: Nodo,
  dentroDeTexto: boolean,
  documento: Documento,
  estado: Estado,
  base: string,
): void {
  // Copiado a un array: `appendChild` mueve el nodo, y mover mientras se itera la
  // lista viva es la forma mas corta de saltarse la mitad de los hijos.
  for (const hijo of [...origen.childNodes]) {
    reducir(hijo, dentroDeTexto, documento, destino, estado, base);
  }
}

/**
 * Un `<table>` se aplana a filas de `<p>` separadas por ` | `.
 *
 * `table`, `tbody`, `tr`, `td` y `th` no estan en el conjunto cerrado, y
 * desarrollarlos a secas deja cada celda en su propio parrafo: los 215 palabras
 * del navbox de Wikipedia sobreviven, pero el documento queda hecho de 215
 * parrafos de una palabra. Una fila es una linea, y con ` | ` se lee como la
 * tabla que era.
 *
 * **`tagName` va en mayusculas y no se compara en minusculas.** Es una trampa
 * silenciosa y carisima: el filtro de celdas no encuentra ninguna, cada fila sale
 * por `continue`, y la tabla entera —con su texto y sus siete imagenes— se
 * pierde sin que nada falle. No hay excepcion ni aviso: el documento sale
 * valido y corto. Por eso las celdas se comparan con `TD` y `TH` de verdad, y
 * por eso hay un test que mira una tabla.
 */
function aplanarTabla(
  tabla: Nodo,
  documento: Documento,
  destino: Nodo,
  estado: Estado,
  base: string,
): void {
  for (const fila of [...tabla.querySelectorAll('tr')]) {
    const celdas = [...fila.childNodes].filter(
      (nodo) =>
        nodo.nodeType === NODO_ELEMENTO &&
        (nodo.tagName === 'TD' || nodo.tagName === 'TH'),
    );
    if (celdas.length === 0) continue;

    const parrafo = documento.createElement('p');
    agregar(estado, destino, parrafo);

    for (const [indice, celda] of celdas.entries()) {
      if (indice > 0) parrafo.appendChild(documento.createTextNode(' | '));
      copiarHijos(celda, parrafo, true, documento, estado, base);
    }
  }
}

/**
 * Reduce un nodo de la pagina a los tags del formato.
 *
 * La recursion es una regla y cuatro salidas: lo permitido se copia con sus
 * atributos, lo que tiene otro nombre se renombra, lo que no es prosa se borra, y
 * **todo lo demas se desarrolla**, es decir, se sustituye por sus hijos. Lo que se
 * desarrolla puede dejar texto sin tag padre, y ese texto se envuelve en `<p>`: es
 * el paso que el validador exige, y el que hace que dos algoritmos que se parecen
 * en el papel den resultados opuestos.
 */
function reducir(
  nodo: Nodo,
  dentroDeTexto: boolean,
  documento: Documento,
  destino: Nodo,
  estado: Estado,
  base: string,
): void {
  if (nodo.nodeType === NODO_TEXTO) {
    const texto = nodo.nodeValue ?? '';
    if (dentroDeTexto) {
      destino.appendChild(documento.createTextNode(texto));
      return;
    }
    // Entre bloques el espacio no significa nada; dentro de un texto, si.
    if (texto.trim() === '') return;
    envolverEnParrafo(estado, destino, texto, documento);
    return;
  }

  // Comentarios, instrucciones de proceso y cualquier otra cosa que no sea un
  // elemento: el tokenizador del contrato los rechaza ("comments and declarations
  // are not part of the format"), asi que no pueden llegar.
  if (nodo.nodeType !== NODO_ELEMENTO) return;

  const etiqueta = nodo.tagName.toLowerCase();
  if (DESCARTADOS.has(etiqueta)) return;
  if (etiqueta === 'table') {
    aplanarTabla(nodo, documento, destino, estado, base);
    return;
  }

  const nombre = PERMITIDAS.has(etiqueta) ? etiqueta : RENOMBRES[etiqueta] ?? null;

  // **La rama del algoritmo bueno.** Sin tag reconocido, el tag desaparece y sus
  // hijos pasan al mismo lugar. Es lo que hace que sobrevivan ciento veintiun
  // `<sup>`, los creditos de foto de un `<figcaption>` y el `gu-island` del
  // Guardian.
  if (nombre === null) {
    copiarHijos(nodo, destino, dentroDeTexto, documento, estado, base);
    return;
  }

  if (nombre === 'br') {
    agregar(estado, destino, documento.createElement('br'));
    return;
  }

  if (nombre === 'img') {
    const src = resolver(nodo.getAttribute('src'), base);
    // Sin `src` —o con un `src` que no sea una URL— el `img` no se guarda: el
    // validador exige que tenga uno, y una imagen sin archivo no es una imagen.
    if (src === null || !ESQUEMAS_DE_IMAGEN.test(src)) return;
    const imagen = documento.createElement('img');
    imagen.setAttribute('src', src);
    const alt = nodo.getAttribute('alt');
    if (alt !== null && alt.trim() !== '') imagen.setAttribute('alt', alt.slice(0, MAX_ALT));
    const ancho = enteroDeImagen(nodo.getAttribute('width'));
    const alto = enteroDeImagen(nodo.getAttribute('height'));
    if (ancho !== null) imagen.setAttribute('width', ancho);
    if (alto !== null) imagen.setAttribute('height', alto);
    agregar(estado, destino, imagen);
    return;
  }

  if (nombre === 'a') {
    const href = resolver(nodo.getAttribute('href'), base);
    if (href === null || !ESQUEMAS_DE_ENLACE.test(href)) {
      // Sin href escribible el `a` se desarrolla: el texto es lo que se guarda.
      copiarHijos(nodo, destino, dentroDeTexto, documento, estado, base);
      return;
    }
    const enlace = documento.createElement('a');
    enlace.setAttribute('href', href);
    agregar(estado, destino, enlace);
    copiarHijos(nodo, enlace, true, documento, estado, base);
    return;
  }

  // Todo lo demas no lleva ningun atributo. El contrato lo dice sin excepciones
  // utiles (`ATTRIBUTE_FREE` en `note-document.ts:64`): una nota no lleva
  // presentacion propia, toma el tema. Las dos unicas excepciones del formato son
  // el `href` de `a` y el `src`, `alt`, `width` y `height` de `img`, que ya se
  // escribieron arriba.
  //
  // Lo que tambien se va por el camino es `ul[data-type=checkbox]` y
  // `li[checked]`: existen para las listas de tareas del editor, y una pagina de
  // internet no trae una. Si alguna vez hace falta, la regla esta en el contrato.
  const nuevo = documento.createElement(nombre);
  agregar(estado, destino, nuevo);
  copiarHijos(nodo, nuevo, dentroDeTexto || CONTENEDOR_DE_TEXTO.has(nombre), documento, estado, base);
}

/**
 * Colapsa los `<p>` que quedaron dentro de otros `<p>`.
 *
 * Aplanar tablas y desarrollar pueden dejar un bloque dentro de un parrafo, y el
 * formato no lo admite. Se sube el contenido del hijo al padre con un espacio de
 * por medio —**con** espacio, porque dos parrafos de una celda pegados sin el
 * quedan "celdaunacelda" y se pierden dos palabras— y se sigue bajando, porque el
 * hijo subido puede traer otro `<p>` adentro.
 */
function colapsarParrafos(raiz: Nodo, documento: Documento): void {
  for (const parrafo of [...raiz.querySelectorAll('p')]) {
    let hijo = parrafo.firstChild;
    while (hijo !== null) {
      const siguiente = hijo.nextSibling;
      if (hijo.nodeType === NODO_ELEMENTO && BLOQUE.has(hijo.tagName.toLowerCase())) {
        if (parrafo.firstChild !== hijo) hijo.before(documento.createTextNode(' '));
        hijo.replaceWith(...[...hijo.childNodes]);
      }
      hijo = siguiente;
    }
  }
}

/**
 * El `content` de Readability, reducido al formato de documento.
 *
 * Se parsea en el **mismo** DOM que la pagina, en un `div` aparte, en vez de
 * construir un segundo `JSDOM`: el parser de fragmentos de jsdom mantiene `<tr>`
 * y `<td>` dentro de un `div` (comprobado), y con el mismo DOM la segunda
 * instancia no se paga.
 */
function reducirContenido(contenido: string, documento: Documento, base: string): string {
  const entrada = documento.createElement('div');
  entrada.innerHTML = contenido;
  const salida = documento.createElement('div');
  const estado: Estado = { parrafoAbierto: null };

  copiarHijos(entrada, salida, false, documento, estado, base);
  colapsarParrafos(salida, documento);

  return salida.innerHTML;
}

/* ------------------------------------------------------------- el resultado -- */

/** Lo que se guarda de un articulo, y nada mas. */
export interface ContenidoExtraido {
  /** El documento, ya validado con `noteDocumentSchema`. */
  document: string;
  /**
   * El texto del documento, derivado con `noteDocumentToPlainText`.
   *
   * **No se reimplementa**: el indice trigram de `bookmarks.plain_text`
   * (migracion `0022`) se construye sobre este texto, y dos implementaciones
   * divergen en la busqueda sin que nadie lo note hasta que un usuario pregunta
   * por un resultado que existe.
   */
  plainText: string;
  /** El titulo que dio Readability, si dio alguno. */
  titulo: string | null;
  /**
   * El mismo texto que `plainText`, con el nombre que usa el que decide.
   *
   * Son **el mismo string** y no dos: la razon de que esten los dos es que quien
   * guarda decide mirando palabras (`texto`) y quien busca mira el texto del
   * documento (`plainText`). Un solo valor, dos nombres, y una sola
   * implementacion.
   */
  texto: string;
}

export type ResultadoDeContenido =
  | { ok: true; contenido: ContenidoExtraido }
  /** `not an article`, `too short` o `unreadable`. */
  | { ok: false; motivo: string };

function contarPalabras(texto: string): number {
  return texto.split(/\s+/).filter(Boolean).length;
}

/**
 * Saca el articulo de una pagina y lo deja en el formato de las notas.
 *
 * Nunca tira. El motivo va derecho a `extractionError` y lo lee una persona, asi
 * que un HTML que no es HTML tiene que ser un resultado y no una excepcion.
 *
 * `url` es la URL **final** del fetch, no la que escribio la persona: las
 * imagenes relativas de un sitio con redirect se resuelven contra ella.
 *
 * Es `async` por contrato con el endpoint, no porque await algo: Readability es
 * sincrono y la reduccion tambien. Se cambia cuando haga falta.
 */
export async function extraerContenido(html: string, url: string): Promise<ResultadoDeContenido> {
  let ventana: Ventana;
  try {
    // **Sin `runScripts`.** El spike pidio `outside-only` y la razon era no
    // ejecutar el JavaScript de una pagina que no es nuestra. Omitir la opcion
    // cumple eso mas fuerte que `outside-only`: no arma contexto de scripts, no
    // compila nada y no deja nada compilable, mientras que `outside-only` si
    // compila el contenido de los `<script>` para que `window.eval` pueda
    // llamarlo. O sea que la desviacion respecto del spike es **hacia la parte
    // restrictiva**, no hacia la floja.
    //
    // Y no se pone un numero de milisegundos aqui a proposito: se midio y la
    // diferencia no existe (la watch de YouTube, caliente, da 42-54 ms con el
    // default contra 42-48 ms con `outside-only`, y en la corrida fria el default
    // salio **peor**). El borrador de este archivo afirmaba "41 ms contra 54 ms";
    // era una sola muestra, sin decir como estaba caliente la maquina, y no se
    // reproduce. Una medicion que no se reproduce no va en un comentario, porque
    // el proximo la va a leer como una razon y va a decidir por algo que no esta
    // medido.
    ventana = new JSDOM(limpiarParaElDom(html), { url }).window;
  } catch {
    // Un `url` que no es URL, o un HTML que no se puede parsear. Sin DOM no hay
    // articulo, y sin articulo no hay motivo mejor que este.
    return { ok: false, motivo: 'unreadable' };
  }

  try {
    const articulo = new Readability(ventana.document).parse();
    const contenido = articulo?.content;
    if (typeof contenido !== 'string' || contenido.trim() === '') {
      return { ok: false, motivo: 'not an article' };
    }

    // **El paso que decide.** La reduccion es un intento; el validador es la
    // frontera. Si lo que salio no pasa, no se guarda: se guarda la metadata y
    // nada mas (Task 4). Es preferible un enlace sin texto a un documento
    // invalido, porque el documento invalido es el que el editor movil no
    // sanea.
    const reduccion = reducirContenido(contenido, ventana.document, url);
    const validado = noteDocumentSchema.safeParse(reduccion);
    if (!validado.success) return { ok: false, motivo: 'unreadable' };

    const plainText = noteDocumentToPlainText(validado.data);
    if (contarPalabras(plainText) < PALABRAS_MINIMAS) {
      return { ok: false, motivo: 'too short' };
    }

    const titulo = articulo?.title?.trim();
    return {
      ok: true,
      contenido: {
        document: validado.data,
        plainText,
        titulo: titulo !== undefined && titulo !== '' ? titulo : null,
        texto: plainText,
      },
    };
  } catch {
    // Readability lanza sobre paginas que rompen sus propias suposiciones
    // (una que se haya autoeditado a mitad de lectura, un `<table>` anidado como
    // nadie lo quiere). Es una excepcion de una libreria de terceros y no vale
    // una peticion fallada.
    return { ok: false, motivo: 'unreadable' };
  } finally {
    // El DOM de una pagina real pesa 25 a 56 MB. Sin cerrar la ventana, cada
    // extraccion deja timers vivos y el pico de concurrencia se come el
    // contenedor.
    ventana.close();
  }
}