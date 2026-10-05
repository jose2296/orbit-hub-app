import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Texto visible escrito en un componente, en vez de salir del diccionario.
 *
 * Había exactamente uno: `placeholder="nombre@ejemplo.com"` en el login. Se veía
 * bien en castellano, que es como se usaba la app, y se quedaba en castellano
 * con la app entera en inglés — el resto de la pantalla traducida y ese campo no.
 *
 * El test de traducciones comprueba que las claves existan en las dos lenguas y
 * que no sobre ninguna, que es lo que puede comprobar sobre un diccionario. No
 * puede ver lo que hay escrito dentro de un JSX. Eso es lo que este mira.
 */

const SRC = join(import.meta.dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }

  return found;
}

/**
 * Solo los atributos, que es donde estaba el bug.
 *
 * La primera versión miraba también el texto entre etiquetas y.matchaba a lo
 * largo de los saltos de línea: reportaba `> space.id));` y `const [picking…` en
 * `_layout` y en `index.tsx`, cuatrocientas veces, sin encontrar nada. Un regex
 * que no distingue JSX de TypeScript no está mirando la interfaz, está mirando
 * el fichero — y un test así entrena a ignorar su propiooutput.
 *
 * Texto suelto entre etiquetas queda fuera a propósito. Es un problema real, pero
 * necesita algo que sepa distinguir un componente de una expresión, y ese no es
 * un regex.
 */
/**
 * `attr=` seguido de comillas dobles: un literal. `attr={"…"}` y `attr={t("…")}`
 * no, y el lookahead `\{` es lo que los deja fuera.
 *
 * Escrito así y no como `(?!"\{")`: la primera versión llevaba el `"` escapado
 * dentro del lookahead, que en un `RegExp` literal es una barra invertida
 * literal — `("\{)` — y por eso no_CASE dónde empiezan los valores. No
 * encontraba ni una coincidencia en el repo entero, y por tanto "pasaba" sobre
 * el bug que dice encontrar. Un `\b` suelto delante sí funciona; lo que fallaba
 * era el lookahead.
 */
const VISIBLE =
  /\b(?:label|placeholder|title|accessibilityLabel|subtitle|hint|message)=(?!\{)("[^"]*")/g;

/**
 * Lo que no es un idioma que haya que traducir.
 *
 * `label=""` está en seis sitios y es correcto: es el modo de decir "sin etiqueta"
 * a un `Checkbox`, que si no busca el texto y ensancha la fila (está escrito en
 * `checkbox.tsx` y hay un test que lo fija). Y "OrbitHub" es el nombre de la app,
 * que no se traduce en ninguna lengua.
 *
 * La lista es corta a propósito y está escrita aquí: un filtro que acepta
 * cualquier cosa es un filtro que no filtra.
 */
const NO_ES_TRADUCIBLE = new Set(['OrbitHub']);

/**
 * Ficheros que hablan de la interfaz sin pintarla.
 *
 * `a11y-state.ts` tiene `aria-label="Cerrar el menú"` dentro de un comentario que
 * **cita** una medición de antes del arreglo, donde ese atributo sí estaba en el
 * DOM. El regex no distingue un atributo de una palabra dentro de un `/** *​/`, y
 * un test de "no hay texto sin traducir" que lee comentarios encuentra
 * mediciones de antes. Es el mismo tipo de falso positivo que el de los `label=""`.
 */
const NO_ES_INTERFAZ = new Set(['components/ui/a11y-state.ts']);

/** Una cadena vacía es "nada", no "sin traducir". */
function esTraducible(atributo: string): boolean {
  const valor = atributo.slice(atributo.indexOf('=') + 1).replace(/"/g, '').trim();

  return valor.length > 0 && !NO_ES_TRADUCIBLE.has(valor);
}

function buscarTextoVisible(source: string): string[] {
  return [...source.matchAll(VISIBLE)].map((m) => m[0]);
}

describe('nada de la interfaz está escrito dentro de un componente', () => {
  it('no hay texto visible en un atributo o entre etiquetas', () => {
    const found: string[] = [];

    for (const path of sourceFiles(SRC)) {
      const relativo = path.replace(`${SRC}/`, '');

      if (relativo === join('lib', 'i18n', 'dictionaries.ts')) continue;
      if (relativo === join('lib', 'content', 'legal.ts')) continue;
      if (NO_ES_INTERFAZ.has(relativo)) continue;

      for (const match of buscarTextoVisible(readFileSync(path, 'utf8'))) {
        if (!esTraducible(match)) continue;

        found.push(`${path.replace(SRC, 'src')}: ${match.slice(0, 70)}`);
      }
    }

    expect(
      found,
      'cada texto visible sale de t("..."), o es un literal que hay que traducir',
    ).toEqual([]);
  });

  it('el test ve de verdad, y no porque no mire nada', () => {
    // Un test que pasa porque no encuentra nada también pasa cuando su regex
    // está rota. Esto se comprueba contra un caso que sí es un error, escrito
    // aquí y no leído de un fichero: el mismo bug que estaba escrito en
    // `sign-in.tsx`.
    const unComponente = [
      '<TextField',
      '  label="Un texto literal"',
      '  placeholder={t("auth.emailPlaceholder")}',
      '  accessibilityLabel={"otro literal"}',
      '/>',
    ].join('\n');

    expect(buscarTextoVisible(unComponente)).toEqual(['label="Un texto literal"']);
  });

  it('deja pasar lo que ya viene del diccionario', () => {
    const bien = [
      '<TextField',
      '  label={t("auth.email")}',
      '  placeholder={t("auth.emailPlaceholder")}',
      '  accessibilityLabel={t("filters.searchLabel")}',
      '/>',
    ].join('\n');

    expect(buscarTextoVisible(bien)).toEqual([]);
  });
});

describe('las claves que existen y no se usan', () => {
  it('la de ejemplo de correo no vuelve a quedarse huérfana', () => {
    // Existía desde antes y no la usaba nadie: la clave del diccionario para este
    // placeholder concreto estaba ahí, y el componente escribía el suyo. Dos
    // copias del mismo texto, una traducida y otra no.
    const signIn = readFileSync(join(SRC, 'app', '(auth)', 'sign-in.tsx'), 'utf8');

    expect(signIn).toContain('t("auth.emailPlaceholder")');
    expect(signIn).not.toMatch(/placeholder="[^"]*@/);
  });
});
