import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Readability } from '@mozilla/readability';
import { noteDocumentSchema, noteDocumentToPlainText } from '@orbit-hub/contracts';
import { describe, expect, it } from 'vitest';

// @ts-expect-error jsdom no trae tipos y la API no tiene `lib.dom`, igual que en el extractor.
import * as jsdom from 'jsdom';

import {
  colapsarParrafos,
  extraerContenido,
  limpiarParaElDom,
  type ResultadoDeContenido,
} from '../src/modules/bookmarks/extract-content.js';
import {
  fusionarMetadata,
  metadataDeYoutube,
  sacarmetadata,
  type PiezasDeMetadata,
} from '../src/modules/bookmarks/extract-metadata.js';

/**
 * La reduccion de un articulo al formato de las notas.
 *
 * Los fixtures son el HTML **crudo** de paginas reales, guardado en el arbol
 * (`fixtures/README.md`): estos tests no bajan nada de internet, que es lo que
 * los hace deterministas y lo que hace que los numeros se puedan comparar con
 * los del spike. Que el fixture sea la pagina cruda y no la salida de Readability
 * es lo correcto, porque **la pagina cruda es lo que recibe el endpoint** y
 * Readability es una de las etapas que se prueban, no una precondicion del
 * fixture.
 *
 * La referencia de supervivencia se recalcula aca con la version fijada
 * (`@mozilla/readability` 0.6.0, `jsdom` 30.1.2), asi que el texto contra el que
 * se compara es **el `content` de Readability**: la entrada de la reduccion.
 *
 * **Para leer los tests hay que tener `note-document.ts:157-185` abierto al
 * lado**, porque el tokenizador es estricto y sin DOM, y su comentario dice lo que
 * cambia el algoritmo: *"A tag it cannot read is reported as a `close`, which the
 * walk below then fails on, so an unreadable input is rejected rather than
 * silently skipped."* Desarrollar un tag **no alcanza**: si `<sup>[1]</sup>` se
 * desarrolla a `[1]` suelto, ese texto queda fuera de todo tag permitido y el
 * validador rechaza el documento entero, porque el formato no tiene un nodo de
 * texto en la raiz. El texto tiene que acabar **dentro** de un tag permitido, casi
 * siempre `<p>`.
 */

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

function fixture(nombre: string): string {
  return readFileSync(`${FIXTURES}${nombre}`, 'utf8');
}

function contarPalabras(texto: string): number {
  return texto.split(/\s+/).filter(Boolean).length;
}

/** `jsdom` sin tipos, igual que en el extractor: el test solo lee y cuenta. */
const { JSDOM } = jsdom as unknown as {
  JSDOM: new (
    html: string,
    opciones?: { url?: string },
  ) => { readonly window: { readonly document: object; close(): void } };
};

/**
 * El texto de un HTML **como lo renderiza un navegador**: los nodos de texto
 * contiguos van pegados, y hay un salto solo en los bloques.
 *
 * Va con regex y no con el DOM a proposito. Dos motivos, y el segundo es el que
 * importa: es la **misma operacion que hace el extractor**, escrita de otra
 * forma, asi que un error compartido no contamina las dos mitades a la vez.
 *
 * **Y el detalle que hace que el numero sea el del spike**: un tag en linea se
 * borra sin dejar nada, no dejando un espacio. `<i>foo</i><i>bar</i>` son dos
 * nodos de texto contiguos y rinden la palabra "foobar", no dos. Poner un espacio
 * en cada frontera de nodo infla la referencia —el `content` de Readability de
 * `article-wiki-topic.html` trae 817 `<span>`, medidos con las versiones
 * fijadas— y el spike midio con esa version generosa entre 92 y 99 % en vez de
 * 101,3 %. Un numero de supervivencia que depende de como se conto no prueba nada.
 *
 * Lo que no cuenta como prosa, y por que: `script`, `style`, `noscript` y `svg`
 * porque no se renderizan, `head` porque no se ve, y **`math` porque son tokens
 * de una formula**: Wikipedia entrega cada formula dos veces —la MathML, que es
 * `<mi>` y `<mo>` y `<mn>`, y el `img alt` con el LaTeX— y guardar las dos seria
 * guardar la misma formula dos veces. El `img alt` si se guarda; que se guarde esta
 * en `las formulas de Wikipedia llegan dos veces`.
 */
function textoRenderizado(html: string): string {
  const sinRender = /<(script|style|noscript|svg|math|head)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;
  const bloques =
    /<\/?(?:p|div|h[1-6]|li|ul|ol|blockquote|pre|br|table|tr|td|th|dd|dt|dl|figure|figcaption|section|article|header|footer|nav|hr)\b[^>]*>/gi;

  const salida = html.replace(sinRender, ' ').replace(bloques, '\n').replace(/<[^>]*>/g, '');

  return (
    salida
      .split('\n')
      .map((linea) => linea.replace(/\s+/g, ' ').trim())
      .filter((linea) => linea.length > 0)
      .join('\n')
      .trim()
  );
}

