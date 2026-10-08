import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The four things a task row draws, and the three that are only broken on a phone.
 *
 * Every assertion here is about the **source**, not about a rendered tree: this
 * suite runs in `node` with React Native stubbed, so nothing measures a pixel and
 * nothing can catch Yoga. What it can do is stop the four shapes below from
 * coming back, which is what happened once already — see `styles.nombre` in
 * `components/lists/task-row.tsx` for a comment that blamed the wrong file and
 * fixed nothing.
 *
 * The measurements that found them are in the comments on the code they guard, and
 * they were taken on an Android release build (API 35), not reasoned about.
 */
const RAIZ = join(import.meta.dirname, '..');
const src = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');

/**
 * A source file **without its comments**, because these components explain in prose
 * exactly what the assertions below ask about — `badge.tsx` says what `compact` is
 * for, and the new `onPress` says in as many words that it is optional and that
 * nothing changes without it.
 *
 * Without stripping them, `expect(badge).toContain('onPress?: () => void')` passes
 * the moment somebody writes the prop in a doc comment and has not implemented
 * anything, and `not.toContain('onPress')` fails against a paragraph explaining why
 * the prop is there. Both would report the opposite of what they measure.
 *
 * The `[^:]` before `//` is so an `http://` in an import is not cut in half.
 */
const sinComentarios = (texto: string): string =>
  texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * The opening tag of every `<Name …>` in a source, as its own text.
 *
 * **The opening tag and not the element**, and that distinction is the whole
 * difference between "this pill is given a press" and "something inside this pill
 * has one". The sheet's `TagChip`s put two `Pressable`s inside —take the label off,
 * give it a colour— and a regexp that ran to the first `/>` would stop on the
 * `<Ionicons … />` of the first of them and read its `onPress={() => toggleTag(tag)}`
 * as a prop of the pill.
 *
 * So it walks to the `>` that closes the tag, counting braces: an arrow function in
 * a prop value is `=>` inside `{…}`, and a `>` there is not the end of anything.
 */
const aperturas = (fuente: string, nombre: string): string[] => {
  const salida: string[] = [];
  const marca = `<${nombre}`;
  let desde = 0;
  for (;;) {
    const inicio = fuente.indexOf(marca, desde);
    if (inicio < 0) return salida;
    // `<BadgeProps` is not a `<Badge`, and a regexp with a `\b` would also not be
    // enough for a name that ends in a letter and is followed by one.
    const siguiente = fuente[inicio + marca.length];
    if (siguiente && /[A-Za-z0-9_$]/.test(siguiente)) {
      desde = inicio + marca.length;
      continue;
    }
    let i = inicio + marca.length;
    let llaves = 0;
    while (i < fuente.length && !(fuente[i] === '>' && llaves === 0)) {
      if (fuente[i] === '{') llaves += 1;
      if (fuente[i] === '}') llaves -= 1;
      i += 1;
    }
    salida.push(fuente.slice(inicio, i + 1));
    desde = i + 1;
  }
};

/** Every `.tsx` under `src`, so "nobody else got a press" can be asked of the whole app. */
const ficherosTsx = (directorio = join(RAIZ, 'src')): string[] =>
  readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(directorio, entrada.name);
    if (entrada.isDirectory()) return ficherosTsx(ruta);
    return entrada.name.endsWith('.tsx') ? [ruta] : [];
  });

/**
 * The browser script, read from a test that already runs in `node`.
 *
 * `drawer-push.test.ts` reads `scripts/verify-drawer.mjs` the same way, so there is
 * a precedent and it is not a new thing this suite does.
 */
const verifyTag = readFileSync(
  fileURLToPath(new URL('../../../scripts/verify-tag-colors.mjs', import.meta.url)),
  'utf8',
);

const checkbox = src('src/components/ui/checkbox.tsx');
const badge = src('src/components/ui/badge.tsx');
const listId = src('src/app/(app)/list/[listId].tsx');
const taskRow = src('src/components/lists/task-row.tsx');
const appHeader = src('src/components/ui/app-header.tsx');
const screen = src('src/components/ui/screen.tsx');
const spaceBand = src('src/components/workspace/space-band.tsx');
const statePickerSheet = src('src/components/lists/state-picker-sheet.tsx');
const boardScreen = src('src/app/(app)/board/[listId].tsx');
const itemPresentation = src('src/lib/lists/item-presentation.ts');
const tagChip = src('src/components/lists/tag-chip.tsx');
const itemEditSheet = src('src/components/lists/item-edit-sheet.tsx');

describe('la casilla no se come la fila', () => {
  /**
   * `flex: 1` on an **empty** `Text` grows into the whole row, and the title that
   * shares it gets nothing.
   *
   * Measured: the checkbox took 755 of the row's 754 points of content width, so
   * `styles.flex` measured zero — no title painted, the urgency badge crushed to
   * ten points wide and wrapping one letter per line. An empty element measures
   * zero in a browser however it is styled, which is why this was invisible on the
   * web and on a dev server, and only showed up in a release build.
   *
   * `flex: 1` may stay where it is: the four call sites that pass a label want it
   * to fill the row. What may not come back is an empty one.
   */
  it('no pinta una etiqueta que no le han dado', () => {
    expect(checkbox).toContain('{label ? (');
  });

  it('la casilla se alinea con la linea del titulo, no con la fila entera', () => {
    // El arreglo **lo hizo `main` en 81beddc**, no esta rama: movio la casilla
    // *dentro* de `styles.titulo` y exporto `CHECKBOX_BOX_SIZE`. Aqui lo que se
    // guarda es que no vuelva a salir como hermana de la columna.
    //
    // Antes la fila tenia dos hijos flex — la casilla y la columna — y
    // `alignItems: "center"` centraba la casilla contra las dos, de modo que en una
    // fila con insignia quedaba visiblemente mas baja que el icono, y con dos
    // lineas de titulo la diferencia crecia.
    //
    // Y el assertion va contra **la posicion**, no contra una cadena: el fallo de
    // esta suite una vez fue un `not.toContain('alignItems: "center"')` que se
    // satisfacia igual con `flex-start`, que no alinea nada porque la fila tiene
    // un solo hijo. Comprobar que una cosa no es una cosa concreta vale solo si la
    // alternativa se puede distinguir.
    // El intervalo, no un `indexOf` suelto: hay **dos** `<Checkbox` en el fichero
    // —el otro es el de la bandeja de lo hecho— asi que buscar el primero从上
    // daria el de otro componente y la comprobacion pasaria siempre.
    const linea = taskRow.indexOf('item-title-line-');
    const meta = taskRow.indexOf('styles.meta,');
    expect(
      linea,
      'la linea del titulo necesita su propio testID, que es lo que permite medirla'
    ).toBeGreaterThan(-1);
    expect(meta, 'la segunda linea de la columna es el ancla de cierre').toBeGreaterThan(linea);
    const casilla = taskRow.indexOf('<Checkbox', linea);
    expect(
      casilla,
      'la casilla tiene que dibujarse dentro de la linea del titulo, no al lado de la columna'
    ).toBeGreaterThan(linea);
    expect(casilla, 'o ha vuelto a salir antes de abrir la linea del titulo').toBeLessThan(meta);
  });

  it('styles.item no alinea nada, porque la fila tiene un solo hijo flex', () => {
    // Y esto no es `not.toContain('alignItems: "center")`: es que **ningun**
    // `alignItems` tiene sentido aqui. Con un hijo, alinear no tiene a que, y un
    // `flex-start` ahi es un numero que no hace nada y que el siguiente que lea
    // el fichero va a usar creyendo que alinea algo.
    const item = taskRow.match(/  item:\s*\{[\s\S]*?\n  \}/)?.[0] ?? '';
    expect(item, 'styles.item debe seguir existiendo').toContain('flexDirection: "row"');
    expect(
      item,
      'la fila tiene un solo hijo flex: cualquier alignItems aqui es codigo muerto'
    ).not.toMatch(/alignItems/);
  });

  it('el nodo de la etiqueta esta dentro de esa condicion', () => {
    // Not "there is no label prop" — there is a prop, and `sign-up` and the item
    // panel pass text to it. The claim is that an empty one is not rendered.
    const etiqueta = checkbox.match(/\{label \? \([\s\S]*?\{label\}[\s\S]*?\) : null\}/);
    expect(etiqueta).not.toBeNull();
    // And it is the only place the label is drawn.
    expect([...checkbox.matchAll(/\{label\}/g)]).toHaveLength(1);
  });
});

describe('la insignia no se aplasta', () => {
  /**
   * A pill that gets narrow is not a pill.
   *
   * Measured on the same build: 53 points wide and 145 tall, "High" ten points
   * wide wrapping one letter per line, and a row four times the height of its
   * content. `flexShrink: 0` is what makes the badge the fixed thing and the
   * labels the thing that yields.
   */
  it('no se encoge', () => {
    expect(badge).toContain('flexShrink: 0');
  });
});

