import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

import {
  CARD_SIZES,
  MAX_CARD_COLUMNS,
  MAX_CARD_ROWS,
  MIN_CARD_COLUMNS,
  MIN_CARD_ROWS,
  PANEL_COLUMNS,
  PANEL_ROWS,
  dropSpot,
  heldSpot,
  oneStepTowards,
  placeCards,
  snapSize,
} from "@/lib/dashboard/panel";
import {
  BOARD_SWIPE_DISTANCE,
  BOARD_SWIPE_VELOCITY,
  nextPageFor,
} from "@/lib/lists/board-paging";

/**
 * Un worklet que lee una constante de modulo.
 *
 * Esto no se puede cazar con un test de comportamiento, y conviene decir por que
 * antes de mostrar el test, porque **la razon por la que existe es la misma razon
 * por la que 117 archivos de test estaban en verde con la app cerrandose.**
 *
 * Dos gestos cerraban la aplicacion en Android, con el mismo error:
 *
 * ```
 * Property 'PANEL_COLUMNS' doesn't exist       panel.ts:155      snapSize
 * Property 'BOARD_SWIPE_DISTANCE' doesn't exist board-paging.ts:135 nextPageFor
 * ```
 *
 * Los dos son un **parametro por defecto que referencia una constante `export`ada**
 * dentro de una funcion con la directiva `'worklet'`. El parametro se evalua antes
 * de entrar al cuerpo, y por eso el error sale en la linea de la firma y no en la
 * primera sentencia — que es justo el detalle que hace que el stack apunte a una
 * linea donde no hay nada raro.
 *
 * **La causa de fondo es que el plugin de Babel de Reanimated compila un binding de
 * modulo `export`ado como un acceso al namespace del modulo.** En el hilo de
 * interfaz ese namespace viaja serializado como `{}`, y `PANEL_COLUMNS` deja de
 * existir ahi: el error dice "no existe" un nombre que existe de sobra, esta en el
 * mismo archivo, mas arriba, a un ExportKeyword de distancia.
 *
 * **Y en el hilo de JavaScript todo resuelve bien, que es la parte que duele.** Por
 * eso la web no lo ve, por eso los 117 archivos de test pasan, y por eso un test que
 * llama `snapSize(w, h)` con los defaults no dice absolutamente nada: en Node el
 * scope de modulo resuelve normal. Esta clase de bug es **estructuralmente invisible
 * al test suite de comportamiento**, y eso es un hecho sobre la suite, no sobre el
 * bug — asi que el unico RED posible es un guard estatico sobre el fuente, y este
 * archivo es ese guard.
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");

/**
 * Todos los `.ts` y `.tsx` del source, ordenados.
 *
 * **El archivo entero y no la lista de los que tienen un worklet**, porque un guard
 * que solo mira donde ya sabemos que hay un problema es un guard que no vigila. El
 * error que cierra la app estaba en un archivo que nadie iba a agregar a una lista
 * de entrada, y el que hay que cazar es el siguiente.
 */
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(src);
  return found.sort();
}

function parse(path: string, code: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    code,
    ts.ScriptTarget.ESNext,
    // Los padres hacen falta para nombrar una funcion anonima: sin ellos, una arrow
    // function que es el inicializador de una constante no sabe como se llama y el
    // mensaje de fallo tendria que decir "linea 412" a secas.
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Si un `Node` lleva el modificador `export`. */
function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) ??
      false)
  );
}

/**
 * Los nombres de las constantes que el modulo `export`a.
 *
 * **Solo `VariableStatement` y no funciones, clases ni tipos.** El problema medido es
 * el de un binding de valor: el plugin lo compila como acceso al namespace del
 * modulo y en el hilo de interfaz el namespace llega como `{}`. Una funcion
 * `export`ada tiene otro camino — el de `test/panel-worklets.test.ts`, que exige que
 * la funcion del otro lado diga `'worklet'` — y un tipo no viaja a ningun hilo.
 *
 * **Y solo enlace de nombre, no una propiedad.** Un `export const CARD_SIZES` es el
 * caso; `obj.PANEL_COLUMNS` es una propiedad de otra cosa y no tiene nada que ver con
 * esto.
 */