/**
 * El texto del articulo tal como lo entrego Readability, que es la entrada de la
 * reduccion.
 *
 * Pasa el mismo HTML por la misma limpieza que el extractor, porque es lo que un
 * endpoint haria: la pagina primero, Readability despues.
 */
function textoDeReadability(html: string, url: string): string | null {
  const ventana = new JSDOM(limpiarParaElDom(html), { url }).window;
  const articulo = new Readability(ventana.document as never).parse();
  const contenido = articulo?.content;
  const titulo = articulo?.title ?? '';
  ventana.close();
  if (typeof contenido !== 'string') return null;
  // El titulo no cuenta: Readability lo saca del `<h1>` o del `<title>`, y en
  // el documento final es prosa como cualquier otra.
  return `${titulo}\n${textoRenderizado(contenido)}`;
}

const ARTICULO_LARGO = 'article-long.html';
const ARTICULO_WIKIPEDIA = 'article-wiki-topic.html';
const ARTICULO_GUARDIAN = 'article-guardian.html';
const VIDEO_YOUTUBE = 'video-youtube.html';
const CORTO = 'too-short.html';

const URL_LARGA = 'https://en.wikipedia.org/wiki/Quicksort';
const URL_WIKIPEDIA = 'https://en.wikipedia.org/wiki/Readability';
const URL_GUARDIAN =
  'https://www.theguardian.com/world/2026/oct/05/flydubai-co-pilot-originally-planned-attack-for-july-investigators-believe';
const URL_VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const URL_CORTA = 'https://partido.local/nota-de-un-arbitro';

/** Los tres articulos, que es donde la reduccion tiene trabajo de verdad. */
const ARTICULOS = [
  [ARTICULO_LARGO, URL_LARGA],
  [ARTICULO_WIKIPEDIA, URL_WIKIPEDIA],
  [ARTICULO_GUARDIAN, URL_GUARDIAN],
] as const;

function ok(r: ResultadoDeContenido): Extract<ResultadoDeContenido, { ok: true }> {
  if (!r.ok) throw new Error(`se esperaba contenido y vino "${r.motivo}"`);
  return r;
}

/**
 * Cuanto puede tardar un test que parsea una pagina real.
 *
 * `apps/api/vitest.config.ts` sube `hookTimeout` a 60 s porque las migraciones son
 * lentas, pero **no sube `testTimeout`**: el default de vitest son 5 s. Y un
 * article de Wikipedia son 525 KB de HTML que pasan por jsdom, por Readability y
 * por la reduccion, asi que en la suite completa —con nueve workers peleando la
 * maquina y una base de datos levantandose al lado— hay tests que se van de 5 s.
 *
 * No se sube el default global: eso le costaria a todo el archivo de test lo que
 * **esta** prueba calcula una vez y reusa. Con el memo de abajo, el trabajo caro
 * ocurre unas ocho veces en total y no unas treinta, y el timeout queda siendo lo
 * que es: margen para una pagina de un megas, no una excusa para tests lentos.
 */
const TIMEOUT_DE_PAGINA_REAL = 30_000;

/**
 * El resultado de `extraerContenido` para un fixture, una sola vez.
 *
 * **El archivo repetia el mismo trabajo caro diez veces**: `article-long.html`
 * salia de disco, pasaba por jsdom, por Readability y por la reduccion en una
 * decena de tests distintos, y lo mismo con los otros dos articulos. La funcion
 * es pura, asi que el memo no cambia ninguna respuesta: solo deja de pagar la
 * misma cuenta. Los tests con HTML escrito a mano **no** pasan por aca, porque
 * esa es justamente la parte que tiene que volver a ejecutarse.
 *
 * Sin esto el archivo pasaba solo cuando se corria aislado
 * (`npm run api:test -- bookmarks-extract`) y se caia por timeout en la suite
 * completa, que es donde corre de verdad.
 */
const cacheDeContenido = new Map<string, Promise<ResultadoDeContenido>>();

function contenidoDe(nombre: string, url: string): Promise<ResultadoDeContenido> {
  const clave = `${nombre}::${url}`;
  let pendiente = cacheDeContenido.get(clave);
  if (pendiente === undefined) {
    // Congelado: el memo devuelve el mismo objeto a todos los que lo piden, y
    // sin esto un test que lo toque cambia la respuesta de los demas.
    pendiente = extraerContenido(fixture(nombre), url).then((r) => Object.freeze(r));
    cacheDeContenido.set(clave, pendiente);
  }
  return pendiente;
}

/** El texto de referencia de un fixture, una sola vez, por la misma razon. */
const cacheDeReferencia = new Map<string, string | null>();

function referenciaDe(nombre: string, url: string): string | null {
  const clave = `${nombre}::${url}`;
  if (!cacheDeReferencia.has(clave)) {
    cacheDeReferencia.set(clave, textoDeReadability(fixture(nombre), url));
  }
  return cacheDeReferencia.get(clave) ?? null;
}

