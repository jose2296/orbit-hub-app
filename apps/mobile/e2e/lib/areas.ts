import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type Area = { name: string; dir: string; flows: string[] };

/**
 * Las areas son los subdirectorios de `flows/`, y cada uno se corre entero en una
 * invocacion de Maestro.
 *
 * El nombre del area es lo que nombra un fallo en el informe, asi que el orden es
 * el del arbol y no el de `readdir`: `01-onboarding` antes que `02-auth` porque el
 * prefijo lo dice, y porque el orden de lectura de un directorio no esta escrito
 * en ningun sitio.
 */
export function resolveAreas(root: string, only?: string): Area[] {
  const nombres = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  // Un `--area` que no existe lanza aqui y no mas abajo. Maestro sale con codigo 0
  // cuando no ha probado nada, asi que un nombre mal escrito que se pasara sin
  // quejarse es una carrera en verde que no ha mirado la app. El error lleva la
  // lista de los nombres validos porque el que escribe el nombre es el mismo que
  // se lo va a equivocar.
  if (only !== undefined) {
    if (!nombres.includes(only)) {
      throw new Error(`no existe el area "${only}". Hay: ${nombres.join(', ') || '(ninguna)'}`);
    }
    return [area(root, only)];
  }
  return nombres.map((nombre) => area(root, nombre));
}

/**
 * El nombre del fichero de configuracion de Maestro dentro de un area.
 *
 * Cada area lleva el suyo, con su `flowsOrder` -measured: Maestro descubre solo el que
 * encuentra en el directorio que se le pasa, asi que uno por area es lo que permite
 * fijar el orden de un area sin acoplar las demas-. El nombre va aqui y no repetido
 * en el filtro porque es el unico fichero de esta lista que no es un flujo, y por
 * eso tiene que ser un dato y no una condicion escrito en una linea.
 */
const CONFIG_AREA = 'config.yaml';

/**
 * Un area sin flujos se devuelve igual, con la lista vacia.
 *
 * No es un error: un area que se ha creado y todavia no tiene flujos escrito es
 * trabajo por empezar, no trabajo roto, y fallar aqui seria tapar el resto de las
 * areas. El que avisa de ello es el bucle del runner, que lo dice en pantalla, y
 * `flows` sigue vacio de modo que un area sin trabajo nunca se cuela como trabajo
 * hecho.
 *
 * Y `config.yaml` fuera de los flujos, aunque acabe en `.yaml` como ellos: no es un
 * flujo que se pueda correr -Maestro tampoco lo corre, measured- y contarlo haria que
 * el area dijera que tiene cuatro flujos cuando tiene tres, y que `--flow
 * config.yaml` pareciera una opcion.
 */
function area(root: string, nombre: string): Area {
  const dir = join(root, nombre);
  const flows = readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') && f !== CONFIG_AREA)
    .sort();
  exigirOrden(nombre, dir, flows);
  return { name: nombre, dir, flows };
}

/**
 * La pasada de Maestro por un area, y cuantos flujos la cuentan.
 *
 * **Las dos mitades en una funcion, porque son la misma verdad.** El runner pasaba
 * un solo fichero a Maestro con `--flow` y luego escribia en el informe los flujos
 * que tenia el area: la fila decia `3 flujos` y el motivo de un fallo decia `1 de 3`
 * para una invocacion de un flujo. El numero va en las dos, asi que un numero
 * equivocado no se ve en una parte y se acepta en la otra -no es un dato, es la
 * cobertura que el informe dice haber medido-.
 *
 * El directorio entero y no la lista de dentro cuando no hay `--flow`, porque es
 * Maestro quien descubre los `.yaml` y quien lee el `config.yaml` del area para el
 * orden. Con `--flow`, el fichero tal cual; que exista lo comprueba Maestro, y por
 * eso un `--flow` mal escrito sale en rojo como fallo de Maestro y no en silencio
 * como un `--area` mal escrito: un flujo que no se encuentra si lo dice.
 */
export function corrida(area: Area, flow?: string): { flujo: string | string[]; cuantos: number } {
  return flow === undefined
    ? { flujo: area.dir, cuantos: area.flows.length }
    : { flujo: join(area.dir, flow), cuantos: 1 };
}