function exportedConstNames(tree: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement) || !isExported(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
    }
  }
  return names;
}

/**
 * El nombre de una funcion, sea como se haya escrito.
 *
 * Las cuatro formas que aparecen en el source: `function f`, `const f = () =>`,
 * `const f = function`, y `f()` dentro de un objeto. **La cuarta se nombra por la
 * propiedad**, y no es por elegancia: un mensaje de fallo que dice "una funcion sin
 * nombre en la linea 812" hace que el que lo lee empiece a buscar por el archivo
 * entero en lugar de ir a la linea que le estan diciendo.
 */
function functionName(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && node.name) return node.name.getText();
  const parent = node.parent;
  if (
    ts.isVariableDeclaration(parent) &&
    ts.isIdentifier(parent.name) &&
    parent.initializer === node
  ) {
    return parent.name.text;
  }
  if (
    ts.isPropertyAssignment(parent) &&
    parent.initializer === node
  ) {
    return parent.name.getText();
  }
  return "una funcion sin nombre";
}

/** Las cuatro clases de funcion que se buscan, en una sola condicion. */
function isFunctionLike(
  node: ts.Node,
): node is
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/**
 * Si el cuerpo dice `'worklet'` **en su primera sentencia**.
 *
 * En la primera y no en cualquiera, porque ahi es donde la directiva significa algo:
 * Reanimated la lee como la sentencia inicial del cuerpo, y un `'worklet'` en
 * cualquier otro sitio es un string que no hace nada. Una arrow function de una
 * linea (`() => 'worklet'`) tampoco es worklet — no tiene sentencias — y por eso
 * `ts.isBlock` esta en la condicion.
 */
function hasDirective(body: ts.Node | undefined): body is ts.Block {
  if (!body || !ts.isBlock(body)) return false;
  const first = body.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "worklet"
  );
}

/** Una referencia a una constante exportada que se escapo de un worklet. */
interface Offender {
  /** Ruta relativa a `src`, para que el mensaje no traiga un `/Users/...`. */
  file: string;
  worklet: string;
  name: string;
  line: number;
  /**
   * Donde estaba. **Los defaults son los que se rompen antes de entrar al cuerpo**,
   * y por eso el mensaje los separa: es el unico lugar de un worklet donde el
   * arreglo no puede ser "declaralo adentro".
   */
  donde: "firma" | "cuerpo";
}

/**
 * Las referencias a constantes exportadas dentro de los worklets de un archivo.
 *
 * **Los parametros se escanean con sus valores por defecto y a parte del cuerpo**,
 * y no como un solo recorrido del nodo de la funcion, porque el valor por defecto
 * *vive en la firma* y por eso **es lo unico que no se puede arreglar moviendolo al
 * cuerpo**. Es la forma exacta del bug reportado: el error sale en la linea de la
 * firma, y el arreglo es declarar el valor local adentro.
 *
 * **Y el nombre de la declaracion no es una referencia.** Cuando alguien arregle esto
 * con un local, ese local es un `VariableDeclaration` cuyo nombre coincide con el de
 * una exportada; contarlo como uso seria marcar al propio arreglo como bug. La regla
 * es la del lenguaje — un nombre enlazado no se usa a si mismo — y no una excepcion
 * puesta para que el test pase.
 */