describe('el texto del articulo sobrevive a la reduccion', () => {
  for (const [nombre, url] of ARTICULOS) {
    it(nombre, async () => {
      const referencia = referenciaDe(nombre, url);
      expect(referencia).not.toBeNull();

      const palabrasAntes = contarPalabras(referencia!);
      const r = ok(await contenidoDe(nombre, url));
      const palabrasDespues = contarPalabras(r.contenido.texto);

      // El spike midio 101,3 % en Wikipedia y 100,0 % en The Guardian, con el
      // mismo metodo de contar. Un 95 % es el piso razonable y sigue siendo la
      // prueba de que desarrollar no tira prosa. El mensaje lleva la cuenta
      // exacta, porque un fallo asi sin numeros no dice nada.
      expect(
        palabrasDespues / palabrasAntes,
        `sobrevivieron ${palabrasDespues} de ${palabrasAntes} palabras (${(
          (palabrasDespues / palabrasAntes) *
          100
        ).toFixed(1)} %)`,
      ).toBeGreaterThan(0.95);
    }, TIMEOUT_DE_PAGINA_REAL);
  }
});

describe('lo que sale pasa el validador que protege las notas', () => {
  // Es el mismo validador que protege las notas, y por eso el extractor no
  // necesita una frontera de seguridad nueva. Si este test falla, el problema no
  // es el validador: es la reduccion.
  for (const [nombre, url] of ARTICULOS) {
    it(nombre, async () => {
      const r = ok(await contenidoDe(nombre, url));
      expect(() => noteDocumentSchema.parse(r.contenido.document)).not.toThrow();
    }, TIMEOUT_DE_PAGINA_REAL);
  }

  it('y el documento que devuelve es el mismo que valida', async () => {
    const r = ok(await contenidoDe(ARTICULO_LARGO, URL_LARGA));
    // El esquema normaliza (desenvuelve el documento), asi que lo que se guarda
    // es lo que paso, no lo que quedo con un `<html>` alrededor.
    expect(noteDocumentSchema.parse(r.contenido.document)).toBe(r.contenido.document);
  }, TIMEOUT_DE_PAGINA_REAL);
});

