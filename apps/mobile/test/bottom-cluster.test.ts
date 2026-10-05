import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { bottomCluster } from '../src/lib/layout/bottom-cluster';

/**
 * La pila de la esquina inferior derecha.
 *
 * Se quería el botón de filtrar justo encima del `+`, y no cabía: el botón son
 * 36 puntos y el hueco libre entre el `+` (16→72) y la bandeja de lo hecho
 * (empezaba en 100) eran **28**. Los tres números estaban escritos a mano en el
 * fichero y ninguno comprobaba nada del otro, así que el_plan se notaba en la
 * pantalla, no en un fallo.
 *
 * Aquí la pila se calcula en un sitio y se comprueba que **no se solapan**. Es una
 * prueba de geometría y no de texto: dice "el borde superior de este elemento está
 * por debajo del borde inferior de este otro", que es exactamente lo que se rompe.
 */

const RAIZ = join(import.meta.dirname, '..');
const src = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');

/**
 * A file with its block comments taken out.
 *
 * Every assertion below is about *code*, and a comment is prose that happens to sit
 * in the file. The third guard of this session was satisfied by a comment: the
 * explanation of why the button used to sit at the top mentions
 * `placement="floating"` in passing, so `expect(source).toContain('placement="floating"')`
 * was green while the attribute had been changed to `inline` — the test was reading
 * the sentence about the fix instead of the fix.
 *
 * Only `/* ... *\/` is removed, and not `//`: this file has `https://` inside a
 * string, and a regex that strips line comments takes the rest of that line with it.
 */
const sinComentarios = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The body of `prop={...}`, by matching braces.
 *
 * This replaced `/<Screen[\s\S]{0,2000}?overlay=\{[\s\S]{0,200}/`, which was wrong
 * twice over: the file has **two** `<Screen>` in it, so "the nearest one" is
 * ambiguous, and the props of `ListControls` are three hundred and seventy-eight
 * characters long on their own, so any distance bound was a guess dressed as a
 * check. Matching the braces says what it means: *these* props, inside *this*
 * value.
 */
function propBody(fuente: string, prop: string): string | null {
  const desde = fuente.indexOf(`${prop}={`);
  if (desde === -1) return null;

  let nivel = 0;
  for (let i = desde + prop.length + 1; i < fuente.length; i++) {
    if (fuente[i] === '{') nivel++;
    else if (fuente[i] === '}') {
      nivel--;
      if (nivel === 0) return fuente.slice(desde, i + 1);
    }
  }

  return null;
}

/**
 * The component whose opening tag is still open at `at`, or `null`.
 *
 * `null` means the `<` before the prop had already been closed by a `>`, so the
 * prop belongs to something further out — a sibling, or a different component. That
 * is the whole question here: is `overlay` a prop of the `Screen` that draws this
 * screen, or of some sheet that happens to be open inside it.
 *
 * The first version of this sliced `lastIndexOf('<', at)` up to `at` and asked
 * whether the slice contained `overlay=` — which of course it could not, because
 * the slice **ends** where `overlay=` begins. It returned `false` against a file
 * that was correct.
 */
function padreAbiertoEn(fuente: string, at: number): string | null {
  const antes = fuente.lastIndexOf('<', at);
  const cerradoAntes = fuente.lastIndexOf('>', at);

  if (antes === -1 || antes <= cerradoAntes) return null;

  const etiqueta = fuente.slice(antes + 1, fuente.indexOf('>', antes));

  return /^[A-Z][A-Za-z0-9_.]*/.exec(etiqueta)?.[0] ?? null;
}

const BUTTON = sinComentarios(src('src/components/ui/button.tsx'));
const LISTA = sinComentarios(src('src/app/(app)/list/[listId].tsx'));
const TRAY = sinComentarios(src('src/components/lists/done-tray.tsx'));

/** The real heights, read from the source so a change in either one is caught here. */
function alturaDe(patron: RegExp, fichero = BUTTON): number {
  const alto = fichero.match(patron)?.[0]?.match(/height:\s*(\d+)/)?.[1];

  if (!alto) throw new Error(`no se encontro la altura con ${patron} en ${fichero}`);

  return Number(alto);
}

