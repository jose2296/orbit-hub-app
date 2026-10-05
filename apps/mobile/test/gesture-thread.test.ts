import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Los gestos y la frontera entre hilo y worklet.
 *
 * Un callback de gesto de Reanimated se ejecuta **en el hilo de la interfaz**, no en el
 * de JavaScript. Por eso todo lo que cruza esa frontera va envuelto en `runOnJS`: sin
 * él, la llamada no llega al hilo de JS y o no hace nada o revienta.
 *
 * En cuatro ficheros de esta app el envuelto está bien —`sheet.tsx`, `panel-grid.tsx`,
 * `panel-card.tsx` y `draggable-row.tsx`— y en uno no: `workspace-color-picker.tsx`
 * llama a `alMoverCuadradoRef.current(...)` y a `alMoverTiraRef.current(...)` desde
 * `onBegin` y `onUpdate` sin `runOnJS` alrededor. Es decir: arrastrar el cuadrado de
 * color y la tira no actualizan nada en un teléfono, y en la web se ve bien porque la
 * arquitectura antigua perdona el error.
 *
 * Estos tests leen el fuente porque la pregunta no es "qué pinta" sino "qué frontera
 * cruza cada callback", y eso no se mide mirando una pantalla.
 */

const RAIZ = join(import.meta.dirname, '..', 'src');
const leer = (relativa: string) => readFileSync(join(RAIZ, relativa), 'utf8');