function offendersIn(path: string, code: string): Offender[] {
  const tree = parse(path, code);
  const exported = exportedConstNames(tree);
  const found: Offender[] = [];
  const file = path.slice(src.length + 1);

  const record = (
    identifier: ts.Identifier,
    node: ts.Node,
    donde: "firma" | "cuerpo",
  ) => {
    const { text } = identifier;
    if (!exported.has(text)) return;
    found.push({
      file,
      worklet: functionName(node),
      name: text,
      line: tree.getLineAndCharacterOfPosition(identifier.getStart()).line + 1,
      donde,
    });
  };

  const visit = (node: ts.Node) => {
    if (isFunctionLike(node) && hasDirective(node.body)) {
      for (const parameter of node.parameters) {
        const scan = (child: ts.Node) => {
          if (ts.isIdentifier(child)) record(child, node, "firma");
          ts.forEachChild(child, scan);
        };
        scan(parameter);
      }
      const scanBody = (child: ts.Node) => {
        if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name)) {
          // El nombre enlazado, no el valor: el inicializador se escanea igual.
          const { name } = child;
          const declarationName = name;
          const scanInit = (inner: ts.Node) => {
            if (inner !== declarationName && ts.isIdentifier(inner)) {
              record(inner, node, "cuerpo");
            }
            ts.forEachChild(inner, scanInit);
          };
          if (child.initializer) scanInit(child.initializer);
          if (child.type) scanInit(child.type);
          return;
        }
        if (ts.isIdentifier(child)) record(child, node, "cuerpo");
        ts.forEachChild(child, scanBody);
      };
      scanBody(node.body);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

const offences = sourceFiles().flatMap((path) =>
  offendersIn(path, readFileSync(path, "utf8")),
);

/**
 * Como se lee un conjunto de ofensores, **con el archivo y la linea de cada
 * referencia**: un "algo anda mal con los worklets" sin linea no es accionable, y
 * este archivo existe para que el que lo lea vaya directo a la linea.
 */
function report(items: Offender[]): string {
  return items
    .map(
      (item) =>
        `  ${item.file}:${item.line}  ${item.worklet} -> ${item.name} (${item.donde})`,
    )
    .join("\n");
}

describe("un worklet no lee constantes del scope de modulo de su archivo", () => {
  it("mira todos los archivos del source, no solo los que ya tienen un worklet", () => {
    // El mismo razon que `panel-worklets.test.ts` da para su propia lista, y por el
    // mismo motivo: un guard que solo recorre donde ya se sabe que hay un problema
    // es un guard que no Mira. Si esto llegara a cero, el `it` de abajo pasaria
    // sin haber examined nada.
    expect(sourceFiles().length).toBeGreaterThan(0);
  });

  it("encuentra worklets con la directiva para mirar adentro", () => {
    // **Antes de exigir que no haya ofensores, hay que probar que el escaner
    // encuentra worklets.** Un guard que no encuentra nada pasa con una cara
    // perfectamente honesta, y ese es el modo de fallo que hace que un guard se
    // mantenga en el repo durante meses sin volver a vigilar nada.
    const conDirectiva = sourceFiles().filter((path) => {
      const tree = parse(path, readFileSync(path, "utf8"));
      let found = false;
      const visit = (node: ts.Node) => {
        if (isFunctionLike(node) && hasDirective(node.body)) found = true;
        ts.forEachChild(node, visit);
      };
      visit(tree);
      return found;
    });
    expect(conDirectiva.length).toBeGreaterThan(0);
    // Los dos archivos donde esta el bug tienen que estar en el conjunto, y no por
    // una lista escrita a mano: porque un guard que se queda sin mirar el archivo
    // del crash sin que nadie se entere es un guard desactivado.
    expect(conDirectiva.some((path) => path.endsWith("panel.ts"))).toBe(true);
    expect(conDirectiva.some((path) => path.endsWith("board-paging.ts"))).toBe(
      true,
    );
  });

  it("no hay ninguno", () => {
    expect(offences.length, report(offences)).toBe(0);
  });
});

/**
 * Los valores que quedaron duplicados adentro de los worklets siguen valiendo lo que
 * valen los `export` de arriba.
 *
 * **El guard de arriba no dice esto.** El guard dice que el worklet no lee el scope de
 * modulo, y por construccion no puede decir nada del numero escrito a mano que
 * remplazo a la lectura: un `4` donde antes habia un `PANEL_COLUMNS` se ve
 * exactamente igual desde el analizador. **Y ese es el unico riesgo real que deja el
 * arreglo** — los locales se despegan de los exportados y un panel de 3 columnas
 * deja de ser el panel de 4 sin que nadie diga nada — asi que hace falta su propio
 * check, y por eso esta en el mismo archivo y no repartido en tres.
 *
 * **La forma del check es "lo que responden con los defaults es lo mismo que lo que
 * responden con los exports de punta a punta",** y no "el default es 4": comparar
 * comportamiento y no fuente es lo que lo hace immune a que alguien reorganice la
 * firma, y es lo unico que se puede comprobar con un test de comportamiento, que es
 * justamente lo que el guard de arriba no puede ser.
 *
 * **Y tiene un limite, que conviene decir en voz alta:** un default que solo se
 * mueve dentro de un rango en el que nada cambia no se nota. **`rows` en `snapSize`
 * es el caso, y lo sigue siendo:** la tarjeta mas alta de `CARD_SIZES` es de cuatro
 * filas, asi que un default de cinco y uno de seis responden lo mismo y este test no
 * los distingue ahi.
 *
 * **Lo que hace que `heldSpot` y `dropSpot` si distingan `rows` es el clamp, y por
 * eso su fixture esta construido alrededor de un dedo que se sale del panel:** el
 * tope de la respuesta es `columns - limit.w` y `rows - limit.h`, o sea que ahi el
 * default es la unica cosa que decide el numero que sale. Un fixture con el dedo
 * cerca de la primera celda responde lo mismo con cualquier grid y no ancla nada —
 * que es lo que pasaba con el primer fixture de este archivo, con celda cuadrada y
 * centro en (40, 40), que contestaba `{ x: 0, y: 0 }` para los seis grids que se le
 * probaron.
 */
describe("los valores duplicados de los worklets siguen valiendo lo del export", () => {
  it("snapSize: lo que responden con los defaults es lo que responden con los exports", () => {
    // Un `5` en el `columns` de la firma se ve: con cuatro columnas el catalogo se
    // recorta y el `5 x 5` cae a `4 x 4`, y con tres caeria a `3 x 3`.
    expect(snapSize(5, 5)).toEqual(snapSize(5, 5, PANEL_COLUMNS, PANEL_ROWS));
    // Y un `columns` mas grande que el panel tambien: el `5 x 5` no se recorta y
    // devuelve el mismo `4 x 4`, que es el tope de `CARD_SIZES`.
    expect(snapSize(1, 1)).toEqual(snapSize(1, 1, PANEL_COLUMNS, PANEL_ROWS));
    // El piso: un `w` que no es un numero tiene que caer en el minimo, no en cero.
    expect(snapSize(Number.NaN, Number.NaN)).toEqual(
      snapSize(Number.NaN, Number.NaN, PANEL_COLUMNS, PANEL_ROWS),
    );
    expect(snapSize(Number.NaN, Number.NaN)).toEqual({
      w: MIN_CARD_COLUMNS,
      h: MIN_CARD_ROWS,
    });
    // Y el catalogo entero, entrada por entrada, que es el otro duplicado.
    const tamanoDe = (w: number, h: number) => {
      const { w: cw, h: ch } = snapSize(w, h);
      return CARD_SIZES.find((size) => size.w === cw && size.h === ch);
    };
    for (let w = 1; w <= MAX_CARD_COLUMNS; w += 1) {
      for (let h = 1; h <= MAX_CARD_ROWS; h += 1) {
        expect(tamanoDe(w, h), `snapSize(${w}, ${h})`).toEqual({ w, h });
      }
    }
  });

  it("placeCards: el grid por defecto es el del panel", () => {
    const cards = [
      { id: 'a', w: 2, h: 2, x: 3, y: 4 },
      { id: 'b', w: 1, h: 1, x: 0, y: 0 },
      { id: 'c', w: 4, h: 4, x: 0, y: 0 },
    ];
    expect(placeCards(cards)).toEqual(
      placeCards(cards, PANEL_COLUMNS, PANEL_ROWS),
    );
  });

  /**
   * La celda, el centro y la tarjeta del fixture de `heldSpot` y `dropSpot`.
   *
   * **El centro esta lejos a proposito, y esa es la unica parte del fixture que hay
   * que explicar.** El clamp de `clampCell` recorta a `[0, max]` con `max` igual a
   * `columns - limit.w` y a `rows - limit.h`, y **un indice crudo que esta dentro
   * del rango no llega al clamp**: sale el mismo numero que entra, y el `columns` o
   * el `rows` que se escribieron en la firma no dejan ningun rastro en la respuesta.
   * Un fixture con el dedo cerca de la primera celda esta, entonces, verde por la
   * razon equivocada — verde porque el clamp no hizo nada — **y sigue verde si los
   * literales de la firma son falsos, que es el agujero que quedaba en la primera
   * version de este archivo.**
   *
   * Los numeros, medidos y no estimados:
   *
   * | | calculo | valor |
   * | --- | --- | --- |
   * | paso horizontal | `width + gap` = 60 + 8 | **68** |
   * | paso vertical | `height + gap` = 40 + 8 | **48** |
   * | indice crudo en X | `round((400 - 68) / 68)` | **5** |
   * | indice crudo en Y | `round((500 - 48) / 48)` | **9** |
   * | tope en X con `columns = 4` | `4 - 2` | **2** |
   * | tope en Y con `rows = 6` | `6 - 2` | **4** |
   *
   * Los dos indices crudos son mayores que los dos topes, asi que **los dos clamps
   * se enganchan de verdad**: la respuesta es el tope, y el tope es la unica parte
   * de la funcion que depende del default. Por eso el dedo esta en (400, 500), que
   * es fuera del panel — y esa es la razon, no la comodidad.
   *
   * **Y la celda no es cuadrada a proposito.** Con `height` igual a `width` los dos
   * ejes se mueven juntos y un error en el `rows` se puede tapar con un error en el
   * `columns`. Con 60 de ancho y 40 de alto los pasos son 68 y 48, distintos, y cada
   * eje se lee por separado.
   *
   * Que el fixture viejo era vacio esta medido y no supuesto: con celda de 60 y 60,
   * centro en (40, 40) y tarjeta de 2 x 2, el indice crudo cae en **0** en los dos
   * ejes y la respuesta es `{ x: 0, y: 0 }` para todo grid de `2 x 2` a `12 x 20` —
   * **una sola respuesta para seis grids distintos.** Si alguien acerca el centro
   * otra vez, el fixture vuelve a ser eso.
   */
  const CELDA = { width: 60, height: 40, gap: 8 };
  const CENTRO = { x: 400, y: 500 };
  const TARJETA = { w: 2, h: 2 };

  it("heldSpot: el clamp es lo que vuelve observable el grid por defecto", () => {
    /**
     * **El ancla: lo que responden con los defaults es lo que responden con los
     * exports pasados a mano.** `PANEL_COLUMNS` y `PANEL_ROWS` son el cuatro y el
     * seis de la firma, escritos por el mismo motivo en los dos lados.
     */
    expect(heldSpot(TARJETA, CENTRO, CELDA)).toEqual(
      heldSpot(TARJETA, CENTRO, CELDA, PANEL_COLUMNS, PANEL_ROWS),
    );
    // Y el valor, que es el tope del clamp en cada eje: `4 - 2` y `6 - 2`.
    expect(heldSpot(TARJETA, CENTRO, CELDA)).toEqual({ x: 2, y: 4 });

    /**
     * **Y despues, que el fixture tiene que demostrar que muerde.** Estas cuatro
     * lineas son la parte que faltaba: con el dedo cerca de la primera celda las
     * cinco llamadas de abajo responderian `{ x: 0, y: 0 }` y el test pasaria con
     * los literales falsos. **Que las cuatro respuestas de los lados sean distintas
     * de la del medio es la prueba de que el clamp se engancho.**
     */
    const propia = heldSpot(TARJETA, CENTRO, CELDA, PANEL_COLUMNS, PANEL_ROWS);
    expect(heldSpot(TARJETA, CENTRO, CELDA, PANEL_COLUMNS - 1, PANEL_ROWS)).not.toEqual(
      propia,
    );
    expect(heldSpot(TARJETA, CENTRO, CELDA, PANEL_COLUMNS, PANEL_ROWS - 1)).not.toEqual(
      propia,
    );
    expect(heldSpot(TARJETA, CENTRO, CELDA, PANEL_COLUMNS, PANEL_ROWS + 1)).not.toEqual(
      propia,
    );
    expect(heldSpot(TARJETA, CENTRO, CELDA, PANEL_COLUMNS + 1, PANEL_ROWS)).not.toEqual(
      propia,
    );
    // Los valores y no solo la desigualdad: el crudo en X es 5 y el tope son 2, asi
    // que con una columna menos el tope es 1 y con una mas es 3.
    expect(heldSpot(TARJETA, CENTRO, CELDA, PANEL_COLUMNS - 1, PANEL_ROWS)).toEqual({
      x: 1,
      y: 4,
    });
    expect(heldSpot(TARJETA, CENTRO, CELDA, PANEL_COLUMNS + 1, PANEL_ROWS)).toEqual({
      x: 3,
      y: 4,
    });
    // El crudo en Y es 9 y el tope son 4: con una fila menos el tope es 3, con una
    // mas es 5.
    expect(heldSpot(TARJETA, CENTRO, CELDA, PANEL_COLUMNS, PANEL_ROWS - 1)).toEqual({
      x: 2,
      y: 3,
    });
    expect(heldSpot(TARJETA, CENTRO, CELDA, PANEL_COLUMNS, PANEL_ROWS + 1)).toEqual({
      x: 2,
      y: 5,
    });
  });

  it("dropSpot: el mismo ancla, y ademas que sepa esquivar", () => {
    /**
     * **Una tarjeta en la esquina de arriba a la izquierda, lejos del dedo.** Con el
     * dedo abajo a la derecha no hay nada que esquivar y la respuesta es la celda
     * donde esta el dedo — **lo que hace que este sea el fixture del ancla**, y por
     * que responde exactamente lo mismo que `heldSpot` en los cinco grids.
     */
    const others = [{ id: 'a', x: 0, y: 0, w: 2, h: 2 }];
    expect(dropSpot(others, TARJETA, CENTRO, CELDA)).toEqual(
      dropSpot(others, TARJETA, CENTRO, CELDA, PANEL_COLUMNS, PANEL_ROWS),
    );
    expect(dropSpot(others, TARJETA, CENTRO, CELDA)).toEqual({ x: 2, y: 4 });
    // El mismo barrido que en `heldSpot`, con los mismos cinco valores.
    const propia = dropSpot(others, TARJETA, CENTRO, CELDA, PANEL_COLUMNS, PANEL_ROWS);
    expect(dropSpot(others, TARJETA, CENTRO, CELDA, PANEL_COLUMNS - 1, PANEL_ROWS)).toEqual({
      x: 1,
      y: 4,
    });
    expect(dropSpot(others, TARJETA, CENTRO, CELDA, PANEL_COLUMNS + 1, PANEL_ROWS)).toEqual({
      x: 3,
      y: 4,
    });
    expect(dropSpot(others, TARJETA, CENTRO, CELDA, PANEL_COLUMNS, PANEL_ROWS - 1)).toEqual({
      x: 2,
      y: 3,
    });
    expect(dropSpot(others, TARJETA, CENTRO, CELDA, PANEL_COLUMNS, PANEL_ROWS + 1)).toEqual({
      x: 2,
      y: 5,
    });
    expect(dropSpot(others, TARJETA, CENTRO, CELDA, PANEL_COLUMNS - 1, PANEL_ROWS)).not.toEqual(
      propia,
    );
    expect(dropSpot(others, TARJETA, CENTRO, CELDA, PANEL_COLUMNS, PANEL_ROWS - 1)).not.toEqual(
      propia,
    );

    /**
     * **Y ahora la otra mitad de `dropSpot`, que es la que la distingue de
     * `heldSpot`: una tarjeta ocupa justo la celda donde esta la que se lleva.**
     * Con los defaults el dedo dice `(2, 4)` y esa celda esta ocupada, asi que la
     * respuesta tiene que ser otra — `(2, 2)`, que es la libre mas cercana. **Sin
     * esta parte el test de arriba pasaria igual con un `dropSpot` que fuera un
     * `heldSpot` con un `nearestFreeSpot` de mas**, que es el otro modo en que un
     * guard queda verde sin vigilar.
     */
    const tapada = [{ id: 'a', x: 2, y: 4, w: 2, h: 2 }];
    expect(dropSpot(tapada, TARJETA, CENTRO, CELDA)).toEqual(
      dropSpot(tapada, TARJETA, CENTRO, CELDA, PANEL_COLUMNS, PANEL_ROWS),
    );
    expect(dropSpot(tapada, TARJETA, CENTRO, CELDA)).toEqual({ x: 2, y: 2 });
    // Y que de verdad esquivo: la celda del dedo es `(2, 4)` y la respuesta es otra.
    expect(heldSpot(TARJETA, CENTRO, CELDA)).toEqual({ x: 2, y: 4 });
    expect(dropSpot(tapada, TARJETA, CENTRO, CELDA)).not.toEqual(
      heldSpot(TARJETA, CENTRO, CELDA),
    );
    /**
     * **El `columns` se lee tambien aca, y el `rows` no — y no es una falta de este
     * test sino una consecuencia de como funciona el clamp, medida y no supuesta.**
     * Con la celda tapada, `rows = 5` y `rows = 6` responden las dos `(2, 2)`: con
     * seis filas el dedo cae en `(2, 4)`, que esta tapada, y la libre mas cercana es
     * `(2, 2)` a distancia 4; con cinco filas el dedo ya cae en `(2, 3)`, que tambien
     * esta tapada porque el rectangulo tapado la cubre, y la libre mas cercana es la
     * misma `(2, 2)`, a distancia 1. **Dos indices crudos distintos y la misma
     * respuesta.**
     *
     * Por eso el ancla del `rows` para `dropSpot` vive en el fixture de arriba, con
     * una tarjeta que no tapa nada: ahi los dos clamps mandan y las cuatro respuestas
     * alrededor son distintas. Y por eso el barrido de `columns` esta dos veces, una
     * por fixture, con los dos numeros distintos que salen de cada uno.
     */
    expect(dropSpot(tapada, TARJETA, CENTRO, CELDA, PANEL_COLUMNS - 1, PANEL_ROWS)).not.toEqual(
      dropSpot(tapada, TARJETA, CENTRO, CELDA, PANEL_COLUMNS, PANEL_ROWS),
    );
    expect(dropSpot(tapada, TARJETA, CENTRO, CELDA, PANEL_COLUMNS + 1, PANEL_ROWS)).not.toEqual(
      dropSpot(tapada, TARJETA, CENTRO, CELDA, PANEL_COLUMNS, PANEL_ROWS),
    );
  });

  it("oneStepTowards: el tope sigue siendo el de la tarjeta mas grande", () => {
    // **El `4` del tope, escrito en el cuerpo.** Un paso desde el tope hacia algo
    // mas grande es el caso que lo distingue: si el tope fuera 9, la tarjeta pasaria
    // de cuatro columnas; si fuera 3, bajaria de cuatro. Con el tope en 4 se queda
    // en 4, que es lo que dice `MAX_CARD_COLUMNS`.
    expect(
      oneStepTowards(
        { w: MAX_CARD_COLUMNS, h: MAX_CARD_ROWS },
        { w: 9, h: 9 },
      ),
    ).toEqual({ w: MAX_CARD_COLUMNS, h: MAX_CARD_ROWS });
    // Y de abajo se llega al tope en un paso, que es lo que un tope mas chico
    // impediria.
    expect(
      oneStepTowards({ w: MAX_CARD_COLUMNS - 1, h: MAX_CARD_ROWS - 1 }, { w: 4, h: 4 }),
    ).toEqual({ w: MAX_CARD_COLUMNS, h: MAX_CARD_ROWS });
    // El piso del `1`: una tarjeta de dos columnas no puede encogerse a cero.
    expect(oneStepTowards({ w: 2, h: 2 }, { w: 0, h: 0 })).toEqual({ w: 1, h: 1 });
  });

  it("nextPageFor: los umbrales por defecto son los del panel", () => {
    // Un dedo que viaja exactamente lo que el umbral cuenta y uno que viaja un punto
    // menos: es la unica diferencia entre paginar y quedarse, y por eso el numero
    // escrito tiene que seguir siendo el del export.
    //
    // **El signo es el del dedo, no el de la pagina**: arrastrar a la izquierda —
    // `offset` negativo — es lo que muestra lo que viene, y desde la primera pagina
    // eso es la segunda. Con `offset` positivo el gesto es el de volver atras y el
    // clamp lo deja donde estaba, que es la respuesta correcta y no un cero raro.
    expect(nextPageFor(-BOARD_SWIPE_DISTANCE, 0, 5, 0)).toBe(1);
    expect(nextPageFor(-(BOARD_SWIPE_DISTANCE - 1), 0, 5, 0)).toBe(0);
    expect(nextPageFor(0, -BOARD_SWIPE_VELOCITY, 5, 0)).toBe(1);
    expect(nextPageFor(0, -(BOARD_SWIPE_VELOCITY - 1), 5, 0)).toBe(0);
    expect(nextPageFor(-60, 0, 5, 2)).toBe(
      nextPageFor(-60, 0, 5, 2, BOARD_SWIPE_DISTANCE, BOARD_SWIPE_VELOCITY),
    );
  });
});

/**
 * Lo que este guard **no** cubre, escrito abajo y no enterrado en un ticket.
 *
 * 1. **Referencias cruzadas a un `import` de otro modulo.** Un `import { X } from
 *    "./y"` leido dentro de un worklet es el mismo problema en principio — el
 *    binding tambien viaja serializado, y llega o no llega segun como lo capture el
 *    plugin — pero **no se ha observado ninguno**, y un guard que falla por algo que
 *    nadie ha visto es un guard que entrena a ignorar sus propios fallos. Cuando se
 *    vea uno, la regla se amplia aqui y en ese momento, con el crash en la mano.
 * 2. **Los callbacks que el plugin workletiza sin que se lo pidan.** El
 *    `useDerivedValue`, el `useAnimatedStyle`, los `on*` de un gesture builder: no
 *    tienen directiva y este escaner no los ve. `test/panel-worklets.test.ts` cubre
 *    la otra mitad de ese problema — que lo que llaman sea un worklet — y esta es la
 *    diferencia: **este no los cubre, y el motivo es que la forma del fallo es
 *    otra.** Un callback sin directiva no se workletiza por su nombre, asi que no
 *    hay un binding de modulo que el plugin convierta en acceso al namespace: lo que
 *    viaja es el closure entero. La regla para ese caso tendria que estar escrita
 *    sobre el closure y no sobre los nombres, y no hay crash que la motive todavia.
 * 3. **Un duplicado que se despegue sin que se note.** El `describe` de arriba
 *    compara comportamiento con los defaults contra los exports, que es lo mas que
 *    un test de comportamiento puede dar: **un default que se mueve dentro de un
 *    rango en el que la respuesta no cambia no se distingue**, y por eso el comment
 *    de ese bloque nombra el caso. Lo que no cambia es que un despegarse que llegue
 *    a la pantalla rompe un test, y no hace falta mas que eso para que se note.
 */