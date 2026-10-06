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

  it('cada boton de la pila empieza donde termina el de abajo', () => {
    /*
     * La pila se lee de abajo arriba —`+`, filtrar, buscar, bandeja— y el fallo
     * que se corrigio aqui era un hueco de 28 puntos para un boton de 36, que
     * solo se veia en la pantalla y no en ningun fallo. Por eso se comprueba la
     * cadena entera y no una pareja suelta: el buscador y el filtro son el mismo
     * tamano y solo caben los dos si los dos estan contados.
     */
    const pila = bottomCluster(TEMA);

    const encimaDelMas = pila.fabBottom + pila.fabSize;
    expect(pila.controlsBottom).toBe(encimaDelMas + pila.gap);

    const encimaDelFiltro = pila.controlsBottom + pila.controlsHeight;
    expect(pila.searchBottom).toBe(encimaDelFiltro + pila.gap);

    const encimaDelBuscador = pila.searchBottom + pila.searchHeight;
    expect(pila.trayBottom).toBe(encimaDelBuscador + pila.gap);

    // Y que la pila entera quepa con el hueco de verdad: el fallo original era un
    // hueco de 28 para un boton de 36, o sea que **el hueco no era el problema**,
    // era que los numeros estaban escritos a mano y no se comprobaban.
    expect(
      pila.trayBottom,
      'la pila completa tiene que caber sin que un boton pise al siguiente',
    ).toBeLessThan(300);

  });

  it('la cuenta sale de los margenes del tema, no de numeros sueltos', () => {
    const conOtroTema = bottomCluster({ spacing: { lg: 24, sm: 12 } });

    expect(conOtroTema.fabBottom).toBe(24);
    expect(conOtroTema.controlsBottom).toBe(24 + 56 + 12);
    expect(conOtroTema.searchBottom).toBe(24 + 56 + 12 + 36 + 12);
    expect(conOtroTema.trayBottom).toBe(24 + 56 + 12 + 36 + 12 + 36 + 12);
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
  it('la pantalla cuenta la pila y no unos numeros escritos a mano', () => {
    expect(LISTA).toContain('bottomCluster(');

    // Lo que se comprueba ahora: **el boton de buscar usa la cuenta**. Antes esto
    // miraba que la bandeja cogiera `trayBottom`, y la bandeja ya no esta — se
    // sustituyo por el buscador, que se mide igual de lejos del borde y por el
    // mismo motivo. Un guard que sigue mirando la pieza que se quito no protege
    // la que se puso.
    expect(LISTA, 'el boton de buscar sale de la pila, no de un numero suelto')
      .toMatch(/bottom: pila\.searchBottom/);
  });

  it('la bandeja de completados no vuelve a la esquina', () => {
    // Se quito porque es un sitio donde lo hecho vive aparte, y un sitio aparte
    // no se busca: una bandeja se recorre con el pulgar, no se consulta con una
    // palabra. Y con el buscador trayendo los dos lados, no anade nada que no
    // tuviera ya — solo un sitio mas donde lo de arriba no esta.
    expect(LISTA, 'la bandeja no se vuelve a montar').not.toContain('<DoneTray');
    expect(LISTA, 'ni a importar').not.toContain('done-tray');
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

describe('el boton de filtro flotando es solo el icono', () => {
  const controles = readFileSync(
    join(import.meta.dirname, '../src/components/lists/list-controls.tsx'),
    'utf8',
  );

  it('flotando se dibuja sin texto, y el texto se queda para el lector', () => {
    // Decía "Filtros · Como yo lo pongo" encima del `+`: 160 puntos en una pantalla
    // de 390 para el estado de un control. Con `iconOnly` el `Button` sigue
    // poniendo el `accessibilityLabel` entero, asi que un lector de pantalla no
    // pierde nada — solo se deja de pintar texto que ya esta en la hoja.
    const flotante = controles.match(/placement === "floating"[\s\S]*?<\/View>/)?.[0] ?? '';
    expect(flotante, 'el boton flotante tiene que pedir solo icono').toContain('iconOnly');

    // Y el texto se sigue calculando: `iconOnly` **no** es "sin etiqueta". Eso vive
    // en `Button`, asi que el guard mira alli y no aqui.
    const button = readFileSync(
      join(import.meta.dirname, '../src/components/ui/button.tsx'),
      'utf8',
    );
    expect(
      button,
      'un boton que solo dibuja y no dice nada es un boton con dos nombres segun como preguntes',
    ).toContain('accessibilityLabel={label}');
  });

  it('el inline no se toca: ahi el ancho no es el problema', () => {
    // El inline esta en una barra o un encabezado con sitio de sobra, y ahi la
    // frase es lo que dice que el boton abre filtros **y** orden. Quitarlo seria
    // quitar informacion que en esa posicion si cabe.
    //
    // Se mira **el segundo sitio de llamada**, no se cuentan las apariciones de
    // `iconOnly`: contar es fragil —la cuenta se equivoca en cuanto alguien anade
    // una mencion en un comentario— y ademas no dice *donde* esta el problema.
    const llamadas = controles.match(/<ListControlsButton[\s\S]*?\/>/g) ?? [];
    expect(llamadas.length, 'un sitio flotante y uno en linea').toBe(2);
    expect(llamadas[0], 'el flotante es solo icono').toContain('iconOnly');
    expect(llamadas[1], 'el en linea conserva la frase').not.toContain('iconOnly');
  });
});