describe('la pila no se solapa', () => {
  const sm = alturaDe(/sm:\s*\{[^}]*\}/);
  const lg = alturaDe(/lg:\s*\{[^}]*\}/);

  /** The theme's own `lg` and `sm`, so the margins are the app's and not numbers here. */
  const TEMA = { spacing: { lg: 16, sm: 8 } };

  it('las alturas que usa la cuenta son las de los botones de verdad', () => {
    const pila = bottomCluster(TEMA);

    // Si `Button` cambia de alto, esta cuenta miente y el solapamiento vuelve.
    expect(pila.fabSize).toBe(lg);
    expect(pila.controlsHeight).toBe(sm);
  });

  it('el botón de filtrar empieza donde termina el +', () => {
    const pila = bottomCluster(TEMA);

    const bordeSuperiorDelMas = pila.fabBottom + pila.fabSize;
    const bordeInferiorDelBoton = pila.controlsBottom + pila.controlsHeight;

    // The gap is between them, so strictly below and not exactly touching.
    expect(pila.controlsBottom).toBeGreaterThanOrEqual(bordeSuperiorDelMas);
    expect(pila.controlsBottom - bordeSuperiorDelMas).toBe(pila.gap);
    expect(bordeInferiorDelBoton).toBeGreaterThan(bordeSuperiorDelMas);
  });

  it('la bandeja empieza donde termina el botón', () => {
    const pila = bottomCluster(TEMA);
    const bordeInferiorDelBoton = pila.controlsBottom + pila.controlsHeight;

    expect(pila.trayBottom).toBeGreaterThanOrEqual(bordeInferiorDelBoton);
    expect(pila.trayBottom - bordeInferiorDelBoton).toBe(pila.gap);
  });

  it('la cuenta sale de los margenes del tema, no de numeros sueltos', () => {
    const conOtroTema = bottomCluster({ spacing: { lg: 24, sm: 12 } });

    expect(conOtroTema.fabBottom).toBe(24);
    expect(conOtroTema.trayBottom).toBe(24 + 56 + 12 + 36 + 12);
  });

  it('el hueco que había antes era de 28 para un botón de 36', () => {
    // El número que sale de mirar la pantalla, guardado para que se vea por qué
    // esto es una prueba y no un refactor: 16 (margen) + 56 (el +) = 72, y la
    // bandeja empezaba en 16*2 + 56 + 12 = 100. Hueco: 28. Botón: 36.
    const hueco = 16 * 2 + 56 + 12 - (16 + 56);

    expect(hueco).toBe(28);
    expect(sm).toBe(36);
    expect(hueco).toBeLessThan(sm);
  });
});

describe('la pila se usa, y no unos números escritos a mano', () => {
  it('la bandeja recibe la cuenta y no una suma suelta', () => {
    expect(LISTA).toContain('bottomCluster(');
    expect(LISTA).toMatch(/bottomInset=\{[^}]*trayBottom/);
  });

  it('el inset antiguo, con su 12 a mano, no vuelve', () => {
    // La forma que estaba: `theme.spacing.lg * 2 + 56 + theme.spacing.md`, donde
    // el 12 y el 56 son anchos de otros componentes que nadie comprueba aquí.
    expect(LISTA).not.toMatch(/bottomInset=\{theme\.spacing\.lg \* 2 \+ 56/);
  });

  it('el botón se ancla en la esquina, no dentro del encabezado que se desplaza', () => {
    // En el encabezado es un `ListHeaderComponent` del `FlatList`, o sea que se va
    // con el contenido. Flotante es lo que lo deja donde se le ha pedido.
    expect(LISTA).toContain('placement="floating"');
    expect(LISTA).toMatch(/controlsBottom/);
  });

  it('y sale por `overlay`, no como hermano del FlatList dentro del header', () => {
    /*
     * Esta prueba no estaba, y su falta deja pasar el bug que encontró el
     * navegador: con `placement="floating"` puesto, el botón seguía **arriba**,
     * en `top: 5`.
     *
     * La razón es que `position: absolute` se ancla al **ancestro posicionado más
     * cercano**, y dentro de un `ListHeaderComponent` ese ancestro es la propia
     * cabecera — una caja corta cerca de arriba. Así que `bottom: 80` son 80
     * puntos desde el borde de abajo *de la cabecera*, y el botón sale por encima
     * de ella. Absoluto y fuera del flujo no es lo mismo que anclado a la pantalla.
     *
     * `Screen` ya tiene el sitio: `overlay`, un hermano del scroller en el mismo
     * `KeyboardAvoidingView`, con su comentario explicando exactamente por qué no
     * puede ser hijo. El botón va por ahí.
     */
    const overlay = propBody(LISTA, 'overlay');

    expect(overlay).not.toBeNull();
    expect(overlay).toContain('placement="floating"');
    expect(overlay).toContain('ListControls');
    expect(overlay).toContain('controlsBottom');
  });

  it('`overlay` es una prop de `Screen`, no de otra cosa', () => {
    // Sin esto, un `overlay=` en cualquier hoja que se abra dentro de esta pantalla
    // cumpliría la prueba de arriba y el botón seguiría dentro del encabezado.
    expect(padreAbiertoEn(LISTA, LISTA.indexOf('overlay={'))).toBe('Screen');
  });

  it('la bandeja sigue midiendo desde el borde, que es como la define', () => {
    expect(TRAY).toMatch(/bottom: bottomInset/);
    expect(TRAY).toMatch(/left: theme\.spacing\.lg/);
    expect(TRAY).toMatch(/right: theme\.spacing\.lg/);
  });
});
