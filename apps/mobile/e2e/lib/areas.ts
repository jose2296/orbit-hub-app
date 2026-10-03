import { readdirSync } from 'node:fs';
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
 * Un area sin flujos se devuelve igual, con la lista vacia.
 *
 * No es un error: un area que se ha creado y todavia no tiene flujos escrito es
 * trabajo por empezar, no trabajo roto, y fallar aqui seria tapar el resto de las
 * areas. El que avisa de ello es el bucle del runner, que lo dice en pantalla, y
 * `flows` sigue vacio de modo que un area sin trabajo nunca se cuela como trabajo
 * hecho.
 */
function area(root: string, nombre: string): Area {
  const dir = join(root, nombre);
  return {
    name: nombre,
    dir,
    flows: readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort(),
  };
}

/**
 * Lee `--area` y `--flow` de los argumentos de `node`.
 *
 * A mano y no con un parser de flags: son dos, y `process.argv.slice(2)` es lo que
 * hay que recorrer igual.
 *
 * **Una bandera sin valor lanza.** Sin este caso, `--area` a secas deja `only` en
 * `undefined`, que es exactamente lo mismo que no haberla pasado: el guard de las
 * areas mal escritas -que es el motivo de existir de `--area` - se queda sin
 * comprobar y el runner recorre todas las areas en vez de ninguna, sin quejarse.
 * Una bandera mal escrita que se pasa sin quejarse es la carrera en verde que este
 * reposito ya pago una vez. Se lanza tambien cuando el "valor" es otra bandera -
 * `--area --flow x`-, que es el mismo error escrito de otra forma.
 */
export function parseAreaFlag(argv: string[]): { only?: string; flow?: string } {
  const salida: { only?: string; flow?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const bandera = argv[i];
    if (bandera !== '--area' && bandera !== '--flow') continue;
    const valor = argv[i + 1];
    if (valor === undefined || valor.startsWith('--')) {
      throw new Error(`${bandera} necesita un valor`);
    }
    if (bandera === '--area') salida.only = valor;
    else salida.flow = valor;
  }
  return salida;
}