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
const itemPresentation = src('src/lib/lists/item-presentation.ts');
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
    expect(sinComentarios(listId)).not.toMatch(/const PRIORITY_TONE/);
    expect(sinComentarios(listId)).toMatch(/PRIORITY_TONE[,\s}]/);
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