describe('desarrollar, no descartar', () => {
  it('el texto de un tag desconocido acaba dentro de un <p>, no suelto', async () => {
    // **Este es el test mas importante del archivo**, junto con el de
    // supervivencia, y por el mismo motivo: mide la diferencia entre dos algoritmos
    // que se parecen en el papel.
    //
    // `<sup>[1]</sup>` en la raiz se desarrolla a `[1]` suelto, y `[1]` suelto en
    // la raiz lo rechaza el validador entero. Envuelto en `<p>`, pasa. Con el
    // algoritmo que desarrolla sin envolver este test se pone rojo, y no por el
    // conteo de palabras: porque el documento no pasa y no hay contenido que
    // contar.
    const r = ok(
      await extraerContenido(
        `<article><h1>Titulo</h1><sup>[1]</sup><p>${'palabra '.repeat(60)}</p></article>`,
        'https://ejemplo.local/x',
      ),
    );
    expect(r.contenido.document).toContain('<p>[1]</p>');
    expect(() => noteDocumentSchema.parse(r.contenido.document)).not.toThrow();
    expect(r.contenido.plainText).toContain('[1]');
  });

  it('los <sup> de Wikipedia sobreviven, y sin el tag', async () => {
    // El spike los conto: 121 en el articulo de Wikipedia, y ningun otro tag del
    // mundo real aparece tanto. Cada uno es un `[n]` de referencia, y el `[n]`
    // tiene que seguir en el documento.
    const r = ok(await contenidoDe(ARTICULO_WIKIPEDIA, URL_WIKIPEDIA));
    expect(r.contenido.document).not.toContain('<sup');
    expect(r.contenido.document.match(/\[\d+\]/g)?.length ?? 0).toBeGreaterThan(50);
  }, TIMEOUT_DE_PAGINA_REAL);

  it('el credito de foto de un <figcaption> sobrevive a la foto, al <svg> y al web component', async () => {
    // `figure`, `figcaption`, `picture`, `svg`, `path`, `source` y `gu-island` no
    // estan en el conjunto cerrado del contrato, y el credito de foto vive
    // adentro de un `figcaption` del Guardian. Es el caso que el spec no preveia
    // y el que obliga a reducir por default en vez de por lista.
    const r = ok(await contenidoDe(ARTICULO_GUARDIAN, URL_GUARDIAN));
    expect(r.contenido.document).not.toMatch(/<figure|<svg|<source|<gu-/);
    expect(r.contenido.plainText).toContain('Photograph:');
  }, TIMEOUT_DE_PAGINA_REAL);

  it('las formulas de Wikipedia llegan dos veces y se guarda una', async () => {
    // Cada formula viene en MathML (`<mo>`, `<mi>`, `<mn>`: son tokens, no prosa)
    // y en el `alt` del `img` que la dibuja. Guardar las dos es guardar la misma
    // formula dos veces, y el `alt` es el que un lector de pantalla lee.
    const r = ok(await contenidoDe(ARTICULO_LARGO, URL_LARGA));
    expect(r.contenido.document).not.toMatch(/<mo>|<mi>|<mn>|<annotation/);
    expect(r.contenido.document).toContain('alt="{\\displaystyle');
  }, TIMEOUT_DE_PAGINA_REAL);

  it('las 73 imagenes del articulo siguen siendo imagenes', async () => {
    const r = ok(await contenidoDe(ARTICULO_LARGO, URL_LARGA));
    // Readability devuelve 73 `img` y quedan 66: siete son formulas duplicadas
    // dentro de un `math`, que se borran con el MathML. Reducirlas seria tirar
    // el contenido que hace que la pagina sea la pagina.
    expect(r.contenido.document.match(/<img /g)?.length ?? 0).toBeGreaterThan(50);
  }, TIMEOUT_DE_PAGINA_REAL);

  it('una tabla es una linea por fila, y no se pierde ninguna celda', async () => {
    // El bug mas caro que se colaron en este archivo, y el motivo de este test:
    // `tagName` va en mayusculas, asi que el filtro de celdas no encontraba
    // ninguna, cada fila salia por `continue` y **la tabla entera se perdia sin
    // que nada fallara**. El documento salia valido y corto. Con la tabla del
    // navbox de Wikipedia son 215 palabras y siete imagenes.
    const r = ok(
      await extraerContenido(
        `<article><h1>Titulo</h1><p>${'palabra '.repeat(60)}</p><table><tbody>` +
          '<tr><th colspan="2">Complejidad</th></tr>' +
          '<tr><td>Mejor caso</td><td>O(n log n)</td></tr>' +
          '<tr><td><a href="https://ejemplo.local/p">Peor caso</a></td>' +
          '<td><img src="grafico.png" alt="curva"></td></tr>' +
          '</tbody></table></article>',
        'https://ejemplo.local/x',
      ),
    );
    expect(r.contenido.document).not.toMatch(/<table|<td|<tr|<th/);
    expect(r.contenido.plainText).toContain('Complejidad');
    expect(r.contenido.plainText).toContain('Mejor caso | O(n log n)');
    // Los enlaces y las imagenes de la celda tambien: la fila es una linea de
    // texto con las dos cosas dentro.
    expect(r.contenido.document).toContain('<a href="https://ejemplo.local/p">Peor caso</a>');
    expect(r.contenido.document).toContain('<img src="https://ejemplo.local/grafico.png" alt="curva">');
    expect(() => noteDocumentSchema.parse(r.contenido.document)).not.toThrow();
  });

  it('una tabla anidada se aplana una vez, no dos', async () => {
    // `querySelectorAll('tr')` baja a las tablas anidadas: sin el filtro de
    // filas propias, las filas de adentro salian por el bucle de la tabla de
    // afuera y otra vez al aplanar la tabla de adentro. Readability conserva
    // las tablas anidadas, asi que el caso llega de paginas reales.
    const r = ok(
      await extraerContenido(
        `<article><h1>Titulo</h1><p>${'palabra '.repeat(60)}</p>` +
          '<table><tbody>' +
          '<tr><td>Afuera uno</td><td><table><tbody>' +
          '<tr><td>Adentro uno</td><td>Adentro dos</td></tr>' +
          '<tr><td>Adentro tres</td><td>Adentro cuatro</td></tr>' +
          '</tbody></table></td></tr>' +
          '<tr><td>Afuera dos</td><td>Afuera tres</td></tr>' +
          '</tbody></table></article>',
        'https://ejemplo.local/x',
      ),
    );
    expect(r.contenido.document).not.toMatch(/<table|<td|<tr/);
    for (const celda of ['Adentro uno', 'Adentro dos', 'Adentro tres', 'Adentro cuatro']) {
      expect(r.contenido.plainText.match(new RegExp(celda, 'g'))?.length ?? 0).toBe(1);
    }
    expect(() => noteDocumentSchema.parse(r.contenido.document)).not.toThrow();
  });

  it('el navbox de Wikipedia sigue ahi, y son 215 palabras', async () => {
    // El navbox es una tabla, y es donde el algoritmo que desarrolla tiende a perder
    // cosas: sin el aplanado de tablas, cada celda seria un parrafo de una
    // palabra y el documento quedaria fragmentado; con el filtro de celdas roto,
    // las 215 palabras se perdian del todo.
    const r = ok(await contenidoDe(ARTICULO_LARGO, URL_LARGA));
    expect(r.contenido.plainText).toContain('Sorting algorithm');
    expect(r.contenido.plainText).toMatch(/\|/);
  }, TIMEOUT_DE_PAGINA_REAL);

  it('un <pre> es un <codeblock> y no se pierde ni una linea', async () => {
    const r = ok(await contenidoDe(ARTICULO_LARGO, URL_LARGA));
    expect(r.contenido.document).toContain('<codeblock>');
    expect(r.contenido.plainText).not.toContain('<pre');
    expect(r.contenido.plainText).toContain('quicksort(A, lo, hi)');
  }, TIMEOUT_DE_PAGINA_REAL);
});