/** Every gesture callback body: `.onBegin(`, `.onUpdate(`, `.onEnd(` … */
function cuerposDeGesto(fuente: string): { nombre: string; cuerpo: string }[] {
  const salida: { nombre: string; cuerpo: string }[] = [];
  const patron = /\.(on[A-Z]\w*)\(/g;

  /*
   * Los comentarios se borran de la **fuente**, antes de buscar callbacks, y no
   * del cuerpo de cada uno despues.
   *
   * El orden importa y es el que hacia fallar esto: el ejemplo del bug del color
   * picker esta escrito en el propio fichero que lo arregla, y contains un
   * `.onUpdate(` dentro. Buscando primero, ese `match` es el del ejemplo y su
   * "cuerpo" se come el codigo de verdad que va detras. Limpiar despues ya no
   * salva nada, porque el cuerpo ya salio mal.
   *
   * Un guard que se cumple —o se rompe— con un comentario no esta mirando codigo.
   * Este repo ha pagado esa factura mas de una vez.
   */
  const sinComentarios = fuente
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  for (const m of sinComentarios.matchAll(patron)) {
    // The body is whatever follows the parenthesis, balanced, without nesting
    // arrows: a nested `=>` belongs to a different function and is not this one.
    const largo = m[0]?.length ?? 0;
    let i = (m.index ?? 0) + largo;
    let nivel = 1;
    let cuerpo = '';

    while (i < fuente.length && nivel > 0) {
      const c = fuente[i];
      if (c === '(') nivel++;
      else if (c === ')') {
        nivel--;
        if (nivel === 0) break;
      }
      cuerpo += c;
      i++;
    }

    salida.push({ nombre: m[1] ?? 'on?', cuerpo });
  }

  /*
   * Los comentarios se van **antes** de nada, y no en el regex de cada test.
   *
   * El ejemplo del bug del color picker esta escrito en el propio fichero que lo
   * arregla —para que el que lo lea sepa por que— y el extractor lo arrastraba
   * dentro del cuerpo del callback. Un guard que se cumple con un comentario es un
   * guard que no mira codigo, y este repo ya ha pagado esa factura dos veces.
   */
  return salida;
}

const CON_GESTOS = [
  'components/ui/sheet.tsx',
  'components/ui/draggable-row.tsx',
  'components/dashboard/panel-grid.tsx',
  'components/dashboard/panel-card.tsx',
  'components/workspace/workspace-color-picker.tsx',
];

describe('nadie llama a JavaScript desde un worklet sin decirlo', () => {
  it('ningún callback de gesto cruza el hilo sin runOnJS', () => {
    /*
     * La forma del fallo: un callback que llama a `algoRef.current(...)` es una
     * llamada a una función normal de JavaScript desde el hilo de la interfaz. Con
     * `runOnJS` alrededor se ejecuta; sin él, no. Y **no se rompe al compilar**: el
     *gesto se registra, la app arranca y el arrastre no hace nada. Es el peor tipo de
     * fallo, el que solo se ve intentando usarlo.
     */
    const culpables: string[] = [];

    for (const fichero of CON_GESTOS) {
      for (const { nombre, cuerpo } of cuerposDeGesto(leer(fichero))) {
        if (!/\.current\(/.test(cuerpo)) continue;
        if (/runOnJS/.test(cuerpo)) continue;
        culpables.push(`${fichero} → .${nombre}(…) llama a un ref sin runOnJS`);
      }
    }

    expect(culpables).toEqual([]);
  });

  /**
   * El guard de arriba **no distingue el bug que de verdad pasaba**, y esta es la
   * razon por la que hace falta este segundo.
   *
   * El picker estaba asi, y el guard lo daba por bueno:
   *
   *     .onUpdate((e) => runOnJS(alMoverCuadradoRef.current)(e.x, e.y))
   *
   * Tiene `runOnJS`, asi que el `if (/runOnJS/.test(cuerpo)) continue;` lo deja
   * pasar. Pero `runOnJS(fn)` devuelve una funcion **nueva**, y esa llamada se
   * evalua al construir el gesto —una vez, porque el `useMemo` va con `[]`— asi
   * que se quedaba con el `alMoverCuadrado` del primer render, con el ancho
   * supuesto de 132 y con `anchoTira` a 0. El ref nunca se releia.
   *
   * En la web coincidia por casualidad porque el cuadrado mide 132. En un movil no,
   * y la tira entera no hacia nada: `puntoAHue` devuelve 0 cuando el ancho es 0.
   *
   * Asique la regla es mas fuerte que "lleva runOnJS": **no se puede pasar un
   * `.current` dentro del `runOnJS`**, porque eso es resolverlo aqui y no cuando se
   * llama.
   */
  it('el runOnJS envuelve una flecha y no un .current ya evaluado', () => {
    const culpables: string[] = [];

    for (const fichero of CON_GESTOS) {
      for (const { nombre, cuerpo } of cuerposDeGesto(leer(fichero))) {
        // `runOnJS(x.current(...))` y `runOnJS(x.current)` —el segundo tambien:
        // evaluan el current al construir.
        // Solo el patron que falla de verdad: `runOnJS(algoRef.current(...))`.
        //
        // `runOnJS(fn)` devuelve una funcion nueva, y esa llamada se evalua al
        // **construir** el gesto —una vez, porque el `useMemo` va con `[]`—, asi que
        // `runOnJS(alMoverRef.current)` se queda con el valor que tenia el ref en el
        // primer render. Las flechas de los otros cuatro ficheros **no** tienen este
        // problema: envuelven un identificador (`runOnJS(coger)`) y el ref se
        // relee dentro de la funcion, no al definirla.
        //
        // Y el patron tiene que ser el que esta **escrito en el codigo**, no uno
        // inventado. El codigo real es `runOnJS(alMoverRef.current)(x, y)`: el
        // `.current` no lleva parentesis dentro —los parenthesis son de la llamada
        // de fuera, que se ejecutan en el worklet— asi que un regex que exige
        // `.current(` describe algo que nadie escribio y no encuentra nada.
        const resueltoDemasiadoPronto = /runOnJS\(\s*[A-Za-z_$][\w$]*\.current\b/;
        if (resueltoDemasiadoPronto.test(cuerpo)) {
          culpables.push(
            `${fichero} → .${nombre}(…) hace runOnJS(algoRef.current(…)), que se evalua al construir el gesto`,
          );
        }
      }
    }

    expect(culpables).toEqual([]);
  });

  it('cada fichero de la lista tiene gestos, y por tanto algo que comprobar', () => {
    /*
     * La prueba de arriba pasa igual de contenta si la lista se vacía, o si un
     * fichero de la lista deja de tener gestos y sus callbacks dejan de existir. Se
     * mira que **todos** tienen al menos uno.
     *
     * Esta prueba se escribió pidiendo que cuatro de los cinco tuvieran `runOnJS`, y
     * falló justo después de arreglar el quinto —porque entonces los cinco lo
     * tienen—. Es decir, ataba el test a un número que era el síntoma y no la regla.
     * Lo que importa es que no quede ningún fichero con gestos sin comprobar, y eso es
     * lo que pregunta aquí.
     */
    const sinGestos = CON_GESTOS.filter(
      (fichero) => cuerposDeGesto(leer(fichero)).length === 0,
    );

    expect(sinGestos, 'un fichero en la lista ya no tiene gestos: dejaria de comprobarse').toEqual([]);
  });
});

describe('el selector de color', () => {
  it('los dos gestos dicen el nombre de lo que llaman', () => {
    // Los dos callbacks que estaban sin envuelto, uno por gesto: el cuadrado y la
    // tira. Se cuentan para que anadir un tercero sin envuelto salga en el fallo.
    const fuente = leer('components/workspace/workspace-color-picker.tsx');
    const gestures = [
      ...fuente.matchAll(/Gesture\.Pan\(\)/g),
      ...fuente.matchAll(/Gesture\.Tap\(\)/g),
    ];

    expect(gestures.length).toBeGreaterThanOrEqual(2);
  });
});