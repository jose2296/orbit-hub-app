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
 * `list/[listId].tsx` for a comment that blamed the wrong file and fixed nothing.
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
const appHeader = src('src/components/ui/app-header.tsx');
const screen = src('src/components/ui/screen.tsx');
const spaceBand = src('src/components/workspace/space-band.tsx');
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
    const linea = listId.indexOf('item-title-line-');
    const meta = listId.indexOf('styles.meta,');
    expect(
      linea,
      'la linea del titulo necesita su propio testID, que es lo que permite medirla'
    ).toBeGreaterThan(-1);
    expect(meta, 'la segunda linea de la columna es el ancla de cierre').toBeGreaterThan(linea);
    const casilla = listId.indexOf('<Checkbox', linea);
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
    const item = listId.match(/  item:\s*\{[\s\S]*?\n  \}/)?.[0] ?? '';
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
    const soloLaFila = sinComentarios(listId).slice(
      sinComentarios(listId).indexOf('function TaskRow('),
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
      'src/app/(app)/list/[listId].tsx <Badge>',
      'src/app/(app)/list/[listId].tsx <TagChip>',
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

describe('la fila de una tarea no reserva el asa de arrastrar', () => {
  /**
   * 28 points on the right of every row, for a handle that no longer exists: the
   * row stopped being draggable when the order moved into a sheet, and the padding
   * stayed. It is not a decoration, it is width taken from the title on every row
   * of every list.
   */
  it('no tiene paddingRight de asa', () => {
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
    expect(listId).toContain('metaTag');
    // And the second line is drawn only when there is something to draw.
    expect(listId).toContain(
      '{item.priority !== "none" || item.tags.length > 0 ? (',
    );
    const meta = listId.slice(listId.indexOf('metaTag: {'));
    expect(meta).toContain('flexShrink: 1');
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

describe('#9: tirar hacia abajo recarga', () => {
  const screen = readFileSync(
    join(import.meta.dirname, '../src/components/ui/screen.tsx'),
    'utf8',
  );

  it('toda pantalla con scroller tiene el gesto', () => {
    // Ponerlo en un solo sitio —el que se Controlled bien— deja el resto de
    // pantallas sin salida, y en la web es la unica que hay: no hay gesto del
    // sistema a la que agarrarse.
    expect(screen, 'el RefreshControl va en el ScrollView de Screen').toMatch(
      /<ScrollView[\s\S]*?<RefreshControl/,
    );
  });

  it('tira del motor de sincronizacion y no de una segunda ruta', () => {
    expect(screen, 'usa syncNow, que ya sabe lo que tiene').toContain(
      'await syncNow()',
    );
  });

  it('el indicador se apaga tambien cuando la sincronizacion falla', () => {
    // Sin red —o con el servidor caido— un `await` sin `finally` deja el
    // indicador girando para siempre, y eso se lee como "sincronizando" en
    // pantalla con algo que no va a pasar nunca.
    const accion = screen.match(/const alTirar = useCallback\(async \(\) => \{[\s\S]*?\}, \[\]\);/)?.[0] ?? '';
    expect(accion, 'apaga en finally').toContain('finally');
    expect(accion, 'y apaga antes de termina, no despues').toContain(
      'setRecargando(false)',
    );
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