describe('la insignia y la pastilla abren la tarea, y no con un envoltorio', () => {
  const insignia = sinComentarios(badge);
  const pastilla = sinComentarios(tagChip);

  /**
   * Las dos mitades del mismo contrato, y se comprueban **las dos**.
   *
   * Una prop declarada y no usada pasa una comprobación que busca la prop, y una
   * fila que se la pasa a un componente que la ignora pasa una que busca el
   * `onPress` en la fila. Por eso el `onPress` se cuenta en el que lo declara y el
   * `onPress={onEdit}` se cuenta en la fila, y por eso el numero de cada uno esta
   * escrito en vez de "esta ahi".
   */
  it('las dos lo aceptan, y las dos lo cuentan una vez', () => {
    for (const [componente, fuente] of [
      ['Badge', insignia],
      ['TagChip', pastilla],
    ] as const) {
      const pulsable = fuente.indexOf('<Pressable');
      expect({
        componente,
        declarada: (fuente.match(/onPress\?: \(\) => void/g) ?? []).length,
        usada: (fuente.match(/onPress=\{onPress\}/g) ?? []).length,
      }).toEqual({ componente, declarada: 1, usada: 1 });
      /**
       * Y la misma cuenta para `hintProps`, **y el sitio donde se aplica**: sólo en
       * la rama del `Pressable`.
       *
       * Es la parte de la accesibilidad que se puede perder sin que se note. Sin
       * rol, un pulsable se sigue pulsando; **sin pista no**, y no hay ni un píxel
       * que cambie: quitar el `{...pistaNombre.props}` de la fila deja este bloque
       * entero en verde y la única pista de la fila —«Toca para cambiarlo»— se
       * queda en el nombre, con la insignia y las pastillas abriendose sin decir
       * qué hacen. Medido: se puede quitar de los dos sitios y sale verde.
       *
       * **Y en la rama del `View` no**, y no por descuido: una pista describe lo
       * que hace **activar**, y sin `onPress` no hay nada que activar. Por eso el
       * corte es por posición y no por presencia —una comprobación que buscara el
       * texto encontraría el `hintProps` del `Pressable` y daría verde con el del
       * `View` puesto también.
       */
      expect({
        componente,
        declarada: (fuente.match(/hintProps\?: Record<string, string>/g) ?? []).length,
        enElPulsable: fuente.slice(pulsable).includes('{...hintProps}'),
        enElView: fuente.slice(0, pulsable).includes('{...hintProps}'),
      }).toEqual({
        componente,
        declarada: 1,
        enElPulsable: true,
        enElView: false,
      });
    }
  });

  /**
   * Sin `onPress` el árbol sale **identico**, y esta es la comprobacion que lo dice.
   *
   * Un `Pressable` por componente y no un `View` con un `Pressable` alrededor, y
   * solo uno de los dos raices: la caja de la que la fila mide es la caja que lleva
   * `flexShrink`, y un envoltorio se la quedaria. `Badge` se usa en toda la app y
   * `TagChip` en las dos filas de la hoja, asi que la rama sin `onPress` no puede
   * haber cambiado de ninguna manera — y por eso el `if (!onPress)` va escrito: sin
   * el, cambiar el `View` de abajo por un `Pressable` dejaria el conteo igual.
   *
   * **Y en la rama del `View` de `Badge` están los dos props que no son de estilo,
   * que antes no se comprobaban.** Ver el bloque de abajo, dentro del test.
   *
   * **El rol se cuenta narrowed al que cambia el elemento, y tiene que estar en la
   * rama del `Pressable`.** Antes este bloque prohibía cualquier
   * `accessibilityRole`, y eso eran dos cosas equivocadas a la vez: en
   * `react-native-web@0.21.2` sólo `roleComponents` devuelve un tag —`"text"`,
   * `"none"`, `"summary"`, `"adjustable"` no cambian el elemento y son legítimos— y
   * además convertía **en rojo el arreglo correcto**, porque el arreglo es poner
   * `accessibilityRole="button"`. Un test que hay que editar para que entre el
   * código bueno tiene un camino de salida de un minuto: subir el número. Así que
   * aquí no se cuenta "cuántos roles hay" sino **"cuántos cambian el elemento, y
   * dónde"**: exactamente uno por fichero, y dentro de la rama que se pinta
   * `<Pressable>`, porque un rol en la rama del `View` convertiría las quince
   * insignias que no se pulsan en `<button>` — que es el daño real, y el contrario
   * del que este test creía impedir.
   */
  it('sin onPress sale el mismo View de siempre', () => {
    for (const [componente, fuente] of [
      ['Badge', insignia],
      ['TagChip', pastilla],
    ] as const) {
      const cuenta = (patron: RegExp) => (fuente.match(patron) ?? []).length;
      // Lo que va antes del `<Pressable>` es la rama del `View`, y lo que va
      // detrás es la del `Pressable`: es la única forma de decir *dónde* está el rol.
      const pulsable = fuente.indexOf('<Pressable');
      const ramaDelPulsable = fuente.slice(pulsable);
      expect({
        componente,
        vistas: cuenta(/<View\b/g),
        pulsables: cuenta(/<Pressable\b/g),
        elToqueEnElPulsable: cuenta(/onPress=\{onPress\}/g),
        // Sólo el que `propsToAccessibilityComponent` traduce en un tag.
        rolesQueCambianElElemento: cuenta(/accessibilityRole=["'{]button/g),
        elRolEstaEnElPulsable: /accessibilityRole=["'{]button/.test(ramaDelPulsable),
        saleElViewSinToque: /if \(!onPress\)/.test(fuente),
      }).toEqual({
        componente,
        vistas: 1,
        pulsables: 1,
        elToqueEnElPulsable: 1,
        rolesQueCambianElElemento: 1,
        elRolEstaEnElPulsable: true,
        saleElViewSinToque: true,
      });
    }

    /**
     * Y en la rama del `View` de `Badge`, los dos props que no son de estilo, que
     * antes no se comprobaban y que son los que **borran el nombre accesible de
     * quince insignias de la app** sin que nada se entere.
     *
     * Quitar `accessibilityLabel` de ahí deja los seis tests de este bloque en
     * verde —no hay ni un píxel cambiado— y **borra en silencio el nombre
     * accesible de quince insignias**: una cuenta de completadas que se anuncia
     * como «2», un «Este dispositivo», el tipo de una película, el «Hecho» del
     * panel. Quince sitios dependen de esta línea y ninguno falla si desaparece:
     * `item/[itemId].tsx:650`, `drawer.tsx:572` y `:624`, `sync.tsx:104` y `:138`.
     *
     * **Sólo `Badge`, y no los dos componentes**: `TagChip` nunca ha llevado
     * `accessibilityLabel` ni `testID` —su nombre accesible es el de la etiqueta,
     * que escribe dentro— y exigirle dos props que no ha tenido nunca sería un test
     * que se pone rojo para siempre y se borra.
     */
    const ramaDelView = insignia.slice(0, insignia.indexOf('<Pressable'));
    expect({
      conservaElNombreAccesible: ramaDelView.includes('accessibilityLabel={accessibilityLabel}'),
      conservaElTestId: ramaDelView.includes('testID={testID}'),
      // Y que sea la rama del `View` y no un comentario: los dos van en el mismo
      // `<View>` que el `style`, y sin esto el `includes` encontraría el prop en el
      // `Pressable` de abajo y daría verde con la rama vacía.
      elViewEsLaQueLosDeclara: /<View[\s\S]*accessibilityLabel=\{accessibilityLabel\}[\s\S]*testID=\{testID\}/.test(
        ramaDelView,
      ),
    }).toEqual({
      conservaElNombreAccesible: true,
      conservaElTestId: true,
      elViewEsLaQueLosDeclara: true,
    });
  });

  /**
   * La fila se abre desde el nombre, y ahora tambien desde las dos cosas de su
   * segunda linea — **las dos, y no una**: una insignia que abre y una pastilla que
   * no es el mismo boton a medio hacer.
   *
   * Y los tres con el mismo `onEdit`, porque los tres abren lo mismo. El conteo
   * importa: `onPress={onEdit}` en la fila lo lleva el nombre desde hace tiempo, asi
   * que buscar el texto daria verde con dos de los tres cambiados y sin ningun
   * boton nuevo.
   */
  it('la fila lo pasa a la insignia y a la pastilla, igual que al nombre', () => {
    const soloLaFila = sinComentarios(taskRow).slice(
      sinComentarios(taskRow).indexOf('function TaskRow('),
    );
    expect({
      insignias: aperturas(soloLaFila, 'Badge').length,
      pastillas: aperturas(soloLaFila, 'TagChip').length,
      aperturasQueAbren: (soloLaFila.match(/onPress=\{onEdit\}/g) ?? []).length,
    }).toEqual({ insignias: 1, pastillas: 1, aperturasQueAbren: 3 });
    // Y en las dos, por su nombre: el conteo de arriba pasa igual si el `onEdit` se
    // llegara al nombre por segunda vez en lugar de a la insignia.
    expect(aperturas(soloLaFila, 'Badge')[0]).toContain('onPress={onEdit}');
    expect(aperturas(soloLaFila, 'TagChip')[0]).toContain('onPress={onEdit}');
    /**
     * Y las dos llevan **la pista del nombre**, no una suya.
     *
     * Todos los controles de una fila abren lo mismo, así que la frase va escrita
     * una vez —como el nodo que `pistaNombre.node` ya ponía al lado del nombre— y
     * todos sus `aria-describedby` apuntan ahí. Varias copias de «Toca para
     * cambiarlo» en el documento serían las mismas palabras varias veces en un lector
     * de pantalla. **Sin número de controles**, porque depende de cuántas etiquetas
     * tenga la tarea: medido, una fila con insignia y dos pastillas son **cuatro**
     * `<button>` apuntando a **un** nodo, y una con una etiqueta son tres.
     *
     * **Como prop, `hintProps={pistaNombre.props}`, y no como un spread.** Medido:
     * `{...pistaNombre.props}` suelta `aria-describedby` en lo alto de `<Badge>` y
     * de `<TagChip>`, que no aceptan props sueltos, se lo comen y no llega a
     * nada — en el DOM quedaba **un** elemento de la fila apuntado a la pista, el
     * nombre, y las pastillas seguían sin decir qué hacen. Un test que buscara
     * `pistaNombre` habría dado verde en los dos casos, y por eso busca la prop.
     *
     * El nombre **sí** lleva el spread, y es lo que lleva desde antes: lo tiene
     * como prop suelta y no dentro de nada. Por eso la negativa va sobre las dos
     * aperturas y no sobre la fila entera — sobre la fila entera sale verde
     * mientras las dos pastillas siguen mudas, que es el fallo entero.
     */
    for (const nombre of ['Badge', 'TagChip']) {
      const apertura = aperturas(soloLaFila, nombre)[0];
      expect(apertura).toContain('hintProps={pistaNombre.props}');
      expect(apertura).not.toContain('{...pistaNombre.props}');
    }
  });

  /**
   * La pastilla de la fila lleva **un poco mas de aire dentro que la del
   * componente**, y solo la de la fila.
   *
   * `TagChip` en `size="compact"` trae `paddingHorizontal: xs` (4), que en la
   * fila se lee apretado al lado de la insignia. La fila le suma `sm` (8) por
   * `style` —que el componente aplica el ultimo, asi que gana— y la hoja no lo
   * lleva: sus pastillas quedan como el componente las dibuja. Medido en el
   * navegador: 8 px a cada lado en las filas, en los dos temas.
   */
  it('la pastilla de la fila suma padding horizontal por style y la hoja no', () => {
    const soloLaFila = sinComentarios(taskRow).slice(
      sinComentarios(taskRow).indexOf('function TaskRow('),
    );
    expect(aperturas(soloLaFila, 'TagChip')[0]).toContain(
      'paddingHorizontal: theme.spacing.sm',
    );
    const hoja = sinComentarios('src/components/lists/item-edit-sheet.tsx');
    for (const apertura of aperturas(hoja, 'TagChip')) {
      expect(apertura).not.toContain('paddingHorizontal');
    }
  });

  /**
   * La fila es **el unico sitio de la app** que le pasa un toque a una insignia o a
   * una pastilla, y se pregunta a todos los `.tsx` en vez de a los que hoy lo hacen.
   *
   * Preguntar solo a los que ya lo hacen es una comprobacion que no puede fallar: si
   * manana se le pasa a la insignia de una cabecera, esta seguiria verde. La lista
   * de los dos sitios esta escrita entera, no la lista menos las excusas.
   *
   * **Y esta se va a poner roja con trabajo legitimo, y eso es lo que tiene que
   * hacer.** No pregunta si el trabajo es bueno, pregunta si hay mas de un sitio: en
   * cuanto cualquier `Badge` o cualquier `TagChip` de la app se haga pulsable —una
   * insignia de una cabecera que abra su contador, una pastilla que abra su
   * selector— sale, aunque sea lo correcto y aunque el otro sitio siga siendo
   * exactamente este. Quien lo encuentre tendra que **decidir**, no subir el
   * numero: la lista se amplia por el motivo de cada uno, o no se amplía.
   *
   * Que hoy solo pueda ser la fila no es una regla de estilo: es que **las otras
   * quince insignias abren otra cosa**. Las de una cabecera son contadores, las de
   * una bandeja son estados, las de un cajón son estados de un sitio, y **una que
   * cuenta no tiene nada que abrir**. La fila abre la tarea, y los tres controles
   * que la abren dicen exactamente lo mismo.
   */
  it('y ningun otro sitio de la app se lo pasa', () => {
    const conToque: string[] = [];
    for (const ruta of ficherosTsx().sort()) {
      const fuente = sinComentarios(readFileSync(ruta, 'utf8'));
      for (const nombre of ['Badge', 'TagChip']) {
        for (const apertura of aperturas(fuente, nombre)) {
          if (/\bonPress\b/.test(apertura)) {
            conToque.push(`${relative(RAIZ, ruta)} <${nombre}>`);
          }
        }
      }
    }
    expect(conToque).toEqual([
      'src/components/lists/task-row.tsx <Badge>',
      'src/components/lists/task-row.tsx <TagChip>',
    ]);
  });

  /**
   * Las dos filas de pastillas de la hoja **no** lo reciben, y es lo que impide que
   * un boton quede dentro de otro boton.
   *
   * Esas pastillas llevan dentro los dos botones de quitar y de color, asi que
   * darlas un toque lasaria pulsarables con dos pulsables dentro — en un telefono
   * el de dentro se queda con el gesto y el de fuera no se entera, y en la web un
   * `click` sube y disparan los dos. Ningun caller los envuelve hoy porque la prop
   * no existia; en cuanto existe, esto es lo que la mantiene sin usar ahi.
   */
  it('las dos filas de pastillas de la hoja no lo reciben', () => {
    const pastillasDeLaHoja = aperturas(sinComentarios(itemEditSheet), 'TagChip');
    expect(pastillasDeLaHoja).toHaveLength(2);
    expect(pastillasDeLaHoja.filter((p) => /\bonPress\b/.test(p))).toEqual([]);
  });

  /**
   * Los detectores de pastillas del guion miran tambien `<button>`, y esta es
   * la comprobacion que sostiene el `accessibilityRole="button"` de los dos
   * componentes.
   *
   * **Va aqui, y no como un "no pongas el rol" en los componentes, por una razon
   * concreta:** un pin sobre la prop obliga a editar el test el dia que llega el
   * arreglo, y editar un test para que entre el codigo bueno tiene un camino de
   * salida de un minuto — subir el numero o borrarlo. Un pin sobre **el otro
   * lado del contrato** no: si alguien deja el guion en `div`, esto se pone rojo y
   * el mensaje es el que importa («tus comprobaciones ya no ven la pastilla»), no
   * «falta un atributo». Y **caduca solo**: el dia que los tres detectores se
   * reescriban bien, quien lo haga ve este test y ve lo que decia.
   *
   * **Cinco y no tres desde la Tarea 7**, que ha anadido dos detectores mas que
   * buscan la pastilla de una fila para **pulsarla** —`pulsarPastilla` y
   * `pulsarInsignia`, los que comprueban que un toque en la pastilla y un toque en la
   * insignia abren la hoja de esa tarea—. Los dos preguntan por `"div,button"` a
   * proposito, por el mismo motivo que los otros tres: en web la pastilla es un
   * `<button>` y un `div` solo mide su envoltorio, que no es pulsable. El numero
   * sigue siendo parte del contrato: si alguien anade un detector de filas o quita
   * uno, este test sale en rojo y dice que mire la lista.
   *
   * Lo que se midio cuando el rol estaba puesto y el guion pedia `div`: las seis
   * comprobaciones de geometria **seguian en verde midiendo cero pastillas**, y
   * `Math.max(...[].map(...))` daba `-Infinity`, de modo que «lo de mas a la
   * derecha llega a 0» salia como una holgura de 0 pt. Un fallo que se lee como una
   * medicion buena, y por eso el filtro de radio 999 importa tanto como el `button`.
   */
  it('y el guion busca la pastilla tambien entre los botones', () => {
    // Solo las que son de una fila. El guion tiene otras `querySelectorAll("div,…")`
    // que buscan la hoja de texto de dentro de un nombre —`div,span,p`— y a esas no
    // les tiene que pasar nada: por eso el `fila.` delante y no un `querySelectorAll`
    // a pelo.
    const colas = [...verifyTag.matchAll(/fila\.querySelectorAll\("div([^")]*)"\)/g)].map(
      (m) => m[1] ?? '',
    );
    expect(colas).toHaveLength(5);
    for (const cola of colas) {
      expect(cola.split(',').map((t) => t.trim())).toContain('button');
    }
  });
});

describe('la pastilla va en negrita, y por una razon que hay que poder comprobar', () => {
  /*
   * **El 600 y no el 500 de `caption` es el peso de una insignia, y es lo que
   * sostiene la lectura de 12 px a 3:1.** Sin este pin, alguien puede volver a
   * quitarlo pensando que es cosmetica, y resulta que es lo que hace que una
   * etiqueta se lea como el texto de color de una insignia de prioridad.
   *
   * **Y el pin mira el 600 y no el contraste**, porque el contraste lo mide
   * `tag-colors.test.ts` sobre la funcion, y aqui lo que se afirma es que el
   * componente **pasa** el peso. Las dos mitades del acuerdo van en sitios
   * distintos a proposito: la cuenta en la funcion, la pintura en el componente.
   */
  it('el texto de la pastilla se pinta con peso 600', () => {
    expect(sinComentarios(tagChip)).toMatch(/fontWeight:\s*["']600["']/);
  });

  /**
   * Y el otro lado del acuerdo, que es que **el bold no baja el liston**: si
   * alguien lee "12 px en negrita" y baja `MIN_LABEL_CONTRAST` pensando que WCAG
   * permite 3:1 para negrita, este test lo dice. WCAG llama texto grande a 18 px, o
   * a 14 px en negrita; `caption` son 12 px, y en negrita siguen siendo 12.
   */
  it('el peso 600 no aparece como motivo para bajar el liston', () => {
    // El comentario de `TagChip` que explica el 600 tiene que decir que el bold no
    // cambia el umbral, y decir los dos numeros de WCAG para que quien lo lea no tenga
    // que buscarlos. Sin esa frase, el 600 se lee como un atajo para 3:1.
    //
    // **El comentario va dentro del bloque `fontWeight`, y se lee aqui a proposito:**
    // `sinComentarios` lo quita de la cuenta, asi que este test mira el codigo limpio
    // y la frase vive en el sitio donde alguien la va a leer al escribir el peso.
    const bloque = tagChip.match(/fontWeight:\s*["']600["'][\s\S]*?\*\//);
    expect(bloque, "el 600 tiene que seguir su explicacion").not.toBeNull();
    expect(bloque?.[0]).toMatch(/no cambia el list[oó]n/i);
    expect(bloque?.[0]).toMatch(/18 px/);
    expect(bloque?.[0]).toMatch(/14 px/);
  });
});

describe('los cuatro botones de prioridad se ven distintos entre si', () => {
  /*
   * **Estaban los cuatro con el color de acento cuando estaban activos**, asi que se
   * elegia a ciegas: los cuatro botones salian del mismo color y lo unico que decia
   * cual estaba elegido era estar pulsado, que se va en cuanto levantas el dedo. Este
   * pin va sobre el **tono por boton** y no sobre el mapa, porque lo que hay que
   * proteger es que los cuatro sean distintos, y un mapa correcto pero con dos tonos
   * iguales pasaria un pin que solo mirase "no es accent".
   */
  it('cada prioridad tiene su propio tono, y los cuatro no se repiten', () => {
    const mapeo = itemPresentation.match(
      /PRIORITY_TONE[^=]*=[\s\S]*?\};/,
    )?.[0];
    expect(mapeo, 'PRIORITY_TONE tiene que existir en item-presentation').toBeDefined();
    const tonos = [...(mapeo ?? '').matchAll(/:\s*"([a-z]+)"/g)].map((m) => m[1]);
    expect(tonos).toEqual(['neutral', 'info', 'warning', 'danger']);
    expect(new Set(tonos).size).toBe(tonos.length);
  });

  it('el boton de la hoja pinta el tono en vez del acento', () => {
    // El `accent` de antes era el bug: los cuatro activos salian iguales. Se mira la
    // hoja limpia de comentarios, y `surfaceMuted` no aparece como relleno de un boton
    // de prioridad: eso era lo que hacia el inactivo.
    // La ventana es de 600 caracteres porque `tonesFor` esta unas lineas mas alla
    // del array de estilos, no dentro: mira el relleno y el texto que salen de ahi.
    const limpio = sinComentarios(itemEditSheet);
    const bloque = limpio.match(/PRIORITY_TONE[\s\S]{0,1200}?styles\.priority[\s\S]{0,400}?\]\}/)?.[0];
    expect(bloque, 'el boton de prioridad tiene que existir').toBeDefined();
    expect(bloque).not.toMatch(/theme\.colors\.accent\b/);
    expect(bloque).toMatch(/tonesFor\(/);
  });

  /**
   * Y que el mapa **no tenga dos copias**, que es la causa de raiz: estaba dentro de
   * `[listId].tsx` y el boton de la hoja hacia lo de otra manera. Un pin sobre "el
   * fichero ya no lo define" vale mas que un pin sobre "el otro fichero lo importa",
   * porque el segundo pasa mientras alguien tenga el mapa definido en los dos.
   */
  it('el mapa vive en un solo sitio y los dos lo importan', () => {
    expect(sinComentarios(taskRow)).not.toMatch(/const PRIORITY_TONE/);
    expect(sinComentarios(taskRow)).toMatch(/PRIORITY_TONE[,\s}]/);
    expect(sinComentarios(itemEditSheet)).toMatch(/PRIORITY_TONE/);
  });
});

describe('la pagina de etiquetas monta un solo selector a la vez', () => {
  /*
   * **Este pin es de un fallo que se vio en pantalla y que ningun test de ahi
   * cubria.** El selector de la etiqueta nueva estaba montado **sin condicion
   * alrededor** —`TextField`, selector y boton, siempre—, porque la idea era elegir
   * el color de una etiqueta que aun no existe sin escribir antes el nombre. La idea
   * es buena; lo que faltaba era que **no conviviera con el otro selector**: al
   * pulsar "editar" en una etiqueta que ya existe se veian los dos formularios
   * enteros a la vez, con dos tiras de tono, dos cuadrados, dos campos de hex y dos
   * botones de guardar, y nada mas que un nombre para saber cual estabas tocando.
   *
   * El pin va sobre la **condicion del selector pendiente**, no sobre un recuento de
   * `<TagColorPicker>`: un recuento pasa con tres mounts si uno esta bien condicionado,
   * y lo que importa es que los de edicion y el de la nueva **no puedan coexistir**.
   */
  it('el bloque de la etiqueta nueva solo se pinta si no se esta editando una', () => {
    const limpio = sinComentarios(itemEditSheet);
    // El selector pendiente va dentro de un `{colorDe === null ? ... : null}`, y lo
    // que se afirma es que la condicion existe y rodea al bloque entero.
    const bloque = limpio.match(
      /colorDe === null \?[\s\S]{0,4000}?<TagColorPicker[\s\S]{0,200}?tag=\{nombreNuevo/,
    );
    expect(
      bloque,
      'el selector de la etiqueta nueva tiene que estar dentro de una condicion que lo apague al editar',
    ).not.toBeNull();
    // Y que la condicion sea de verdad una condicion del render, no un comentario o
    // un nombre: el `?` tiene que ir detras de `colorDe === null`.
    expect(limpio).toMatch(/\{colorDe === null \? \(/);
  });

  it('y al editar una etiqueta, lo que se aparta es el bloque de la nueva, entero', () => {
    // Solo el selector, o el campo en blanco tambien. Con el campo a la vista y el
    // selector no, el panel sigue teniendo dos "elige un color" y el que se aparta
    // tiene que ser el bloque entero, campo incluido.
    const limpio = sinComentarios(itemEditSheet);
    const desde = limpio.indexOf('colorDe === null ?');
    const hasta = limpio.indexOf('nombreNuevo || undefined');
    const trozo = limpio.slice(desde, hasta);
    expect(trozo).toMatch(/<TextField/);
    expect(trozo.length).toBeGreaterThan(0);
  });

  /**
   * Y que la condicion sea la que ya existe, no una nueva: **`colorDe` es el estado
   * del selector de edicion**, y el bloque nuevo tiene que mirar el mismo. Si
   * alguien añade un segundo sitio que abra un selector de edicion y no lo cierra,
   * esto se pone rojo.
   */
  it('la condicion es el mismo estado que abren los lapices', () => {
    const limpio = sinComentarios(itemEditSheet);
    // Los dos lapices abren y cierran `colorDe` con la misma ternaria.
    const abre = [...limpio.matchAll(/setColorDe\(colorDe === tag \? null : tag\)/g)];
    expect(abre).toHaveLength(2);
    // Y el estado es `string | null`: con un objeto dentro habria que comparar el tag
    // y la fila, y este es el mismo para las dos filas porque son disjuntas.
    expect(limpio).toMatch(/useState<string \| null>\(null\)/);
  });
});

describe('anadir y quitar son botones distintos, y el + solo anade', () => {
  /*
   * **El `+` que tambien quitaba es lo que se vino a quitar**, y el pin va sobre el
   * `toggleTag` y no sobre el texto: `toggleTag` no volver a existir es lo que hace
   * imposible el fallo, porque con un solo toggle los dos botones tendrian que
   * compartir la misma funcion y uno de los dos mentiria sobre lo que hace.
   */
  it('no queda ningun toggle que anada y quite a la vez', () => {
    expect(sinComentarios(itemEditSheet)).not.toMatch(/\btoggleTag\b/);
  });

  it('anadir solo anade y quitar solo quita, y el boton que se pinta depende de si la tiene', () => {
    // El `+` no se pinta cuando la tarea ya lleva la etiqueta. Sin este `laTiene`,
    // los dos botones estan siempre y el `+` vuelve a quitar en silencio.
    expect(sinComentarios(itemEditSheet)).toMatch(/laTiene\s*=\s*shown\.tags\.includes/);
    expect(sinComentarios(itemEditSheet)).toMatch(/name="remove"/);
    expect(sinComentarios(itemEditSheet)).toMatch(/name="add"/);
  });

  it('la papelera de la fila de abajo pregunta antes, y la de arriba no', () => {
    // Preguntar en las dos seria confirmar algo que el usuario acaba de ver en
    // pantalla: en la fila de arriba la etiqueta esta en la propia pastilla.
    const preguntar = sinComentarios(itemEditSheet).match(/confirmarQuitar\(/g) ?? [];
    expect(preguntar).toHaveLength(1);
  });
});

describe('la fila de una tarea no reserva el asa de arrastrar', () => {
  /**
   * 28 points on the right of every row, for a handle that no longer exists: the
   * row stopped being draggable when the order moved into a sheet, and the padding
   * stayed. It is not a decoration, it is width taken from the title on every row
   * of every list.
   */
  it('no tiene paddingRight de asa', () => {
    // `taskRow` and not the screen: the row is a component of its own, and a
    // `not.toContain` on a file the row no longer lives in would pass for the
    // wrong reason. The screen is still asserted on, below, for the shapes it
    // decides itself.
    expect(taskRow).not.toContain('dragHandle');
    expect(listId).not.toContain('dragHandle');
  });

  it('la insignia y las etiquetas ceden, y viven en su propia linea', () => {
    // The badge is what must survive twenty labels, so the labels are the ones
    // that shrink. That intent is unchanged.
    //
    // What changed is the line: the icon moved into the line of the title, and
    // the badge and the labels moved to a **second** line under it, so that the
    // icon and the title line up between rows. The badge is still first on that
    // line, so it is still the one that survives.
    expect(taskRow).toContain('metaTag');
    // And the second line is drawn only when there is something to draw.
    expect(taskRow).toContain(
      '{item.priority !== "none" || item.tags.length > 0 ? (',
    );
    const meta = taskRow.slice(taskRow.indexOf('metaTag: {'));
    expect(meta).toContain('flexShrink: 1');
  });
});

/**
 * The row is shared by two screens now, and a shared component that one of them
 * cannot use is not shared.
 *
 * Two of the three below are the differences between a list row and a board row:
 * the checkbox, which a board row does not draw, and the colour down the left
 * edge, which a list row does not paint. The third is not a difference between
 * the two rows — it is about there being **one** row at all.
 *
 * All three assert on the source for the same reason as everything else here: the
 * question is whether the **optional** parts are optional, and the only way to
 * see that in `node` is to read the props and the condition.
 */
describe('la fila sabe dibujarse sin casilla y con filo de estado', () => {
  it('la casilla se dibuja solo si hay algo que marque', () => {
    // Optional in the props, and **not defaulted to a no-op**: a `onToggle` that
    // did nothing would draw a box that lies about the task being tickable.
    expect(taskRow).toContain('onToggle?: () => void');
    // And the box is inside a condition on it, not rendered and hidden.
    expect(taskRow).toContain('{onToggle ? (');
    // The empty label stays. This is the one that measured 755 of 754 points.
    expect(taskRow).toContain('onToggle={onToggle} label=""');
  });

  it('el filo de color solo existe cuando le pasan un color', () => {
    expect(taskRow).toContain('edgeColor?: string');
    // Conditional, not `edgeColor ?? theme.colors.border`: the flat list must draw
    // exactly what it drew before this prop existed, and a default colour would
    // put an edge on every row of every list.
    expect(taskRow).toContain('...(edgeColor');
    expect(taskRow).toContain('borderLeftColor: edgeColor');
  });

  /**
   * A board card has **one** door to the task panel, and it is the tap itself.
   *
   * It used to be two: the tap opened the state sheet and a row inside it
   * (`state-picker-edit-task`, `onEditTask`) opened the panel. That decision was
   * revisited — the tap now opens the panel straight away and the column is a row
   * inside it (`item-state-row`) — so the sheet no longer carries a door back to
   * the room it was opened from. These assertions are here because a route that
   * exists only in someone's head is exactly what went missing once already, and
   * because a door that comes back would be a round trip dressed as a feature.
   *
   * The browser walkthrough proves the door opens; these prove the wiring is
   * still in the source, without a browser.
   */
  it('la tarjeta de un tablero abre el panel, y la hoja ya no lleva la vuelta', () => {
    // The icon is conditional — this is the fact the old second door rested on.
    expect(taskRow).toContain('{item.icon ? (');
    // The card's own press opens the task panel, not the state sheet.
    expect(boardScreen).toContain('setEditing({ itemId: item.id, page: "edit" })');
    // And the sheet has no way back: no row, no prop, no call.
    expect(statePickerSheet).not.toContain('state-picker-edit-task');
    expect(statePickerSheet).not.toContain('onEditTask');
    expect(boardScreen).not.toContain('onEditTask={');
    // The column lives inside the panel instead: the row is drawn there and it
    // opens the sheet the screen owns.
    expect(itemEditSheet).toContain('testID="item-state-row"');
    expect(itemEditSheet).toContain('onOpenStates');
    expect(boardScreen).toContain('onOpenStates={abrirEstadosParaFormulario}');
  });

  it('la pantalla de listas usa la fila del componente, y no una suya', () => {
    // **One** screen uses it today; the board is Task 8. So this does not claim
    // anything about who passes what: it claims that the list screen draws the
    // shared row and does not carry a second copy of it, because two
    // `function TaskRow` in the repo is the thing this move exists to stop.
    //
    // Nothing here would notice who passes `onToggle` and who does not. That is
    // not what this test is for, and a title that said it was would be the reason
    // nobody notices.
    expect(listId).toContain('from "@/components/lists/task-row"');
    expect(listId).not.toContain('function TaskRow');
  });
});

describe('la cabecera se gasta el hueco de la barra de estado', () => {
  /**
   * The navigator draws the header from the top of the window and does not inset
   * it, and `Screen` insets the *content* — so the bar's buttons sat under the
   * clock while everything below them was correctly placed.
   *
   * Measured on the same build: the bar was exactly its own 56 points at y = 0,
   * its buttons at y = 8..48, and the status bar at y = 0..24.
   */
  it('la cabecera toma insets.top', () => {
    expect(appHeader).toContain('useSafeAreaInsets');
    expect(appHeader).toContain('paddingTop: insets.top');
    // And grows by it, so the wash still paints from the very top edge.
    expect(appHeader).toContain('minHeight: ALTO + insets.top');
  });

  /**
   * Only the bar takes it. Both taking it is the gap measured twice, which is how
   * a bar of 24 points ends up above a page that starts another 24 points down.
   */
  it('la pantalla no lo vuelve a tomar cuando la cabecera ya lo ha tomado', () => {
    expect(screen).toContain('useHeaderOwnsTopInset');
    expect(screen).toContain(
      'edges={cabeceraArriba ? ["left", "right"] : ["top", "left", "right"]}',
    );
  });
});

describe('el lavado no se parte en dos puntos distintos', () => {
  /**
   * The header got taller and the band did not.
   *
   * The wash is one gradient cut in two, and the cut is the bottom edge of the
   * bar. The bar grew by `insets.top`; `SpaceBand` was still told the bar is 56,
   * so it started its half 24 points too low and the two halves met at different
   * points of the same ramp — a step of 36/255 measured across one line, on every
   * screen of every space, which is exactly what the design says cannot happen.
   *
   * Both halves now read the bar's real height. The arithmetic that keeps them
   * agreeing is in `wash-seam.test.ts`; these two are the wiring, because a helper
   * nobody calls fixes nothing.
   */
  it('las dos mitades se miden contra la altura real de la barra', () => {
    // The bar grows, and paints the taller wash.
    expect(appHeader).toContain('minHeight: ALTO + insets.top');
    expect(appHeader).toContain('height: altoLavadoDe(insets.top)');
    // The band is told where the bar ends, and offsets its wash by the same number.
    expect(spaceBand).toContain('const altoBarra = altoCabeceraDe(insets.top)');
    expect(spaceBand).toContain('marginTop: -altoBarra');
    expect(spaceBand).toContain('altoLavadoDe(insets.top)');

    // And neither of them may go back to the bare constant: that is the exact shape
    // the bug had, and it is a constant so nothing else would fail if it did.
    expect(spaceBand).not.toContain('marginTop: -ALTO_CABECERA');
  });

  /**
   * The band starts **where the bar ends**, and that is `top: 0`.
   *
   * This is the cut the design says cannot exist, and it was in the code since
   * before the safe-area change: the band's box was lifted a whole bar-height with
   * `top: -ALTO_CABECERA`, so on the web it sat at y = 0..100 instead of 56..156 —
   * and because its fade is pinned to the box's bottom (`bottom: 0`, 82% tall), the
   * fade started at y = 18, **38 points above the join**. By the height of the bar's
   * bottom edge the fade was already 46% done: the bar cuts the colour in half a
   * piece and the band underneath was already half faded. Measured at 390 wide in
   * both themes, a step of **32/255 across one line**, on every screen of a space.
   *
   * The comment on that style used to say `top: 0` was the thing causing a white
   * line under the bar — which was this bug wearing the wrong explanation.
   *
   * Measured after the fix: band at y = 56..156, fade from y = 74, largest step in
   * the whole column **3** (dark theme **2**), nothing above 6 anywhere.
   */
  it('la banda arranca donde acaba la barra, no mas arriba', () => {
    // Scoped to the `banda` style, with its comment stripped. `top: 0` also appears
    // on the veil and on the fade inside it, so asserting on the whole file passes
    // even with the band lifted a whole bar-height — which is the thing to stop.
    // And the comment on that style quotes the old `top: -56` while explaining why
    // it went, so the comment has to go before anything can match `top:`.
    const sinComentarios = spaceBand.replace(/\/\*[\s\S]*?\*\//g, '');
    const banda = sinComentarios.slice(
      sinComentarios.indexOf('banda: {'),
      sinComentarios.indexOf('lavado: {'),
    );
    expect(banda).toContain('top: 0');
    expect(banda).not.toMatch(/top:\s*-/);

    // The fade is pinned to the bottom of the box, so the box's top is the only
    // thing that decides where the colour starts going. It has to be the bar's edge.
    expect(sinComentarios).not.toContain('top: -altoBarra');
    expect(sinComentarios).not.toContain('top: -ALTO_CABECERA');
  });
});
describe('la barra tiene los dos margenes', () => {
  const header = readFileSync(
    join(import.meta.dirname, '../src/components/ui/app-header.tsx'),
    'utf8',
  );

  it('los tres puntitos tienen el mismo margen que el menu', () => {
    // El lado izquierdo lleva `paddingLeft: xs + lg` y el derecho no llevaba nada:
    // los tres puntitos se pegaban al borde de la pantalla y el menu no. Los dos
    // son botones de 32 en una barra de 56.
    expect(
      header,
      'los dos lados de la barra necesitan el mismo margen exterior',
    ).toMatch(/paddingRight:\s*theme\.spacing\.xs \+ theme\.spacing\.lg/);
  });

  it('las dos columnas laterales miden lo mismo, o el titulo no esta centrado', () => {
    /*
     * El descentrado no era del margen sino del **ancho**.
     *
     * `centro` lleva `flex: 1`, y eso lo centra en el espacio que sobra. El
     * sobrante no estaba centrado porque la izquierda tiene dos botones —el menu
     * y el atras— y la derecha uno. Repartido 104 contra 72, el titulo se iba 16
     * puntos al lado corto, y en el panel, sin atras, se centraba. Ese "a veces" es
     * lo que hacia que pareciera que el titulo bailaba.
     *
     * Igualar margenes no lo arregla. Lo que lo arregla es que las dos columnas
     * midan igual, y el guard mira que las dos coijan el mismo `LADO`.
     */
    const anchos = [...header.matchAll(/width:\s*LADO/g)];
    expect(
      anchos.length,
      'las dos columnas laterales tienen que usar el mismo ancho',
    ).toBe(2);

    // Y con justificacion espejada, para que los botones no se muevan: centrar el
    // titulo moviendo los botones es un intercambio, no una correccion.
    const lado = header.match(/lado:\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(lado, 'el menu y el atras se quedan a su extremo').toContain(
      "justifyContent: 'flex-start'",
    );
    // Y el derecho se alinea con `alignItems` y no con `justifyContent`, porque su
    // columna **no** es una fila: en columna el eje horizontal es el transversal.
    const derecha = header.match(/derecha:\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(derecha, 'los tres puntitos se quedan a su extremo').toContain(
      "alignItems: 'flex-end'",
    );
    expect(derecha, 'y centrados en vertical').toContain("justifyContent: 'center'");
  });
});

describe('#11: lo compartido se dice con una insignia, no con un boton', () => {
  const leer = (p: string) =>
    readFileSync(join(import.meta.dirname, '..', p), 'utf8');

  const PANTALLAS = [
    ['el espacio', 'src/app/(app)/workspace/[workspaceId].tsx'],
    ['la carpeta', 'src/app/(app)/workspace/[workspaceId]/folder/[folderId].tsx'],
    ['la lista', 'src/app/(app)/list/[listId].tsx'],
    ['la nota', 'src/app/(app)/note/[noteId].tsx'],
  ] as const;

  it('no hay ningun boton de compartir en la cabecera', () => {
    /*
      Compartir es una **accion**, y las acciones van en los tres puntitos. Lo que
      se puso al lado de los tres puntitos era un boton mas que hace lo que el menu
      ya hacia, en una columna de 96 puntos que ya esta justa.
    */
    for (const [quien, ruta] of PANTALLAS) {
      expect(leer(ruta), `${quien}: sin boton de compartir`).not.toMatch(
        /testID="\w+-share-button"/,
      );
    }
  });

  it('las cuatro dicen si esta compartido, con el flag que ya viene', () => {
    for (const [quien, ruta] of PANTALLAS) {
      const s = leer(ruta);
      expect(s, `${quien}: publica el nodo`).toContain('useScreenShare({');
      // Y con `shared` de verdad, no con el `role`: un `viewer` en un espacio
      // compartido y alguien invitado a un espacio propio tienen el mismo rol y
      // son situaciones opuestas. El contrato lo dice, con el motivo.
      expect(s, `${quien}: el "compartido conmigo" sale de shared`).toMatch(
        /conmigo: \w+\?\.shared === true/,
      );
    }
  });

  it('la insignia es un icono al lado del titulo, y no un boton mas', () => {
    const badge = leer('src/components/shares/compartir-badge.tsx');
    const header = leer('src/components/ui/app-header.tsx');

    expect(badge, 'pregunta a quien alcanza').toContain('/reach');
    expect(header, 'y se pinta pegada al titulo').toContain('<CompartirBadge');

    // Los dos hechos son dos iconos, no uno: "te lo dieron" y "tu lo diste" no
    // son el mismo dato y quien mira quiere saber cosas distintas de cada uno.
    expect(badge).toContain('compartido-conmigo');
    expect(badge).toContain('compartido-por-mi');

    // Y **ninguno** cuando no hay nada que pintar: un icono de compartir en todo
    // es un icono que no dice nada, y ademas empuja el titulo.
    expect(
      badge,
      'sin nada que decir no se pinta nada',
    ).toMatch(/if \(!compartidoConmigo && !loCompartiYo\) return null;/);
  });

  it('"te lo compartieron" no se deduce del rol', () => {
    // El `role` es el techo de lo que puedes hacer con el contenido. `shared` es
    // de como lo conseguiste. Son preguntas distintas y confundirlas pone el
    // simbolo en espacios que simplemente no estan compartidos.
    const badge = leer('src/components/shares/compartir-badge.tsx');
    expect(badge, 'el rol no decide si te lo compartieron').not.toMatch(
      /compartidoConmigo.*role/,
    );
  });

  it('la opcion de compartir de la carpeta abre la hoja, no cierra el menu', () => {
    // Era `onPress: () => setMenuFor(null)`: cerraba la hoja y no abria nada.
    // Un boton que dice "Compartir" y cierra el menu.
    const carpeta = leer('src/app/(app)/workspace/[workspaceId]/folder/[folderId].tsx');
    const opcion = carpeta.match(/key: "share"[\s\S]*?onPress:[\s\S]*?\}/)?.[0] ?? '';
    expect(opcion, 'compartir tiene que abrir la hoja, no cerrar el menu').toContain(
      'setCompartirCarpeta(true)',
    );
  });
});

describe('#9: tirar hacia abajo recarga, en TODAS las pantallas', () => {
  const leer9 = (p: string) =>
    readFileSync(join(import.meta.dirname, '..', p), 'utf8');
  const hook = leer9('src/hooks/use-pull-to-refresh.tsx');
  const screen = leer9('src/components/ui/screen.tsx');
  const lista = leer9('src/app/(app)/list/[listId].tsx');

  it('el gesto cuelga del scroller que esta REALMENTE en pantalla', () => {
    /*
      Este guard miraba `screen.tsx` y por eso daba por hecho que todas las
      pantallas lo tenian. No lo tenian: **la pantalla de la lista no lo tenia**, y es
      la que mas se mira.

      La razon es concreta: la lista trae su propio `FlatList` porque compone una
      cabecera y un pie que `Screen` no tiene, asi que su scroller no era el de
      `Screen` y el `RefreshControl` de `Screen` no tenia donde colgarse. Por eso se
      veia "dentro de carpetas" y no en la lista.
    */
    expect(lista, 'la lista tira de pantalla').toMatch(
      /<FlatList[\s\S]*?refreshControl=\{refreshControl\}/,
    );
    expect(screen, 'y Screen tambien').toMatch(/refreshControl=\{refreshControl\}/);
  });

  it('la logica vive en un hook, no en un componente', () => {
    // Un refresh dentro de `Screen` solo lo tienen las pantallas que dejan el
    // scroller en manos de `Screen`. Un hook lo tienen todas.
    expect(hook, 'el hook existe').toContain('export function usePullToRefresh');
    expect(screen, 'y Screen lo consume').toContain('usePullToRefresh()');
    expect(hook, 'y devuelve el elemento listo').toContain(
      'refreshControl: React.ReactElement<RefreshControlProps>',
    );
  });

  it('tira del motor de sincronizacion y no de una segunda ruta', () => {
    expect(hook, 'usa syncNow, que ya sabe lo que tiene').toContain('await syncNow()');
  });

  it('el indicador se apaga tambien cuando la sincronizacion falla', () => {
    // Sin red —o con el servidor caido— un `await` sin `finally` deja el indicador
    // girando para siempre, y eso se lee como "sincronizando" con algo que no va a
    // pasar nunca.
    const accion = hook.match(/const onRefresh = useCallback[\s\S]*?\}, \[\]\);/)?.[0] ?? '';
    expect(accion, 'apaga en finally').toContain('finally');
    expect(accion, 'y apaga antes de terminar').toContain('setRefreshing(false)');
  });
});

describe('el texto de los dos extremos del lavado se lee en los dos', () => {
  const picker = readFileSync(
    join(import.meta.dirname, '../src/components/workspace/workspace-color-picker.tsx'),
    'utf8',
  );

  it('el extremo que NO has elegido tiene un color propio, no el que venga', () => {
    // Era `elegido ? accent : undefined`, y `undefined` no es "sin color": es "usa
    // el del AppText", que en oscuro sale casi negro. Se hacia ilegible justo la
    // pestana que no has elegido, que es donde mas hace falta leerla.
    //
    // Y **solo se veia en Android**: en la web el color por defecto de `AppText`
    // cae en otro sitio. Un fallo de una sola plataforma no se caza en otra.
    const texto = picker.match(/workspaces\.washSide\.\$\{extremo\}/)?.[0] ?? '';
    expect(texto, 'se llega al texto del extremo').not.toBe('');

    expect(picker, 'el no elegido lleva un color explicito').toMatch(
      /color: elegido \? theme\.colors\.accent : theme\.colors\.textMuted/,
    );
    expect(
      picker,
      'y no puede quedar en undefined: undefined no es "sin color", es "el que venga"',
    ).not.toMatch(/color: elegido \? theme\.colors\.accent : undefined/);
  });
});

describe('el contrato de guardar, igual en todas las hojas', () => {
  const leer = (p: string) =>
    readFileSync(join(import.meta.dirname, '..', p), 'utf8');
  const sheet = leer('src/components/ui/sheet.tsx');

  it('las CINCO salidas pasan por la misma pregunta, no por cinco', () => {
    /*
      Una hoja sale de cinco maneras: el fondo, la ✕, tirar hacia abajo, el boton
      atras de Android, y la pantalla que pone algo a null. Guardar "el boton de
      cerrar" guardaba **una de cinco**, y las otras cuatro seguian echando el
      trabajo. Un guard que esta y no protege es peor que no guard, porque ademas
      crea la sensacion de que estas a salvo.
    */
    const pregunta = (sheet.match(/puedeCerrar/g) ?? []).length;
    expect(pregunta, 'la pregunta existe y se usa desde mas de un sitio')
      .toBeGreaterThan(3);

    // Y `onClose` **solo** se llama desde dentro de `salir`. Si alguien llama a
    // `onClose` suelto, esa salida no pasa por la pregunta.
    const sueltas = (sheet.match(/onClose\(\)/g) ?? []).length;
    expect(sueltas, 'onClose solo se llama desde salir()').toBe(1);
  });

  it('el boton atras de Android tambien pregunta', () => {
    // Es la salida que nadie toca en una prueba manual, porque probar el guardado
    // con el atras fisico es la forma mas rapida de perder el trabajo de un dia.
    expect(sheet, 'onRequestClose pasa por la pregunta').toMatch(
      /onRequestClose=\{pedirCierre\}/,
    );
    expect(sheet, 'y no se llama directo a onClose').not.toMatch(
      /onRequestClose=\{onClose\}/,
    );
  });

  it('tirar hacia abajo PREGUNTA antes de comprometerse a cerrar', () => {
    /*
      El gesto ya habia animado el panel hacia abajo y tiene que salir en el mismo
      instante: no hay forma de preguntar con el panel fuera de la pantalla. Preguntar
      despues significaria que tirar hacia abajo guarda lo que habia sin preguntar.
    */
    const gesto = sheet.match(/\.onEnd\(\(event\) => \{[\s\S]*?volver\(\);\n    \}\)/)?.[0] ?? '';
    expect(gesto, 'el gesto pregunta').toContain('preguntarCierre');
    const pregunta = gesto.indexOf('preguntarCierre');
    const commit = gesto.indexOf('cerrando.value = true');
    expect(
      pregunta,
      'pregunta antes de marcarse como cerrando, no despues',
    ).toBeLessThan(commit);
  });

  it('una hoja nunca llega sucia', () => {
    // Si el reset viviera en un efecto que corre despues del paint, hay un frame
    // con la hoja visible y todavia sucia, y el guard Armed para un panel donde
    // nadie ha escrito nada.
    expect(sheet, 'al abrir, limpio').toMatch(
      /if \(!visible\) return;\s*\n\s*setSucio\(false\)/,
    );
  });

  it('el Guardar solo aparece si hay algo que confirmar', () => {
    // Un Guardar gris en un menu de seis opciones para leer enseña que el boton es
    // decoracion, y a partir de ahi nadie fia de ningun Guardar.
    expect(sheet, 'el boton depende de onSave').toMatch(
      /\{onSave \? \([\s\S]*?<Button[\s\S]*?sheet-save[\s\S]*?\/\> : null\}/,
    );
  });

  it('el Guardar no se apaga hasta que la promesa acaba', () => {
    // Limpiar antes de tiempo deja una hoja que parece limpia con el texto fuera
    // de la pantalla y sin haber llegado al servidor: la unica senal de "esto no
    // esta guardado" es la misma que decia que estaba sucio.
    const accion = sheet.match(/const guardar = useCallback[\s\S]*?\}, \[onSave, saveDisabledReason\]\);/)?.[0] ?? '';
    expect(accion, 'limpia despues del await').toMatch(
      /await onSave\(\);[\s\S]*?setSucio\(false\)/,
    );
  });

  it('la pregunta la hace este proyecto y no Alert', () => {
    /*
      `Alert.alert` son tres dialogos distintos con el mismo nombre: en Android una
      ventana del sistema, en iOS la hoja del sistema, y **en la web no existe** en
      `react-native-web`. Las dos confirmaciones que tenia la app eran confirmacion
      en un movil y nada en un navegador.
    */
    const dialogo = leer('src/components/ui/confirm-dialog.tsx');
    expect(dialogo, 'es un Modal de este proyecto').toContain('<Modal');
    expect(sheet, 'la hoja lo usa').toContain('<ConfirmDialog');
    expect(sheet, 'y no Alert').not.toContain('Alert.alert');
  });

  it('el boton va fuera del scroll y no dentro', () => {
    // Un Guardar dentro del area que scrollea se va con el contenido en una hoja
    // larga: el boton de confirmar desaparece justo cuando mas lo necesitas.
    const pie = sheet.indexOf('styles.pieGuardar');
    const fin = sheet.indexOf('</Body>');
    expect(pie, 'el pie va despues del Body, no dentro').toBeGreaterThan(fin);
  });
});

describe('la primera hoja que adopta el contrato', () => {
  const fichero = readFileSync(
    join(import.meta.dirname, '../src/components/ui/rename-sheet.tsx'),
    'utf8',
  );
  /**
   * Solo el trozo de `RenameSheet`.
   *
   * El fichero trae tambien `ConfirmSheet`, que **si** necesita su Cancelar — es una
   * pregunta, y una pregunta no tiene nada que guardar. Un guard que barre el
   * fichero entero obliga a romper la otra para poder pasar: o el guard miente, o
   * obliga a un cambio que nadie quiere.
   */
  const rename =
    fichero.slice(
      fichero.indexOf('export function RenameSheet'),
      fichero.indexOf('export interface ConfirmSheetProps'),
    ) ?? '';

  it('el Guardar es el del pie del panel, y no un boton mas dentro', () => {
    // Dos botones de guardar en la misma pantalla: el que buscas y el que no miras.
    // Y el de dentro se va con el contenido en una hoja larga.
    expect(rename, 'delega en onSave').toContain('onSave={submit}');
    expect(rename, 'y no trae el suyo').not.toContain('t("rename.save")');
  });

  it('no deja el Cancelar de antes, que era la salida que no preguntaba', () => {
    // La ✕ y el fondo ya cierran, y ya preguntan. Un Cancelar aqui era una
    // tercera forma de cerrar, y la unica que se saltaba la pregunta.
    expect(rename, 'sin Cancelar propio').not.toContain('t("common.cancel")');
  });

  it('"sucio" es el texto, no el teclado', () => {
    // Volver a borrar lo que habia deja el panel igual, y preguntar "¿sales sin
    // guardar?" a alguien que no ha cambiado nada enseña que el aviso no significa
    // nada.
    expect(rename, 'compara con el nombre que habia').toContain(
      'const cambiado = name.trim() !== value.trim()',
    );
    expect(rename, 'y lo dice').toContain('setSucio(cambiado)');
  });

  it('Guardar sin cambios no renombra a la mitad de escribir', () => {
    // Si solo se ha tecleado un espacio, el nombre recortado es el mismo y
    // "guardar" no tiene nada que hacer.
    expect(rename).toMatch(/if \(!trimmed \|\| !cambiado\) return;/);
  });
});

describe('el panel de un elemento: dos velocidades de guardado', () => {
  const leer = (p: string) =>
    readFileSync(join(import.meta.dirname, '..', p), 'utf8');
  /**
   * Sin comentarios.
   *
   * Los guards miran codigo, y un guard que barre tambien los comentarios matchea
   * la frase que **explica el bug que acaba de arreglarse**. Este panel tiene, muy
   * arriba, un comentario que dice "era `onBlur={saveTitle}`" — y un guard escrito
   * sin esto dice que el bug sigue ahi porque alguien lo explico bien.
   */
  const panel = sinComentarios(leer('src/components/lists/item-edit-sheet.tsx'));

  it('los dos campos de texto YA NO guardan al perder el foco', () => {
    /*
      Este era el motivo de que "se guarda con Guardar" no fuera cierto: los campos
      escribian solos en cuanto perdian el foco. Y con dos campos se guardaba **a
      mitad de la frase** — ibas a escribir "llamar al instalador", pulsabas el de
      abajo, y el servidor ya tenia media frase.
    */
    expect(panel, 'el nombre no se guarda en onBlur').not.toMatch(/onBlur=\{saveTitle\}/);
    expect(panel, 'la nota tampoco').not.toMatch(/onBlur=\{saveNotes\}/);
  });

  it('NADA se guarda al pulsar: las pulsaciones tambien van al borrador', () => {
    /*
      Esto cambio, y no por una idea nueva: porque lo pedido era que **nada** se
      guardara hasta pulsar Guardar, y antes solo el nombre y la nota esperaban.

      La justificacion que yo habia puesto —"elegir prioridad es una pulsacion, y
      guardarla al elegir es lo que hace que se vea cual elegiste"— era ademas
      falsa en la practica: un panel que se guarda a medias es un panel del que no
      se fia uno. Que parte se guarda dependia de que campo habias tocado, y eso no
      se aprende, se endurece en la cabeza y se acaba pulsando Guardar siempre, que
      es el mismo trabajo con dos pasos.
    */
    // El borrador, no la fila: `save` ya no escribe.
    expect(panel, 'la prioridad va al borrador').toMatch(/save\(\{ priority: option \}\)/);
    expect(panel, 'las etiquetas tambien').toMatch(/save\(\{\s*tags: \[\.\.\./);
    expect(panel, 'y lo hecho tambien').toMatch(/save\(\{ completed: !shown\.completed \}\)/);

    // Y la prueba de que `save` NO escribe: no hay `updateItem` dentro.
    const save = panel.match(/const save = \(changes:[\s\S]*?\};/)?.[0] ?? '';
    expect(save, 'save es solo setDraft').toContain('setDraft');
    expect(save, 'y no escribe en la fila').not.toContain('updateItem');
  });

  it('todo sale por un unico updateItem, con los siete campos', () => {
    // Antes eran siete escrituras repartidas por el panel, y por eso perder la nota
    // al cambiar el icono no era un descuido: era la forma normal de funcionar.
    const confirmar = panel.match(/const confirmar = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
    for (const campo of ['title', 'annotation', 'priority', 'icon', 'tags', 'completed']) {
      expect(confirmar, `${campo} sale en el commit`).toContain(`${campo}:`);
    }
    expect(confirmar, 'y es una sola escritura').toContain('updateItem(item!, {');
  });

  it('los dos textos se leen vivos, no del borrador', () => {
    // El `setState` de un campo no ha llegado al borrador en este mismo frame, asi
    // que leer el borrador aqui guardaria el nombre de hace un instante.
    const confirmar = panel.match(/const confirmar = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
    expect(confirmar, 'el nombre se lee del campo').toContain('title: title.trim()');
    expect(confirmar, 'la nota tambien').toContain('annotation: annotation.trim()');
  });

  it('"sucio" es TODO el panel, cada campo con su partida', () => {
    for (const campo of ['draft.priority', 'draft.icon', 'draft.completed', 'sameLabels(draft.tags']) {
      expect(panel, `${campo} cuenta como cambio`).toContain(campo);
    }
    expect(panel, 'y lo dice').toContain('setSucio(sucio)');
    // Y con las etiquetas como conjunto: el orden en que se anotaron no es parte
    // de lo que alguien quiso decir, y decir "tienes cambios" por eso enseña a
    // ignorar el aviso.
    expect(panel, 'las etiquetas como conjunto').toContain(
      'function sameLabels(a: string[], b: string[])',
    );
    expect(panel, 'que compara longitudes y contenido').toMatch(
      /if \(a\.length !== b\.length\) return false;/,
    );
  });

  it('los hooks del "sucio" van ANTES del return null', () => {
    // Un hook que depende de donde estas en el cuerpo es un hook condicional: el
    // dia que la fila tarda mas en llegar se cambia el numero de hooks y React dice
    // "se cambio el orden de los hooks". Y no es raro: es lo primero que pasa al
    // abrir la hoja por segunda vez, que es justo el camino que se acaba de arreglar.
    const nulo = panel.indexOf('if (!isNew && !item) return null;');
    const useMemoSucio = panel.indexOf('const sucio = useMemo');
    expect(nulo, 'el return null existe').toBeGreaterThan(-1);
    expect(useMemoSucio, 'el useMemo va antes del return').toBeLessThan(nulo);
  });

  it('un solo boton de guardar: el del pie, y no otro aqui dentro', () => {
    expect(panel, 'delega en onSave').toContain('onSave={confirmar}');
    expect(panel, 'y no pinta un boton de guardar propio').not.toMatch(
      /<Button[\s\S]{0,200}label=\{t\("(itemCreate\.save|rename\.save)"\)\}/,
    );
    // El `testID="item-create"` murio con el boton. Y el boton del pie se llama
    // `sheet-save`, que es lo que pulsa ahora el script de regresion.
    expect(panel, 'el id viejo se fue con el boton viejo').not.toMatch(
      /testID="item-create"/,
    );
  });

  it('sin nombre no se puede crear, y el boton DICE por que', () => {
    /*
      Un boton gris sin texto se pulsa dos veces para averiguar que no hace nada.
      Por eso el motivo es un `string` y no un booleano: "Ponle un nombre" convierte
      un control muerto en una instruccion.
    */
    const sheet = leer('src/components/ui/sheet.tsx');
    expect(panel, 'pasa el motivo').toContain('saveDisabledReason={sinNombre ?');
    expect(sheet, 'y el motivo apaga el boton').toMatch(
      /disabled=\{guardando \|\| saveDisabledReason !== undefined\}/,
    );
    expect(sheet, 'y lo dice en voz alta').toContain('accessibilityHint={saveDisabledReason}');
  });

  it('el boton apagado no guarda igual, porque hay quien lo pulse sin verlo', () => {
    const sheet = sinComentarios(leer('src/components/ui/sheet.tsx'));
    // Un boton gris se puede pulsar con el teclado o con un lector de pantalla, y
    // ahi no hay dedo que lo bloquee. El guard esta en la accion, no solo en el
    // boton.
    const accion = sheet.match(/const guardar = useCallback[\s\S]*?\}, \[onSave/)?.join('') ?? '';
    expect(accion, 'la accion tambien respeta el motivo').toContain(
      'if (!onSave || saveDisabledReason !== undefined) return;',
    );
  });

  it('el script de regresion pulsa el boton que ahora crea', () => {
    // Un script que sigue pulsando el id viejo falla **por lo que arregla**, que es
    // la forma mas confusa de romper algo.
    const script = leer('../../scripts/verify-app-regression.mjs');
    expect(script, 'pulsa sheet-save').toContain('pressTestId(tab, "sheet-save")');
    expect(script, 'y no el id que ya no existe').not.toContain('pressTestId(tab, "item-create")');
  });
});

describe('las hojas de creacion: el Guardar del pie y el color tambien', () => {
  const leer = (p: string) =>
    readFileSync(join(import.meta.dirname, '..', p), 'utf8');
  const crearEspacio = sinComentarios(
    leer('src/components/workspace/workspace-create-sheet.tsx'),
  );
  const crearCosa = sinComentarios(
    leer('src/components/folders/create-sheet.tsx'),
  );

  it('las dos usan el Guardar del pie y no un boton propio', () => {
    for (const [quien, s] of [
      ['el espacio', crearEspacio],
      ['carpeta, lista o nota', crearCosa],
    ] as const) {
      expect(s, `${quien}: delega en onSave`).toContain('onSave=');
      expect(s, `${quien}: sin boton de crear dentro`).not.toMatch(
        /<Button[\s\S]{0,200}t\("common\.create"\)/,
      );
      expect(s, `${quien}: y sin Cancelar`).not.toMatch(
        /<Button[\s\S]{0,200}t\("common\.cancel"\)/,
      );
    }
  });

  it('el color del espacio cuenta como cambio, no solo el nombre', () => {
    /*
      El color es la razon de mirar: en una hoja donde el nombre ya esta escrito,
      cambiar el lavado y salir con la ✕ es perder media hora de buscar el tono. Y
      el nombre —que se ve en la barra— no es lo que delata que se ha perdido.
    */
    expect(crearEspacio).toMatch(/color !== DEFAULT_WORKSPACE_COLOR/);
    expect(crearEspacio).toMatch(/colorTo !== null/);
    expect(crearEspacio).toMatch(/wash !== DEFAULT_WASH/);
  });

  it('"sucio" no es "ha escrito algo", es "difiere de la partida"', () => {
    // Volver a elegir el color que ya tenia no es un cambio, y preguntar por eso
    // enseña a ignorar el aviso.
    expect(crearEspacio, 'se compara con los valores de partida').toContain(
      'const sucio =',
    );
    expect(crearEspacio, 'y lo dice').toContain('setSucio(sucio)');
  });

  it('sin nombre no se crea, y el boton DICE por que', () => {
    for (const [quien, s] of [
      ['el espacio', crearEspacio],
      ['carpeta, lista o nota', crearCosa],
    ] as const) {
      expect(s, `${quien}: pasa el motivo`).toMatch(
        /saveDisabledReason=\{\w+\.trim\(\)\.length === 0 \? t\("itemEdit\.nameNeeded"\)/,
      );
    }
  });

  it('el borrador de la hoja de creacion sigue en la pantalla padre', () => {
    /*
      Y se dice en el propio fichero, porque es la parte que el contrato **no**
      arregla: `Sheet` resuelve la *pregunta* —si hay cambios y hay que avisar—, no
      el almacenamiento. El texto sigue llegando por props, y si la pantalla no lo
      limpia al cerrar, la siguiente vez abre con las palabras de la anterior.

      Un guard que dijera "el borrador ya no se fuga" seria mentira.
    */
    // Este mira un **comentario**, asi que lee el fichero entero: un guard que
    // busca una frase en el codigo sin comentarios no puede encontrar una frase
    // que solo existe en un comentario.
    expect(leer('src/components/folders/create-sheet.tsx')).toMatch(
      /borrador que vive mas alla de la hoja/,
    );
  });
});

describe('colocar una invitation: el Guardar del pie', () => {
  const hoja = sinComentarios(
    readFileSync(
      join(import.meta.dirname, '../src/components/shares/place-share-sheet.tsx'),
      'utf8',
    ),
  );

  it('confirma con el boton del pie y sin Cancelar propio', () => {
    expect(hoja, 'delega en onSave').toContain('onSave={() => void confirmar()}');
    // El Cancelar era la segunda puerta de salida, y la unica que no preguntaba
    // antes de perder la eleccion de donde va.
    expect(hoja, 'sin Cancelar').not.toMatch(
      /<Button[\s\S]{0,200}t\("common\.cancel"\)/,
    );
  });

  it('sin destino no se puede confirmar, y el boton DICE por que', () => {
    expect(hoja, 'pasa el motivo').toMatch(
      /saveDisabledReason=\{!workspaceId \? t\("place\.whereNeeded"\)/,
    );
  });

  it('el flag de "enviando" se comprueba en la ACCION, no solo en el boton', () => {
    /*
      El boton apagado del pie ya impide el doble toque con el dedo, pero con
      teclado o con un lector de pantalla no hay dedo que lo impida, y dos
      invitations con el mismo enlace es una invitacion repetida.

      Por eso `saving` sigue vivo aunque el boton ya no lo lea: se comprueba dentro
      de `confirmar`, que es donde un segundo intento se puede parar sin haber
      escrito nada.
    */
    const accion = hoja.match(/const confirmar = async \(\) => \{[\s\S]*?setSaving\(true\)/)?.[0] ?? '';
    expect(accion, 'la accion comprueba el flag').toMatch(/if \(saving\) return;/);
  });
});

describe('#5: el buscador de la lista, como loSilentaste', () => {
  const leer = (p: string) =>
    readFileSync(join(import.meta.dirname, '..', p), 'utf8');
  const sin = sinComentarios(leer('src/app/(app)/list/[listId].tsx'));

  it('el campo va DENTRO de la pantalla, y no como hermano suyo', () => {
    /*
      Montado fuera del `Screen`, un hermano cae donde le toca en el flujo del
      padre: se dibujaba **abajo**, debajo de todo, yendo al fondo del esqueleto. Es
      el sitio del que mas se queja quien lo busca, y el unico que no se puede
      deducir leyendo donde se pulsa el boton.
    */
    expect(sin.indexOf('styles.buscador'), 'el campo se construye')
      .toBeGreaterThan(-1);
    // Y se pinta dentro: el uso esta tras abrir el `Screen` y antes de cerrarlo.
    /*
      Y el orden es lo que lo demuestra, no la mera presencia: **dentro** del `Screen`
      el campo va antes de la `FlatList` de la lista. Como hermano suyo —fuera— queda
      despues, porque el `Screen` entero ya se ha cerrado.

      Un guard que solo comprobara "aparece `{campoBusqueda}`" pasaria en los dos
      casos, y ese es el fallo entero.
    */
    const uso = sin.lastIndexOf('{campoBusqueda}');
    const lista = sin.indexOf('<FlatList');
    expect(uso, 'el campo se pinta').toBeGreaterThan(-1);
    expect(lista, 'la lista se pinta').toBeGreaterThan(-1);
    expect(uso, 'dentro del Screen, o sea ANTES de la lista').toBeLessThan(lista);
  });

  it('el boton alterna: el mismo que abre, cierra', () => {
    /*
      Y no solo abre. Un campo que se cierra solo tiene que adivinar, y se cerraba
      al vaciarse —o sea que **no se podia buscar a vacio**, que es justo cuando se
      empieza a escribir.
    */
    expect(sin, 'el boto alterna').toMatch(
      /setBuscando\(\(abierto\) => !abierto\)/,
    );
    expect(sin, 'y al cerrar limpia el texto').toMatch(
      /if \(buscando\) setTextoBusqueda\(""\)/,
    );
  });

  it('el campo ocupa todo el ancho util', () => {
    /*
      Con un boton largo al lado se quedaba en dos tercios — y el buscador, que es
      un campo, pagaba el ancho. Un buscador estrecho es un buscador en el que se
      escribe de menos.
    */
    expect(sin, 'el campo se estira').toMatch(/campoAncho: \{[\s\S]*?flex: 1/);
    expect(sin, 'y el contenedor va de margen a margen').toMatch(
      /left: theme\.spacing\.lg,[\s\S]*?right: theme\.spacing\.lg/,
    );
  });

  it('el de crear es solo un +, y el campo NO va en el flujo', () => {
    /*
      Un campo en el flujo se queda donde el flujo lo pone —arriba de la pantalla—
      mientras el teclado tapa el tercio de abajo, y los dos nunca se encuentran.
      Quien escribe una busqueda no mira el campo: mira el teclado.
    */
    expect(sin, 'el campo es absoluto, en el flujo no').toMatch(
      /buscador: \{[\s\S]*?position: "absolute"/,
    );
    expect(sin, 'y va anclado encima de la pila').toMatch(
      /bottom: porTeclado \+ pila\.searchBottom \+ pila\.searchHeight/,
    );
    expect(sin, 'con margen a los lados').toMatch(/left: theme\.spacing\.lg/);
  });

  it('los tres botones de la esquina suben con el teclado', () => {
    /*
      En Android el teclado **mueve** la ventana —la app no declara
      `android.windowSoftInputMode` y lo que hace Android por defecto es `adjustPan`,
      que traslada el origen y no toca el alto—. Un hijo absoluto dentro de un
      `KeyboardAvoidingView` con padding depende de que ese padding se aplique, y en
      `adjustPan` la ventana se ha movido sin que el layout cambie: los botones se
      quedan **debajo** del teclado.
    */
    expect(sin, 'el + sube').toMatch(/bottom: pila\.fabBottom \+ porTeclado/);
    expect(sin, 'el buscador sube').toMatch(
      /bottom: pila\.searchBottom \+ porTeclado/,
    );
    expect(sin, 'los filtros suben').toMatch(
      /floatingBottom=\{pila\.controlsBottom \+ porTeclado\}/,
    );
    expect(sin, 'y porTeclado sale del teclado, a mano').toMatch(
      /const porTeclado = teclado > 0 \? teclado \+ theme\.spacing\.md : 0;/,
    );
  });

  it('el + de al lado abre el panel CON lo que se buscaba', () => {
    /*
      Abria el modal **en blanco**: teclear el nombre en el buscador, no encontrarlo,
      y teclearlo otra vez en un formulario que ya te habia mostrado el texto.
    */
    expect(sin, 'pasa el texto al panel').toMatch(
      /setEditing\(\{ itemId: "", page: "edit", tituloInicial: texto \}\)/,
    );
    expect(leer('src/app/(app)/list/[listId].tsx')).toContain(
      'initialTitle={editing?.tituloInicial}',
    );
  });
});

describe('"usar este color" fuera de los dos selectores', () => {
  const leer = (p: string) =>
    readFileSync(join(import.meta.dirname, '..', p), 'utf8');
  /*
    **El fichero CRUDO, y no el sin comentarios**, y el motivo es concreto.

    El boton que se quito estaba justo antes de un comentario de bloque. El helper
    `sinComentarios` quita `/* ... *\/` de forma **no codiciosa**, asi que se
    empareja con el `/*` que hay mas arriba y se lleva por delante todo lo que
    trouve en medio —**incluido el codigo que se inserte ahi**.

    Con eso, este guard era ciego justo en el sitio que vigila: reintroduje el
    boton, el helper se lo comio y el test paso. Un guard que no puede ver el sitio
    donde estaba el bug es peor que no tener guard, porque ademas da la impresion de
    que el sitio esta vigilado.

    Asi que para "no hay boton" se lee el fichero entero. `colorUse` es un nombre de
    clave, y las tres claves se borraron del diccionario, asi que **cualquier uso
    suyo en codigo es un error de typecheck**. Y en comentarios no aparece.
  */
  const espacioCrudo = leer('src/components/workspace/workspace-color-picker.tsx');
  const etiquetaCrudo = leer('src/components/lists/tag-color-picker.tsx');
  const espacio = sinComentarios(espacioCrudo);
  const etiqueta = sinComentarios(etiquetaCrudo);
  // Los gestos del selector del espacio viven en el cuadrado que comparte con los
  // estados, y es ahi donde se vigila que escriban al terminar.
  const cuadrado = sinComentarios(leer('src/components/ui/color-square.tsx'));

  it('ninguno de los dos tiene el boton', () => {
    for (const [quien, crudo] of [
      ['el del espacio', espacioCrudo],
      ['el de etiqueta', etiquetaCrudo],
    ] as const) {
      expect(crudo, `${quien}: sin boton`).not.toContain('colorUse');
      expect(crudo, `${quien}: y sin su estilo`).not.toMatch(/\n  usar: \{/);
    }
  });

  it('lo que hacia el boton lo hace el dedo, al levantar', () => {
    /*
      El boton escribia lo que el cuadrado mostraba. Quitandolo, el commit tiene que
      mudarse al gesto o el color deja de poder aplicarse — que es lo que mas miedo
      me da de este cambio: **un selector de color sin puerta de salida**.

      Asi que el commit es `onEnd` del gesto, y no `onFinalize`: un gesto cancelado
      —el dedo se sale, el sistema lo interrumpe— no es una eleccion, y escribirlo
      guardaria el color donde el dedo iba de paso.
    */
    // El del espacio entrega el color con `onCommit` al cuadrado compartido.
    expect(espacio, 'el del espacio: lo escribe el cuadrado compartido').toContain(
      'onCommit={escribir}',
    );
    for (const [quien, s] of [
      ['el del espacio', cuadrado],
      ['el de etiqueta', etiqueta],
    ] as const) {
      expect(s, `${quien}: el cuadrado escribe al terminar`).toMatch(
        /\.onEnd\(\(\) => runOnJS\((?:alTerminar|terminar)\)\(\)\)/,
      );
      // Los dos gestos del fichero —cuadrado y tira— escriben al terminar. Uno solo
      // dejaria la tira como un adorno que mueve el marcador sin guardar nada.
      const fines =
        s.match(/\.onEnd\(\(\) => runOnJS\((?:alTerminar|terminar)\)\(\)\)/g) ?? [];
      expect(fines.length, `${quien}: cuadrado y tira escriben`).toBe(2);
      expect(s, `${quien}: nunca en onFinalize`).not.toContain('onFinalize');
    }
  });

  it('un toque tambien escribe, porque el gesto no tiene umbral', () => {
    // `minDistance(0)`: tocar el cuadrado pasa por `onBegin`/`onEnd` igual que un
    // arrastre. Sin esto, quitar el boton dejaba **al toque sin puerta** — se
    // moveria el marcador y no se guardaria nada.
    for (const [quien, s] of [
      ['el del espacio', cuadrado],
      ['el de etiqueta', etiqueta],
    ] as const) {
      expect(s, `${quien}: el gesto empieza en el primer pixel`).toContain(
        '.minDistance(0)',
      );
    }
  });

  it('las traducciones muertas tambien se van', () => {
    // Una clave escrita y sin usar es la clase de fallo que no da ningun error: el
    // typecheck pasa, la app arranca y no se ve. Las tres eran las del boton.
    const diccionario = leer('src/lib/i18n/dictionaries.ts');
    for (const clave of [
      'tags.colorUse',
      'tags.colorUseOf',
      'workspaces.colorUse',
    ]) {
      expect(diccionario, `${clave} fuera`).not.toContain(`"${clave}":`);
    }
  });
});

describe('#7: la hoja cambia de alto persiguiendo al contenido', () => {
  const hoja = readFileSync(
    join(import.meta.dirname, '../src/components/ui/sheet.tsx'),
    'utf8',
  );

  it('el cuerpo tiene un alto animado, no el que le toca', () => {
    /*
      Sin esto, cambiar de paso en una hoja de varias paginas hace que el panel
      salte de un frame al siguiente. Se nota mas de lo que parece: **el salto
      mueve el contenido**, y si tenias el dedo encima de una fila, esa fila se ha
      movido sola justo cuando ibas a tocarla.
    */
    expect(hoja, 'el cuerpo se anima').toMatch(
      /const estiloCuerpo = useAnimatedStyle\(\(\) => \(\{[\s\S]*?height: altoCuerpo\.value/,
    );
    expect(hoja, 'y hay un valor que lo persigue').toContain(
      'const altoCuerpo = useSharedValue(0)',
    );
  });

  it('el bucle de re-layout esta cerrado', () => {
    /*
      Poner una altura vuelve a maquetar, lo que reporta otra altura, y sin cerrar
      eso cada frame arranca una animacion nueva y el cuerpo se persigue a si mismo
      para siempre. Se compara con el **objetivo** y no con el valor actual, para que
      una medida que llega a mitad de animacion no se tome por una nueva.
    */
    expect(hoja, 'guarda el objetivo').toContain('const objetivo = useRef(0)');
    expect(hoja, 'y lo compara antes de animar').toContain(
      'if (alto <= 0 || alto === objetivo.current) return;',
    );
  });

  it('la medida es del CONTENIDO, y no de la caja', () => {
    /*
      Un `onLayout` dentro de algo que scrollea informa de la altura que **le
      dieron**, no de la que tiene lo que lleva dentro. En cuanto la caja lleva una
      altura fija, ese numero no vuelve a cambiar y la animacion no puede arrancar
      otra vez: el alto se queda clavado en el primer paso.
    */
    expect(hoja, 'usa onContentSizeChange').toContain('onContentSizeChange={alMedirElContenido}');
    expect(hoja, 'y no un onLayout en la caja animada').not.toMatch(
      /<Animated\.View[^>]*style=\{\[\s*estiloCuerpo[\s\S]{0,200}onLayout/,
    );
  });

  it('las hojas de una sola pagina no se animan', () => {
    // Mismo bucle, y peor: la caja se ajusta al contenido y el contenido se mide
    // dentro de ella. Y no se pierde nada — las que cambian de alto de verdad son
    // las de varias paginas, que scrollean todas.
    const ramaFija = hoja.match(/\) : \(\n(?:.|\n)*?<View style=\{styles\.cuerpoLleno\}>/)?.[0] ?? '';
    expect(ramaFija, 'la rama fija mide por onLayout').not.toContain('onLayout');
  });

  it('el alto sigue al contenido con un spring que no se pasa', () => {
    // Antes era una duracion, porque un spring **se pasa** y el exceso se ve como
    // contenido cortado abajo un frame. Ahora es un spring —el mismo idioma que el
    // morph de apertura— con `overshootClamping`: llega, pero no se pasa. Eso
    // quita el motivo de la duracion sin perder el seguimiento suave.
    expect(hoja, 'el alto se anima con un spring').toMatch(
      /altoCuerpo\.value = withSpring\(alto, ALTO_SPRING\)/,
    );
    expect(hoja, 'que no se pasa').toMatch(
      /const ALTO_SPRING = \{[^}]*overshootClamping: true[^}]*\}/,
    );
  });
});

describe('los colores de etiqueta tambien esperan al Guardar', () => {
  const panel = sinComentarios(
    readFileSync(
      join(import.meta.dirname, '../src/components/lists/item-edit-sheet.tsx'),
      'utf8',
    ),
  );

  it('elegir un color no escribe: va al borrador y es sincrono', () => {
    /*
      Era la ultima puerta por la que el panel guardaba solo: cambiabas el color de
      una etiqueta, salias sin pulsar Guardar, y el color se quedaba puesto. Y no
      era un descuido menor — era el campo con mas pasos para llegar hasta el, asi
      que era tambien el que mas dolia perder... o el que menos se notaba haber
      guardado sin querer.
    */
    const pick = panel.match(/const pickColor = \([^)]*\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
    expect(pick, 'existe pickColor').not.toBe('');
    expect(pick, 'escribe en el borrador').toContain('setColores(');
    expect(pick, 'y no en la lista').not.toContain('onTagColor');
    expect(pick, 'sin esperas').not.toContain('await');
  });

  it('"sucio" cuenta los colores, con null y ausente como lo mismo', () => {
    // Alguien que elige un color y vuelve al deducido no ha cambiado nada, y la
    // pregunta no debe fingir lo contrario.
    expect(panel, 'los colores ensucian').toContain('sameColors(colores');
    expect(panel, 'null y ausente son deducido').toMatch(
      /\(a\[clave\] \?\? null\) !== /,
    );
  });

  it('el panel ensena el borrador, no lo guardado', () => {
    // Elegir un color y ver el viejo hasta pulsar Guardar es un panel que miente
    // sobre lo que va a guardar.
    const chips = panel.match(/colors=\{[^}]*\}/g) ?? [];
    expect(chips.length, 'las pastillas leen el borrador').toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip, 'ninguna lee lo guardado').not.toContain('colors={tagColors}');
    }
  });

  it('al confirmar, la tarea va primero y los colores despues', () => {
    /*
      La etiqueta tiene que estar **en la tarea** antes de que el mapa tenga clave
      para ella, o el servidor recibe un color para una etiqueta que ninguna fila
      lleva. Y si algo falla, igual se intenta cerrar: el "sucio" sigue puesto, asi
      que cerrar pregunta en vez de perder en silencio.
    */
    const confirmar = panel.match(/const confirmar = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
    expect(confirmar, 'existe confirmar').not.toBe('');
    const tarea = confirmar.indexOf('await updateItem(');
    const colores = confirmar.indexOf('await volcarColores();');
    const cierre = confirmar.indexOf('onClose();');
    expect(tarea, 'escribe la tarea').toBeGreaterThan(-1);
    expect(colores, 'y luego vuelca').toBeGreaterThan(tarea);
    expect(cierre, 'y cierra al final').toBeGreaterThan(colores);
  });
});

describe('compartir y plantillas: el Guardar del pie', () => {
  const leer = (p: string) =>
    readFileSync(join(import.meta.dirname, '..', p), 'utf8');
  const sin = (p: string) => sinComentarios(leer(p));

  it('el formulario de compartir publica y la hoja pinta', () => {
    /*
      Un contexto no fluye hacia arriba: el estado del formulario vive dos niveles
      por debajo de quien pinta el pie. Sin canal, el Guardar del panel no puede
      existir sin reescribir el formulario por debajo — que es un rediseno, no una
      adopcion.
    */
    const canal = sin('src/components/shares/share-form-publicado.ts');
    expect(canal, 'el canal lleva publicar, no lo publicado').toContain(
      'publicar: (publicado: ShareFormPublicado | null) => void;',
    );
    const form = sin('src/components/shares/share-node-sheet.tsx');
    expect(form, 'el formulario publica').toContain('publicar({ enviar:');
    expect(form, 'y limpia al desmontar').toContain('return () => publicar(null);');
    expect(form, 'el sucio va directo a la hoja').toContain('setSucio(sucio)');
    expect(form, 'sin botones propios').not.toMatch(/label=\{t\("share\.send"\)/);
    expect(form, 'y sin Cancelar').not.toContain('t("common.cancel")');
  });

  it('guardar-plantilla no guarda desde una fila del menu', () => {
    const hoja = sin('src/components/notes/save-template-sheet.tsx');
    expect(hoja, 'delega en onSave').toContain('onSave={() => void save()}');
    expect(hoja, 'y no tiene fila de guardar').not.toContain('key: "save"');
    expect(hoja, 'el sucio es el nombre').toContain('setSucio(name.trim()');
  });

  it('renombrar plantilla usa el pie, sin Volver que no pregunte', () => {
    /*
      La nota se fue de esta lista en la T7: su hoja (`note-menu-sheet.tsx`) ya no
      existe y su renombrar es `menus/pages/rename-page.tsx`, que **no** usa el pie
      del `Sheet` —tiene su boton adentro— por una razon escrita en su cabecera: el
      `onSave` del pie se apaga solo cuando su promesa resuelve, y `onSave` no puede
      rechazar sin dejar una promesa sin manejar, asi que un renombrar que fallara
      por ahi apagaria la pregunta de "salir sin guardar" y el nombre escrito se
      iria sin avisar.

      O sea que la afirmacion de este guard **cambio de sujeto**, no se weakens: la
      hoja de la nota no existe y el renombrar compartido tiene su boton por
      decision. Lo que sigueAFFirmando es que la plantilla —que si tiene hoja propia
      y la va a seguir teniendo— no trae un segundo guardar ni una salida que no
      pregunte.
    */
    const plantilla = sin('src/components/notes/template-menu-sheet.tsx');

    expect(plantilla, 'delega en onSave').toContain('onSave={() => void');
    expect(plantilla, 'sin guardar dentro').not.toMatch(
      /key: "save",\n(?:.*\n)*?.*onPress/,
    );
    // El Volver se fue con el guardar de dentro: la flecha de arriba hace lo
    // mismo, y la de abajo era la salida que no preguntaba.
    expect(plantilla, 'sin Volver propio').not.toContain('t("common.back")');
  });

  it('compartir dice por que no se puede enviar', () => {
    // Una direccion sin escribir no es un error: es el estado en el que se abre.
    // El motivo lo dice en vez de dejar un boton muerto.
    const form = sin('src/components/shares/share-node-sheet.tsx');
    expect(form, 'pasa el motivo').toContain('t("share.pickSomebody")');
  });
});

describe('donde va la nota: el Guardar del pie', () => {
  const hoja = sinComentarios(
    readFileSync(
      join(import.meta.dirname, '../src/components/notes/where-note-sheet.tsx'),
      'utf8',
    ),
  );

  it('elige con el boton del pie y sin fila de confirmar dentro', () => {
    expect(hoja, 'delega en onSave').toContain('onSave={() => {');
    expect(hoja, 'sin fila de confirmar').not.toContain('note.where.create');
  });

  it('llega limpia aunque antes recordaba', () => {
    /*
      Antes recordaba el ultimo sitio, y con el contrato eso es llegar sucia:
      abrir, no tocar nada y salir preguntaria por una eleccion de la vez anterior.
    */
    expect(hoja, 'limpia al abrir').toMatch(
      /if \(visible\) \{[\s\S]*?setWorkspaceId\(null\)/,
    );
  });

  it('mirar no ensucia: solo el destino cuenta', () => {
    expect(hoja, 'el destino decide').toContain(
      'setSucio(workspaceId !== null || folderId !== null)',
    );
  });
});

describe('reordenar y fijar tambien esperan al Guardar', () => {
  const leer = (p: string) =>
    readFileSync(join(import.meta.dirname, '..', p), 'utf8');
  const sin = (p: string) => sinComentarios(leer(p));
  const crudo = (p: string) => leer(p);

  it('soltar una fila mueve la copia, y no llama a onMove', () => {
    /*
      Cada suelta llamaba a escribir en el store de paso, y cerrar sin Guardar
      dejaba un orden que nadie confirmo.
    */
    const hoja = sin('src/components/ui/reorder-sheet.tsx');
    const suelta = hoja.match(/onReorder=\{\(movedId, toIndex\) =>[\s\S]*?\n              \}/)?.[0] ?? '';
    expect(suelta, 'la suelta existe').not.toBe('');
    expect(suelta, 'mueve la copia').toContain('setOrden(');
    expect(suelta, 'y no escribe').not.toContain('onMove(');
  });

  it('el replay es contra el orden vivo, de uno en uno', () => {
    const hoja = sin('src/components/ui/reorder-sheet.tsx');
    expect(hoja, 'hay replay').toContain('await onMove(id, i - j);');
    expect(hoja, 'las que se fueron no se fuerzan').toContain(
      '.filter((id) => enVivos.has(id))',
    );
    expect(hoja, 'y las que llegaron se quedan donde estan').toContain(
      'if (!objetivo.includes(id)) objetivo.push(id);',
    );
  });

  it('los pins se escriben una sola vez, y no N', () => {
    /*
      Cada `save` planifica desde el `layout` capturado: N escrituras seguidas
      parten del mismo y la segunda se come a la primera. Una sola no tiene ese
      problema porque no hay segunda.
    */
    const panel = sin('src/app/(app)/index.tsx');
    expect(panel, 'hay borrador').toContain('pinsBorrador');
    expect(panel, 'los toques lo mueven').toContain('moverPin');
    expect(panel, 'y Guardar escribe una vez').toContain('await save(siguiente);');
    const saves = panel.match(/await save\(siguiente\);/g) ?? [];
    expect(saves.length, 'una sola escritura').toBe(1);
  });

  it('los seis fijar/quitar al instante se fueron', () => {
    // Existian solo para los toques de la hoja. Con el borrador no hay nadie que
    // los llame, y una funcion que nadie llama y escribe en el store es la proxima
    // puerta por la que se guarda solo.
    const panel = crudo('src/app/(app)/index.tsx');
    for (const nombre of [
      'addList',
      'removeList',
      'addNote',
      'removeNote',
      'addFolder',
      'removeFolder',
    ]) {
      expect(panel, `${nombre} fuera`).not.toContain(`const ${nombre} = `);
    }
  });
});

describe('#2: el foco va al primer campo sin pedir un toque', () => {
  const leer = (p: string) =>
    readFileSync(join(import.meta.dirname, '..', p), 'utf8');
  const sin = (p: string) => sinComentarios(leer(p));

  it('crear enfoca, y las hojas de crear tambien', () => {
    /*
      Abrir "crear tarea" y tener que tocar el campo antes de escribir es un paso
      por nada: lo primero que se hace al crear es escribir el nombre.
    */
    /*
      `renombrar en el menu` es `menus/pages/rename-page.tsx` y no la hoja vieja de
      la nota: esa se borro en la T7 y su renombrar paso a ser la pagina compartida,
      que es la que tiene el `autoFocus`. Es el mismo foco y la misma hoja, asi que
      este guard sigue afirmandolo donde el foco ahora vive.
    */
    for (const [quien, ruta] of [
      ['guardar plantilla', 'src/components/notes/save-template-sheet.tsx'],
      ['compartir', 'src/components/shares/share-node-sheet.tsx'],
      ['crear espacio', 'src/components/workspace/workspace-create-sheet.tsx'],
      ['crear cosa', 'src/components/folders/create-sheet.tsx'],
      ['renombrar', 'src/components/ui/rename-sheet.tsx'],
      ['renombrar en el menu', 'src/components/menus/pages/rename-page.tsx'],
      ['renombrar plantilla', 'src/components/notes/template-menu-sheet.tsx'],
    ] as const) {
      expect(sin(ruta), `${quien}: enfoca al abrir`).toContain('autoFocus');
    }
  });

  it('editar NO roba el teclado', () => {
    // Al editar, lo primero que se hace es mirar —marcar hecho, cambiar
    // prioridad— y un teclado que sale solo tapa la mitad del panel para nada.
    const panel = sin('src/components/lists/item-edit-sheet.tsx');
    expect(panel, 'el foco es solo al crear').toContain('autoFocus={isNew}');
  });
});