/**
 * Los dos conjuntos tienen que ser el mismo: los `flowsOrder` que declara el
 * `config.yaml` del area y los `.yaml` que hay en ella.
 *
 * **Por que(set-)igualdad y no "contar los mismos".** Los dos fallos que deja fuera
 * son los dos que Maestro no avisa: measured, un flujo que no esta en la lista **se
 * corre igual**, despues y en un hueco sin decidir, asi que el area sigue en verde y
 * ha dejado de tener orden. Y un renombrado deja a la vez las dos listas
 * desiguales -un nombre que ya no existe y un fichero que nadie nombra-, que es el
 * caso mas probable porque renombrar es lo que se hace al reutilizar un flujo.
 *
 * **Por que lanza y no avisa.** Es el mismo motivo que el area mal escrita de mas
 * arriba: un area que se corre en un orden que nadie escribio no es una carrera que
 * valga, y con el aviso del reparto de shards de Maestro encima -que dice `the
 * number of flows (0)` y no dice nada de esto- nadie se enteraria. Aqui el aviso lo
 * ve quien anade el flujo, que es quien tiene que arreglarlo, y el mensaje dice
 * exactamente que falta y que sobra.
 *
 * Un area **sin** `flowsOrder` no se comprueba: es el estado por defecto de un area
 * nueva, y obligar a que nazca con un `config.yaml` seria otra cosa.
 */
function exigirOrden(area: string, dir: string, flows: string[]): void {
  const declarados = flowsOrderDe(dir);
  if (declarados === null) return;
  const sinDeclarar = flows.map(sinYaml).filter((f) => !declarados.includes(f));
  const sinFichero = declarados.filter((d) => !flows.includes(`${d}.yaml`));
  if (sinDeclarar.length === 0 && sinFichero.length === 0) return;
  const partes: string[] = [];
  if (sinDeclarar.length > 0) partes.push(`sin declarar en flowsOrder: ${sinDeclarar.join(', ')}`);
  if (sinFichero.length > 0) partes.push(`en flowsOrder sin fichero: ${sinFichero.join(', ')}`);
  throw new Error(
    `el area ${area} y su ${CONFIG_AREA} no dicen lo mismo - ${partes.join('; ')}. ` +
      'Anadir un flujo y anadirlo a flowsOrder son el mismo trabajo.',
  );
}

function sinYaml(nombre: string): string {
  return nombre.endsWith('.yaml') ? nombre.slice(0, -'.yaml'.length) : nombre;
}

/**
 * Los `flowsOrder` de un `config.yaml` de area, o `null` si no hay `flowsOrder`.
 *
 * **Un lector de YAML hecho a mano, y a proposito.** `js-yaml` y `yaml` estan en
 * `node_modules` porque los trajeron Expo y Metro, no porque `@orbit-hub/mobile` los
 * declare: importarlos seria una dependencia fantasma que se rompe el dia que Metro
 * cambie su arbol. Anadir un parser al arbol de la app para leer una lista de tres
 * nombres seria mas caro que lo que protege.
 *
 * Lo que este lector **no** hace es adivinar: dos formas -`flowsOrder: [a, b]` en una
 * linea y el bloque de `- a` debajo- y cualquier otra cosa lanza. Un orden mal leido
 * en silencio seria el fallo que la comprobacion de arriba existe para cazar.
 */
function flowsOrderDe(dir: string): string[] | null {
  let texto: string;
  try {
    texto = readFileSync(join(dir, CONFIG_AREA), 'utf8');
  } catch {
    return null;
  }
  const lineas = texto.split('\n');
  const clave = lineas.findIndex((l) => /^\s*flowsOrder\s*:/.test(l));
  if (clave === -1) return null;

  const enUnaLinea = /flowsOrder\s*:\s*\[([^\]]*)\]/.exec(lineas[clave]!);
  if (enUnaLinea) return enUnaLinea[1]!.split(',').map(sinComillas).filter(Boolean);
  if (/:/.test(lineas[clave]!) && lineas[clave]!.includes('flowsOrder')) {
    const resto = lineas[clave]!.slice(lineas[clave]!.indexOf('flowsOrder') + 'flowsOrder'.length + 1).trim();
    if (resto !== '' && !resto.startsWith('#')) {
      throw new Error(`${CONFIG_AREA}: no se entiende "flowsOrder: ${resto}" en ${dir}`);
    }
  }

  const sangriaDeLaClave = sangria(lineas[clave]!);
  const nombres: string[] = [];
  for (let i = clave + 1; i < lineas.length; i += 1) {
    const linea = lineas[i]!;
    if (linea.trim() === '' || linea.trim().startsWith('#')) continue;
    if (sangria(linea) <= sangriaDeLaClave) break;
    const item = /^\s*-\s*(.+?)\s*$/.exec(linea);
    if (!item) throw new Error(`${CONFIG_AREA}: no se entiende la linea "${linea.trim()}" de flowsOrder en ${dir}`);
    nombres.push(sinComillas(item[1]!));
  }
  return nombres;
}

