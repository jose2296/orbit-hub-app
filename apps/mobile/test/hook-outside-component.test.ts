import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Un hook fuera del cuerpo de un componente.
 *
 * React permite llamar a `useState`, `useMemo` o `useRef` **solo mientras renderiza**
 * un componente: en ese momento existe un dispatcher de render en la pila y React le
 * entrega el estado. En cualquier otro sitio —dentro de un callback, de un `onPress`,
 * de una funcion `async`, de un `then`— no hay dispatcher, y React lanza:
 *
 *     Invalid hook call. Hooks can only be called inside of the body of a function
 *     component.
 *
 * **Este repo ya lo ha pagado dos veces, por motivos distintos, y ninguna de las dos
 * se vio en el navegador:**
 *
 * - Los selectores de color: el `runOnJS` que faltaba, que solo se rompia en nativo.
 * - El login de Google: un `useRef` dentro de `promptNativo`, que es una funcion `async`
 *   llamada desde el `onPress`. Rompia en Android y en iOS, en cada intento, y en la web
 *   nunca se ejecutaba porque el codigo de nativo tiene su propia rama.
 *
 * El patron es siempre el mismo: **la web perdona lo que el movil revienta.** Un hook
 * mal puesto en una rama que solo corre en nativo no se ve nunca en un navegador.
 *
 * Estos tests leen el fuente porque la pregunta no es "que pinta" sino "que se ejecuta
 * dentro de un render y que no". Y leer el fuente es lo unico que se puede comprobar
 * sin un emulador delante: la excepcion se lanza en tiempo de ejecucion, dentro de una
 * rama que en web no entra, y eso no lo ve ni `tsc` ni ningun test de render.
 */

const RAIZ = join(import.meta.dirname, '..', 'src');
const leer = (relativa: string) => readFileSync(join(RAIZ, relativa), 'utf8');

/**
 * The React hooks, and **the React hooks and not everything named `use*`**.
 *
 * `google-auth.ts` imports `useGoogleAuthRequest` from `expo-auth-session/providers/google`
 * and `usePKCE` from `expo-auth-session`. Los dos empiezan por `use`, los dos estan
 * fuera de un render, y los dos son perfectly legitimate: un nombre `use*` imported de
 * una libreria no es un hook de React y no necesita dispatcher.
 *
 * Con `\buse[A-Z]\w*` el guard de abajo los confondia con hooks de React, que es como
 * un guard que protege se vuelve un guard que molesta: el siguiente que lo escriba lo
 * desactiva todo y vuelve el bug de `useRef` sin que nadie avise.
 *
 * La lista es la de React, no unaformula. Un hook de React fuera del cuerpo de un
 * componente es el error que este fichero persigue; una funcion que se llame `use`
 * cualquier cosa no lo es.
 */
const HOOKS =
  /\buse(?:State|Effect|LayoutEffect|InsertionEffect|Context|Reducer|Ref|Memo|Callback|ImperativeHandle|DebugValue|Id|DeferredValue|Transition|SyncExternalStore|Optimistic|ActionState)\b/g;

/**
 * Strip comments and template strings before looking for hooks.
 *
 * The order matters and it is the order that made this necessary: `google-auth.ts`
 * explains the `Invalid hook call` **in the very function that fixes it**, and the
 * explanation names three hooks. A guard that reads comments is not reading code.
 */