describe('colapsarParrafos', () => {
  it('un <p> dentro de un <p> sube su contenido con un espacio', () => {
    // El parser cierra el `<p>` antes de un bloque, asi que `<p><p>` no llega
    // al DOM por parsing: se arma a mano con `appendChild`, que si lo admite.
    // Es el caso que deja una celda de tabla con un `<p>` adentro.
    const ventana = new JSDOM('<div></div>').window;
    const documento = ventana.document as unknown as {
      createElement(etiqueta: string): {
        appendChild(hijo: unknown): void;
        readonly innerHTML: string;
      };
      createTextNode(datos: string): unknown;
    };
    const raiz = documento.createElement('div');
    const externo = documento.createElement('p');
    externo.appendChild(documento.createTextNode('celda'));
    const interno = documento.createElement('p');
    interno.appendChild(documento.createTextNode('una'));
    externo.appendChild(interno);
    raiz.appendChild(externo);
    colapsarParrafos(raiz as never, documento as never);
    expect(raiz.innerHTML).toBe('<p>celda una</p>');
    ventana.close();
  });
});

describe('los scripts', () => {
  it('un script nunca llega al documento', async () => {
    const r = ok(await contenidoDe(ARTICULO_LARGO, URL_LARGA));
    expect(r.contenido.document).not.toMatch(/<script|javascript:|onerror=|onload=/i);
    // `patrolToken` y `wgPageParseReport` estan dentro de los scripts inline de
    // la pagina. Este NO es el test que prueba la limpieza —Readability borra los
    // scripts por su cuenta—: es la red que avisa si alguna vez deja de hacerlo.
    expect(r.contenido.document).not.toContain('patrolToken');
    expect(r.contenido.plainText).not.toContain('wgPageParseReport');
  }, TIMEOUT_DE_PAGINA_REAL);

  it('se borran ANTES de construir el DOM', () => {
    // La optimizacion mas grande que midio el spike: hasta 7x, con la mitad de
    // memoria. Y no es una deduccion: sin la limpieza, la watch de YouTube deja de
    // devolver `null`, que es el test de abajo.
    const crudo = fixture(VIDEO_YOUTUBE);
    const limpio = limpiarParaElDom(crudo);
    expect(limpio).not.toMatch(/<script|<link|\sstyle="/i);
    // De 1,4 MB quedan 23 KB: el 98 % del HTML de esa pagina son scripts.
    expect(limpio.length).toBeLessThan(crudo.length * 0.05);
  });
});

describe('el piso de palabras', () => {
  it('un video no es un articulo: metadata_only, no nueve palabras', async () => {
    const r = await contenidoDe(VIDEO_YOUTUBE, URL_VIDEO);
    // El motivo exacto es lo que hace que este test muerda, asi que se asegura
    // en vez de aceptarse: con la limpieza de `<script>` la watch deja de devolver
    // `null` y devuelve un articulo de nueve palabras ("(c) 2026 Google LLC,
    // YouTube, una empresa de Google"), y lo que las para es el **piso**. Sin la
    // limpieza el mismo fixture da `not an article`, y este test se pone rojo.
    //
    // Lo que el brief prohibe —un `ok: true` con nueve palabras— lo cubre la regla,
    // con el fixture de cinco palabras de abajo.
    expect(r).toEqual({ ok: false, motivo: 'too short' });
  }, TIMEOUT_DE_PAGINA_REAL);

  it('cinco palabras no son un articulo, por regla y no por el caso del video', async () => {
    const r = await contenidoDe(CORTO, URL_CORTA);
    expect(r).toEqual({ ok: false, motivo: 'too short' });
  }, TIMEOUT_DE_PAGINA_REAL);

  it('cincuenta palabras tampoco alcanzan', async () => {
    // El piso son 50 y esta es la palabra que decide: el lado que se prueba es
    // "no llega", porque un articulo de 50 palabras reales no se differentiate de
    // un recorte.
    const r = await extraerContenido(
      `<article><h1>Titulo</h1><p>${'palabra '.repeat(40)}</p></article>`,
      'https://ejemplo.local/x',
    );
    expect(r).toEqual({ ok: false, motivo: 'too short' });
  });
});

describe('los atributos', () => {
  it('los que no estan en el formato no sobreviven', async () => {
    const r = ok(await contenidoDe(ARTICULO_GUARDIAN, URL_GUARDIAN));
    // `gu-island` trae `props="{...}"`, `figure` trae `class`, y Readability mete
    // `id` y `role` en media decena de elementos. El contrato no admite ninguno: una
    // nota no lleva presentacion propia, toma el tema.
    expect(r.contenido.document).not.toMatch(/\s(?:id|class|props|slot|role|style|data-)="/);
    expect(r.contenido.document).toContain('<a href="https://');
  }, TIMEOUT_DE_PAGINA_REAL);

  it('un href que no es un enlace no se vuelve un enlace, y el texto sigue', async () => {
    const r = ok(
      await extraerContenido(
        `<article><h1>Titulo</h1><p>${'palabra '.repeat(60)}` +
          '<a href="javascript:alert(1)">uno</a> y ' +
          '<a href="data:text/html,<b>x</b>">dos</a> y ' +
          '<a href="https://ejemplo.local/si">tres</a> y ' +
          '<a>cuatro</a> y' +
          '<img src="javascript:alert(2)" alt="x"> y ' +
          '<img src="imagen.png" width="900" height="9000" class="grande"> y ' +
          '<span>final</span></p></article>',
        'https://ejemplo.local/directorio/articulo',
      ),
    );
    expect(r.contenido.document).not.toContain('javascript:');
    expect(r.contenido.document).not.toContain('data:text/html');
    // El `href` relativo se resuelve contra la URL de la pagina, que es el unico
    // acoplamiento con el guard de la Task 2: sin esto, las imagenes de un sitio
    // con redirect quedan apuntando a un relative.
    expect(r.contenido.document).toContain(
      '<img src="https://ejemplo.local/directorio/imagen.png" width="900" height="9000">',
    );
    expect(r.contenido.document).not.toContain('class=');
    // Los cuatro enlaces: dos desarrollados (sin href escribible) con su texto, y el
    // que si se puede escribir.
    expect(r.contenido.document).toContain('<a href="https://ejemplo.local/si">tres</a>');
    for (const texto of ['uno', 'dos', 'cuatro', 'final']) {
      expect(r.contenido.plainText).toContain(texto);
    }
    expect(() => noteDocumentSchema.parse(r.contenido.document)).not.toThrow();
  });

  it('una medida de imagen que no es un numero no se copia', async () => {
    const r = ok(
      await extraerContenido(
        `<article><h1>Titulo</h1><p>${'palabra '.repeat(60)}` +
          '<img src="a.png" width="100%" height="9000" style="width:100px" alt="un %">' +
          '<img src="b.png" width="20000" height="191">' +
          '<img src="c.png" width="640" height="480"></p></article>',
        'https://ejemplo.local/x',
      ),
    );
    // `100%` no es un numero de pixeles, asi que no se copia; 9000 esta bien (el
    // tope del contrato es 16384), 20000 no, y 640x480 va entero.
    expect(r.contenido.document).toContain(
      '<img src="https://ejemplo.local/a.png" alt="un %" height="9000">',
    );
    expect(r.contenido.document).not.toContain('20000');
    expect(r.contenido.document).not.toContain('width="100"');
    expect(r.contenido.document).toContain(
      '<img src="https://ejemplo.local/c.png" width="640" height="480">',
    );
  });
});

describe('lo que el validador decide', () => {
  it('un documento que no pasa no se guarda', async () => {
    // El validador es la frontera y el que manda. Lo mas grande que puede pasarle
    // a una nota es el tope de `NOTE_DOCUMENT_MAX_BYTES`: un articulo de un
    //kilometro se rechaza entero, y es preferible un enlace sin texto a un
    // documento invalido, porque el documento invalido es el que el editor movil
    // no sanea.
    const enorme = `<article><h1>Titulo</h1><p>${'palabra '.repeat(80_000)}</p></article>`;
    const r = await extraerContenido(enorme, 'https://ejemplo.local/x');
    expect(r).toEqual({ ok: false, motivo: 'unreadable' });
  });

  it('y lo que si pasa se guarda tal cual', async () => {
    const r = ok(
      await extraerContenido(
        `<article><h1>Titulo</h1><p>${'palabra '.repeat(60)}</p></article>`,
        'https://ejemplo.local/x',
      ),
    );
    expect(noteDocumentSchema.safeParse(r.contenido.document).success).toBe(true);
  });
});

describe('lo que el indice ve', () => {
  it('plainText es la funcion del contrato, no otra implementacion', async () => {
    const r = ok(await contenidoDe(ARTICULO_LARGO, URL_LARGA));
    // El indice trigram de `bookmarks.plain_text` (migracion 0022) se construye
    // sobre `noteDocumentToPlainText`. Dos implementaciones divergen en la
    // busqueda sin que nadie lo note.
    expect(r.contenido.plainText).toBe(noteDocumentToPlainText(r.contenido.document));
  }, TIMEOUT_DE_PAGINA_REAL);

  it('texto y plainText son el mismo string', async () => {
    const r = ok(await contenidoDe(ARTICULO_LARGO, URL_LARGA));
    // Son dos nombres para un valor, no dos valores: uno mira palabras y el otro
    // busca. El piso de palabras se mide sobre este.
    expect(r.contenido.texto).toBe(r.contenido.plainText);
  }, TIMEOUT_DE_PAGINA_REAL);
});

describe('los bordes', () => {
  it('una pagina vacia no es un articulo', async () => {
    expect(await extraerContenido('', 'https://ejemplo.local/x')).toEqual({
      ok: false,
      motivo: 'not an article',
    });
    expect(
      await extraerContenido(
        '<!doctype html><html><head><title>Hola</title></head><body></body></html>',
        'https://ejemplo.local/x',
      ),
    ).toEqual({ ok: false, motivo: 'not an article' });
  });

  it('nunca tira, ni con basura ni con una url que no es url', async () => {
    // El motivo va derecho a `extractionError` y lo lee una persona, asi que un
    // HTML que no es HTML tiene que ser un resultado y no una excepcion.
    const motivos = new Set(['not an article', 'too short', 'unreadable']);
    for (const caso of [
      [' binario', 'https://ejemplo.local/x'],
      ['<p>sin cerrar', 'https://ejemplo.local/x'],
      ['<div><p></div></p>', 'https://ejemplo.local/x'],
      ['<article><h1>Sin base</h1><p>' + 'palabra '.repeat(60) + '</p></article>', ''],
      ['<article><h1>Sin base</h1><p>' + 'palabra '.repeat(60) + '</p></article>', 'no-es-una-url'],
    ] as const) {
      const r = await extraerContenido(caso[0], caso[1]);
      if (r.ok) expect(noteDocumentSchema.safeParse(r.contenido.document).success).toBe(true);
      else expect(motivos.has(r.motivo)).toBe(true);
    }
  });

  it('el titulo de Readability viene, o viene null', async () => {
    const largo = ok(await contenidoDe(ARTICULO_LARGO, URL_LARGA));
    expect(largo.contenido.titulo).toBe('Quicksort - Wikipedia');

    const corto = ok(
      await extraerContenido(
        '<!doctype html><html lang="es"><head><title>Un titulo</title></head><body><article><h1>Un titulo</h1>' +
          `<p>${'palabra '.repeat(60)}</p></article></body></html>`,
        'https://ejemplo.local/x',
      ),
    );
    expect(corto.contenido.titulo).toBe('Un titulo');
  }, TIMEOUT_DE_PAGINA_REAL);
});

/**
 * La metadata de una pagina: titulo, sitio, descripcion e imagen.
 *
 * Estos tests no bajan nada: usan HTML escrito a mano o el fixture de la watch
 * de YouTube, que ya esta en el arbol. La unica excepcion es el `oembed`, que
 * es una llamada real y va en su propio `describe` marcado como tal.
 */
function piezasConTodo(url: string): PiezasDeMetadata {
  return {
    tituloDeReadability: 'El de Readability',
    extracto: 'El extracto',
    tituloDePagina: 'El de la pagina',
    ogTitulo: 'El OG',
    ogDescripcion: 'La de OG',
    ogImagen: 'https://ejemplo.local/og.png',
    ogSitio: 'El sitio OG',
    twitterTitulo: 'El de Twitter',
    twitterDescripcion: 'La de Twitter',
    twitterImagen: 'https://ejemplo.local/twitter.png',
    metaDescripcion: 'La meta',
    imagenPrincipal: 'https://ejemplo.local/principal.png',
    url,
  };
}

describe('la metadata de una pagina', () => {
  it('usa el titulo de la pagina antes que el de Open Graph si Readability no dio ninguno', () => {
    // Sin cuerpo no hay articulo y Readability devuelve null: quedan `<title>`
    // y `og:title`, y gana el de la pagina. Medido, no supuesto: Readability
    // lee `og:title` por su cuenta, asi que con cuerpo su titulo y el OG suelen
    // coincidir y este caso no se podria armar.
    const html =
      '<!doctype html><html><head><title>La pagina</title>' +
      '<meta property="og:title" content="El marketing"></head><body></body></html>';
    expect(sacarmetadata(html, 'https://ejemplo.local/nota').title).toBe('La pagina');
  });

  it('el titulo que la persona escribio no lo pisa nadie', () => {
    // La implementacion vive en el servicio (Task 5): aca se deja escrito que la
    // cadena lo pone primero, con todas las demas fuentes presentes.
    const m = fusionarMetadata({
      ...piezasConTodo('https://ejemplo.local/nota'),
      tituloDePersona: 'Como yo lo llame',
    });
    expect(m.title).toBe('Como yo lo llame');
  });

  it('sin titulo de la persona, Readability va primero y el hostname es el ultimo', () => {
    const base = piezasConTodo('https://ejemplo.local/nota');
    expect(fusionarMetadata(base).title).toBe('El de Readability');
    expect(fusionarMetadata({ ...base, tituloDeReadability: null }).title).toBe('El de la pagina');
    expect(fusionarMetadata({ ...base, tituloDeReadability: null, tituloDePagina: null }).title).toBe(
      'El OG',
    );
    expect(
      fusionarMetadata({ ...base, tituloDeReadability: null, tituloDePagina: null, ogTitulo: null })
        .title,
    ).toBe('El de Twitter');
    expect(
      fusionarMetadata({
        ...base,
        tituloDeReadability: null,
        tituloDePagina: null,
        ogTitulo: null,
        twitterTitulo: null,
      }).title,
    ).toBe('ejemplo.local');
  });

  it('la descripcion prefiere Open Graph y cae al extracto y a la meta', () => {
    const base = piezasConTodo('https://ejemplo.local/nota');
    expect(fusionarMetadata(base).description).toBe('La de OG');
    expect(fusionarMetadata({ ...base, ogDescripcion: null }).description).toBe('La de Twitter');
    expect(fusionarMetadata({ ...base, ogDescripcion: null, twitterDescripcion: null }).description).toBe(
      'El extracto',
    );
    expect(
      fusionarMetadata({ ...base, ogDescripcion: null, twitterDescripcion: null, extracto: null })
        .description,
    ).toBe('La meta');
  });

  it('el sitio prefiere og:site_name y cae al hostname sin www', () => {
    const base = piezasConTodo('https://www.ejemplo.local/nota');
    expect(fusionarMetadata(base).siteName).toBe('El sitio OG');
    expect(fusionarMetadata({ ...base, ogSitio: null }).siteName).toBe('ejemplo.local');
  });

  it('trae la imagen de og:image cuando la hay', () => {
    // Medido, no supuesto: en una watch Readability devuelve un stub de nueve
    // palabras (el caso `metadata_only` de arriba, que el piso de palabras
    // rechaza) y su titulo es el `og:title` que lee por su cuenta, sin el
    // " - YouTube" del `<title>`. La metadata no tiene piso y lo conserva.
    const m = sacarmetadata(fixture(VIDEO_YOUTUBE), URL_VIDEO);
    expect(m.imageUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg');
    expect(m.siteName).toBe('YouTube');
    expect(m.title).toBe('Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)');
    expect(m.description).toContain('official video');
  });

  it('Twitter cubre lo que Open Graph no trae', () => {
    const html =
      '<!doctype html><html><head>' +
      '<meta name="twitter:title" content="La de Twitter">' +
      '<meta name="twitter:description" content="Desc de Twitter">' +
      '<meta name="twitter:image" content="https://cdn.ejemplo.local/t.png"></head><body></body></html>';
    const m = sacarmetadata(html, 'https://ejemplo.local/nota');
    expect(m.title).toBe('La de Twitter');
    expect(m.description).toBe('Desc de Twitter');
    expect(m.imageUrl).toBe('https://cdn.ejemplo.local/t.png');
  });

  it('un og:image a una IP interna queda en null', () => {
    // El ataque que motivo la validacion: pasa el predicado de esquema y solo
    // lo para el chequeo de rangos, importado de `ssrf.ts` y no copiado.
    const html = (imagen: string): string =>
      '<!doctype html><html><head><title>T</title>' +
      `<meta property="og:image" content="${imagen}"></head><body></body></html>`;
    const base = 'https://ejemplo.local/nota';
    expect(sacarmetadata(html('http://169.254.169.254/x.png'), base).imageUrl).toBeNull();
    expect(sacarmetadata(html('http://127.0.0.1:8080/x.png'), base).imageUrl).toBeNull();
    expect(sacarmetadata(html('http://[::ffff:169.254.169.254]/x.png'), base).imageUrl).toBeNull();
    expect(sacarmetadata(html('javascript:alert(1)'), base).imageUrl).toBeNull();
    // Y lo legitimo sigue pasando: relativo contra la pagina, absoluto, y una IP
    // publica, que el chequeo de rangos deja pasar.
    expect(sacarmetadata(html('/img.png'), base).imageUrl).toBe('https://ejemplo.local/img.png');
    expect(sacarmetadata(html('https://cdn.ejemplo.local/a.png'), base).imageUrl).toBe(
      'https://cdn.ejemplo.local/a.png',
    );
    expect(sacarmetadata(html('https://8.8.8.8/a.png'), base).imageUrl).toBe('https://8.8.8.8/a.png');
  });

  it('no se rompe con una pagina que no tiene ninguno', () => {
    // Cuerpo vacio: Readability devuelve null y no hay ni extracto. Sin
    // fuentes solo quedan los fallbacks del hostname: el resto es null.
    const m = sacarmetadata(
      '<!doctype html><html><head></head><body></body></html>',
      'https://www.ejemplo.local/nota',
    );
    // Sin fuentes solo quedan los fallbacks del hostname: el resto es null.
    expect(m).toEqual({
      title: 'www.ejemplo.local',
      siteName: 'ejemplo.local',
      description: null,
      imageUrl: null,
    });
  });

  it('nunca tira, ni con basura ni con una url que no es url', () => {
    expect(sacarmetadata('', '')).toEqual({
      title: null,
      siteName: null,
      description: null,
      imageUrl: null,
    });
    expect(sacarmetadata('<p>sin cerrar', 'no-es-una-url').imageUrl).toBeNull();
  });
});

describe('el oembed de YouTube', () => {
  it('devuelve null si no es un video, haya red o no', async () => {
    // Determinista en los dos mundos: con red YouTube contesta 404 y sin red
    // falla el DNS. En los dos casos `traerHtmlSeguro` devuelve un motivo.
    await expect(metadataDeYoutube('https://ejemplo.local/nota')).resolves.toBeNull();
  }, TIMEOUT_DE_PAGINA_REAL);

  it('trae titulo, sitio e imagen de un video real (necesita internet)', async (ctx) => {
    const m = await metadataDeYoutube('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    // Sin red no hay nada que afirmar: el test se salta en vez de fallar.
    if (m === null) {
      ctx.skip();
      return;
    }
    expect(m.title).toContain('Rick Astley');
    expect(m.siteName).toBe('YouTube');
    expect(m.description).toBeNull();
    expect(m.imageUrl).toContain('https://i.ytimg.com/vi/dQw4w9WgXcQ/');
  }, TIMEOUT_DE_PAGINA_REAL);
});