function sangria(linea: string): number {
  return linea.length - linea.trimStart().length;
}

function sinComillas(valor: string): string {
  return valor.replace(/^["']|["']$/g, '').trim();
}

/**
 * Lee `--area` y `--flow` de los argumentos de `node`.
 *
 * A mano y no con un parser de flags: son dos, y `process.argv.slice(2)` es lo que
 * hay que recorrer igual.
 *
 * **Las dos formas, y las dos por el mismo motivo.** `--area x` y `--area=x` tienen
 * que acabar en lo mismo, porque las dos se escriben: la segunda es la que pasan los
 * CLIs y la que copia quien ya ha escrito un comando asi. Antes solo se comparaba el
 * token entero con `--area`, y `--area=04-lists` no era una bandera: no era una
 * bandera ni un valor, asi que no se miraba, `parseAreaFlag` devolvia `{}` y el
 * runner recorria **todas** las areas sin quejarse -el guard de las areas mal
 * escritas, que es el motivo de existir de `--area`, sin comprobar, por una
 * ortografia-. Un flag que solo entiende la mitad de las formas no avisa de cuando ha
 * fallado, y esa es la mitad de las veces.
 *
 * **Una bandera sin valor lanza.** Sin este caso, `--area` a secas deja `only` en
 * `undefined`, que es exactamente lo mismo que no haberla pasado: el guard de las
 * areas mal escritas -que es el motivo de existir de `--area` - se queda sin
 * comprobar y el runner recorre todas las areas en vez de ninguna, sin quejarse.
 * Una bandera mal escrita que se pasa sin quejarse es la carrera en verde que este
 * reposito ya pago una vez. Se lanza tambien cuando el "valor" es otra bandera -
 * `--area --flow x`-, que es el mismo error escrito de otra forma, y cuando el valor
 * del `=` viene vacio, que es el mismo error con menos ruido.
 *
 * **Y una bandera que no existe lanza, en vez de ignorarse.** Cualquier otro token
 * es un error: lo unico que el runner acepta son estas dos. Ignorarlo es el fallo
 * que el parrafo anterior describe, en su forma mas facil de escribir -`--areas`,
 * `--are`, `--dry-run`-: nadie lo ve porque el runner no dice nada, y la carrera se
 * pone entera y no ha corrido lo que se le pidio.
 */
export function parseAreaFlag(argv: string[]): { only?: string; flow?: string } {
  const salida: { only?: string; flow?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    // El `=` se parte antes de mirar que bandera es, y no al reves: los dos caminos
    // tienen que acabar en el mismo `valor`, y partirlo despues obligaria a repetir
    // la comprobacion de "necesita un valor" dos veces, que es donde se meterian los
    // dos errores distintos.
    const [nombre, ...resto] = token.split('=');
    const bandera = nombre!;
    if (bandera !== '--area' && bandera !== '--flow') {
      throw new Error(
        `no entiendo "${token}". Lo unico que este arnes acepta son --area y --flow, con su valor`,
      );
    }
    // Un valor pegado con `=` o el siguiente argumento: los dos, y el que toque. El
    // `join` es para que un valor con `=` dentro -un path, una expresion- no se
    // desangre al partirlo.
    let valor: string | undefined;
    if (resto.length > 0) {
      valor = resto.join('=');
    } else {
      valor = argv[i + 1];
      if (valor !== undefined) i += 1;
    }
    if (valor === undefined || valor === '' || valor.startsWith('--')) {
      throw new Error(`${bandera} necesita un valor`);
    }
    if (bandera === '--area') salida.only = valor;
    else salida.flow = valor;
  }
  return salida;
}