function codigoDe(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/**
 * The body of a top-level function declaration.
 *
 * Balanced braces from the opening one, so a hook inside a nested callback is still
 * inside this function — which is the point: the whole body has to be hook-free unless
 * the function is a component or a custom hook.
 */
function cuerpoDeFuncion(fuente: string, nombre: string): string {
  /*
    El `[^{]*\\{` del final no es cosmetico: `useGoogleAuthRequest` declara un tipo de
    retorno antes de la llave —`function useGoogleAuthRequest(): GoogleAuthRequest {`— y
    una expresion que termine en `\\)` se queda con el cuerpo vacio. Un extractor que
    devuelve `''` parece que funciona porque las pruebas que lo usan tienen su propio
    mensaje de fallo, y el resultado es que se aprueban sin haber leido nada.
  */
  const declaracion = new RegExp(`(?:async\\s+)?function\\s+${nombre}\\s*\\([^)]*\\)[^{]*\\{`);
  const m = declaracion.exec(fuente);
  if (!m) return '';

  const abre = m.index + m[0].length - 1;
  let nivel = 1;
  let i = abre + 1;

  while (i < fuente.length && nivel > 0) {
    const c = fuente[i];
    if (c === '{') nivel++;
    else if (c === '}') nivel--;
    i++;
  }
  return fuente.slice(abre + 1, i - 1);
}

describe('nadie llama a un hook fuera de un componente', () => {
  it('las pruebas de este fichero dicen la verdad sobre si mismas', () => {
    /*
      Una puerta de entrada a una suite que no comprueba nada.
      *
      `cuerpoDeFuncion` devuelve `''` cuando no encuentra la funcion, y las tres
      pruebas de abajo aceptan `''` como motivo de fallo con un mensaje propio —eso es
      lo correcto para que el fallo diga algo util—. Pero si esa busqueda se rompe, las
      tres se pasan sin haber leido nada: un guard que se cumple porque no encontro su
      objetivo no es un guard, y este repo ya ha pagado esa factura con los
      comentarios del extractor de gestos.

      Este test comprueba que el extractor encuentra de verdad lo que dice encontrar,
      con funciones que existen y que tienen el cuerpo que se les atribuye.
    */
    const codigo = codigoDe('async function prueba(): Promise<void> { const x = useRef(null); }');
    expect(cuerpoDeFuncion(codigo, 'prueba')).toMatch(/useRef/);

    expect(cuerpoDeFuncion(codigo, 'noExiste'), 'devuelve cadena vacia si no la encuentra').toBe('');
  });
  it('promptNativo, que es async y se llama desde onPress, no llama a hooks', () => {
    const fuente = codigoDe(leer('lib/auth/google-auth.ts'));
    const cuerpo = cuerpoDeFuncion(fuente, 'promptNativo');

    expect(cuerpo, 'no encuentro la funcion promptNativo: el guard estaria mirando otra cosa').not.toBe('');

    /*
      `promptNativo` es `async` y se invoca desde `promptAsync`, que a su vez lo hace
      desde el `onPress` del boton. Ninguno de esos dos momentos es un render, asi que
      cualquier hook aqui revienta con "Invalid hook call" **antes de abrir el
      navegador**: el usuario pulsa y el login muere sin llegar a salir.

      El estado que guardaba —el temporizador del timeout de 120 s— no necesita un hook
      para nada: se crea y se cancela dentro de la misma llamada, sin que haya un render
      de por medio. Lo que este guard protege es que nadie vuelva a meterlo.
    */
    const hooks = cuerpo.match(HOOKS) ?? [];
    expect(hooks, `promptNativo llama a ${hooks.join(', ')} siendo async: eso es Invalid hook call`).toEqual([]);
  });

  it('promptAsync, el otro async del camino, tampoco', () => {
    /*
      El mismo argumento para el segundo de los dos: `promptAsync` tambien es `async` y
      tambien se llama desde el `onPress`. El hook de `useState` que hay en
      `useGoogleAuthRequest` **si** es legitimo —esa funcion es un hook de verdad y se
      renderiza como componente—, asi que lo que se comprueba es que no se haya movido
      nada de ahi hacia abajo, que es como estos bugs se propagan.
    */
    const fuente = codigoDe(leer('lib/auth/google-auth.ts'));
    const cuerpo = cuerpoDeFuncion(fuente, 'promptAsync');

    expect(cuerpo, 'no encuentro la funcion promptAsync').not.toBe('');
    const hooks = cuerpo.match(HOOKS) ?? [];
    expect(hooks, `promptAsync llama a ${hooks.join(', ')} siendo async`).toEqual([]);
  });

  it('los hooks que si quedan estan en useGoogleAuthRequest, que es un hook', () => {
    /*
      La contraprueba. Sin ella, el guard de arriba pasaria con un fichero donde no
      queda ningun hook:是否符合 el regra por haberlos borrado todos.

      `useGoogleAuthRequest` es un hook de verdad —la llama un componente, asi que su
      `useState` y su `useMemo` estan en el sitio correcto— y los dos esten dentro de
      su cuerpo.
    */
    const fuente = codigoDe(leer('lib/auth/google-auth.ts'));
    const cuerpo = cuerpoDeFuncion(fuente, 'useGoogleAuthRequest');

    expect(cuerpo, 'no encuentro useGoogleAuthRequest').not.toBe('');
    expect(cuerpo, 'useGoogleAuthRequest no llama a useState: el guard se cumple sin comprobar nada').toMatch(
      /\buseState\s*\(/,
    );
    /*
      `/\buseMemo\b/` y no `/\buseMemo\s*\(/`: en el fuente real la llamada lleva
      parametros de tipo —`useMemo<GooglePlatform>(() => platform, [platform])`—, y una
      regex que exija el parentesis a continuacion no encuentra nada. Con el mensaje de
      fallo al lado, eso se lee como "el hook se movido" cuando lo que paso es que el
      guard mira donde no hay nada.
    */
    expect(cuerpo, 'useGoogleAuthRequest no llama a useMemo: el guard se cumple sin comprobar nada').toMatch(
      /\buseMemo\b/,
    );
  });

  it('useRef no aparece ya en el fichero de auth: no queda donde meterlo', () => {
    /*
      El import se elimino con el hook. Si alguien lo vuelve a anadir para otra cosa,
      este test dice que en este fichero **no hay ningun sitio legitimo** para un
      `useRef`: el unico hook de render es `useGoogleAuthRequest`, y sus dos hooks ya
      estan ahi.
    */
    expect(
      codigoDe(leer('lib/auth/google-auth.ts')),
      'useRef vuelve a estar en el fichero de auth, y no hay ningun sitio legitimo para el: usalo y rompe el login en nativo',
    ).not.toMatch(/\buseRef\b/);
  });
});