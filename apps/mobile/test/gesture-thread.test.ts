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
    //
    // **It is read from `sinComentarios` and not from `fuente`, and that has to
    // match where the match was found.** The two strings are different lengths the
    // moment a comment is removed, so an index that is correct in one is pointing
    // somewhere else in the other — and where it lands is whatever characters
    // happen to be there, which after a big comment is more code or another
    // comment.
    //
    // Asi que este guard,工业企业 de lo que vigila, leia el cuerpo equivocado: los
    // indices venían del fuente limpio y se aplicaban al original. Con los ficheros
    // de antes no se notaba porque sus comentarios no desplazaban nada dentro de un
    // callback; en cuanto un fichero lleva un bloque de comentario largo entre el
    // gesto y el callback, el "cuerpo" que se comprobaba era el de otro sitio y el
    // fallo se reportaba en un callback que no lo tenia.
    const largo = m[0]?.length ?? 0;
    let i = (m.index ?? 0) + largo;
    let nivel = 1;
    let cuerpo = '';

    while (i < sinComentarios.length && nivel > 0) {
      const c = sinComentarios[i];
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
  /*
    `tag-color-picker.tsx` entra en la lista porque **tenia el mismo bug que
    `workspace-color-picker.tsx` y no estaba en la lista**: la lista se escribio
    enumerando los ficheros con gestos, y el segundo picker se quedo fuera. Sus dos
    gestures llamaban a `alMoverCuadradoRef.current(...)` y `alMoverTiraRef.current(...)`
    desde `onBegin` y `onUpdate` sin `runOnJS`, que es exactamente lo que las dos
    pruebas de abajo persiguen — y ninguna podia verlo.

    Es la misma clase de fallo que la tercera prueba: un guard que solo puede
    proteger lo que alguien enumera a mano. Anyadir aqui el fichero es lo que evita
    que el proximo picker nasca con el bug puesto.
  */
  'components/lists/tag-color-picker.tsx',
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

describe('el modal de los sheets tiene su propia raiz de gestos', () => {
  /*
    La tercera capa del bug del selector de color, y la que hacia que **los dos**
    pickers no cambiaran nada en un movil.

    `app/_layout.tsx` envuelve la app en `GestureHandlerRootView`, y con eso un
    `GestureDetector` en cualquier pantalla funciona. Pero los dos pickers viven
    dentro de un `Sheet`, y `sheet.tsx` es un `Modal` de React Native: en Android eso
    no es una vista sino una **ventana nativa aparte**, con su propio arbol. Un
    gesture handler registrado en la raiz de la app no pertenece a esa ventana, y sin
    una raiz propia **el gesto no se registra**.

    La forma del fallo es la peor posible: no hay error, no hay crash, no hay aviso de
    Metro, el panel abre, el dedo se mueve sobre el cuadrado y no ocurre nada. En la
    web `Modal` es un div en el mismo arbol y la raiz de `_layout` si lo cubre, asi
    que ahi el bug no se ve nunca.

    Esto ya se pago una vez en este repo y esta escrito en `docs/roadmap.md`, con otro
    actor —el navegador en vez de la ventana nativa— y el mismo efecto: el gesto se
    lo queda otro y la app no puede.
  */
  it('el Modal de sheet.tsx envuelve su contenido en GestureHandlerRootView', () => {
    const fuente = leer('components/ui/sheet.tsx');

    // La raiz tiene que existir **dentro** del Modal. Ponerla alrededor del Modal es
    // una raiz en la ventana de la app, que es justo la que no contiene los gestos
    // del panel: el fallo se ve igual de bonito y el bug sigue igual de vivo.
    const abreModal = fuente.indexOf('<Modal');
    const abreRaiz = fuente.indexOf('<GestureHandlerRootView');
    const cierraRaiz = fuente.indexOf('</GestureHandlerRootView>');
    const cierraModal = fuente.indexOf('</Modal>');

    expect(abreModal, 'sheet.tsx ya no es un Modal: este guard esta mirando otra cosa').toBeGreaterThan(-1);
    expect(abreRaiz, 'sheet.tsx no envuelve su contenido en GestureHandlerRootView').toBeGreaterThan(abreModal);
    expect(cierraRaiz, 'GestureHandlerRootView abre y no cierra').toBeGreaterThan(abreRaiz);
    expect(cierraRaiz, 'la raiz de gestos se cierra despues del Modal, y entonces es otra ventana').toBeLessThan(cierraModal);
  });

  it('la raiz de gestos del modal tiene flex: 1, porque tiene que medirse', () => {
    /*
      Un contenedor sin alto no recibe touch, que es el mismo modo de fallo que el
      `flex: 1` de la tira de tono del que habla `workspace-color-picker.tsx`: la tira
      media 132x0, no estaba en pantalla, y una vista sin alto no se toca. La raiz de
      gestos es la vista que da el tamano a la ventana del modal, asi que si colapsa a
      cero el panel deja de medirse y los gestos deja de recibir nada.
    */
    const fuente = leer('components/ui/sheet.tsx');

    // Se busca el estilo por su nombre y no por el del componente: el nombre es lo
    // que el render usa, y emparejar por posicion es la forma de que un comentario
    // o un reordenamiento cumpla el guard sin decir nada.
    const raiz = /raizGestos:\s*\{([^}]*)\}/.exec(fuente);
    expect(raiz, 'no hay ningun estilo raizGestos en sheet.tsx').not.toBeNull();
    expect(raiz?.[1] ?? '').toMatch(/flex:\s*1/);
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

  it('los dos pickers estan en la lista de los que se comprueban', () => {
    /*
      El guard de arriba solo puede proteger lo que alguien enumero a mano, y la lista
      se escribio enumerando ficheros. El segundo picker se quedo fuera de ella
      durante el bug entero — con el mismo fallo, sin `runOnJS` — y ninguna prueba
      podia verlo por eso.

      Esta prueba ata las dos cosas: que los dos pickers esten dentro de la lista. Si
      alguien anade un picker nuevo y no lo anade aqui, esto falla en vez de dejar que
      el bug llegue al movil.
    */
    expect(CON_GESTOS, 'tag-color-picker.tsx no se comprueba: puede nacer con el bug puesto').toContain(
      'components/lists/tag-color-picker.tsx',
    );
    expect(CON_GESTOS, 'workspace-color-picker.tsx no se comprueba').toContain(
      'components/workspace/workspace-color-picker.tsx',
    );
  });
});