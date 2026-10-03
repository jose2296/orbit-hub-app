import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * El `config.yaml` del proyecto de Maestro, encontrado desde este fichero y no
 * desde el directorio de trabajo.
 *
 * Sin `--config`, Maestro busca un `config.yaml` en la raiz de su espacio de
 * trabajo, que es el directorio desde el que se lanza -la raiz del repo-. El
 * nuestro esta en `e2e/maestro/`, asi que sin esto Maestro no lo leeria y su
 * `executionOrder.continueOnFailure` se quedaria en el valor por defecto sin que
 * nada lo dijera.
 *
 * El directorio de trabajo se queda en la raiz del repo a proposito, y no en
 * `e2e/maestro/`: es lo que pone las rutas relativas de los flujos -los
 * `takeScreenshot`, que escriben `capturas/android/`- junto al resto del
 * artefactado del arnes. Measured: con `cwd` en la raiz, un
 * `takeScreenshot: capturas/android/01-welcome` deja el fichero en
 * `~/.maestro/tests/<carrera>/<flujo>/takeScreenshot/capturas/android/`, no en el
 * repo, que es donde lo buscaria quien lo vaya a mirar.
 */
const CONFIG = fileURLToPath(new URL('../maestro/config.yaml', import.meta.url));

/**
 * Donde esta el binario.
 *
 * `MAESTRO_BIN` sale de un modo que se puede ajustar, y `~/.maestro/bin/maestro`
 * es donde lo deja su instalador. Comprobar que existe antes de invocarlo, y no
 * confiar en el codigo de salida, porque un `ENOENT` seria un codigo de salida
 * tambien y aqui se acabaria confundiendo "no hay Maestro" con "los flujos
 * fallaron" -los dos salen por el mismo return-.
 */
export function maestroBin(): string {
  return process.env.MAESTRO_BIN ?? `${homedir()}/.maestro/bin/maestro`;
}

export function runMaestro(
  flowsPath: string | string[],
  opts: { cwd: string; env: Record<string, string>; includeTags?: string[] },
): { code: number; output: string } {
  const bin = maestroBin();
  if (!existsSync(bin)) {
    throw new Error(
      `no encuentro Maestro en ${bin}. Instalalo con: curl -Ls "https://get.maestro.mobile.dev" | bash`,
    );
  }
  // El directorio entero y no la lista de flujos de dentro: Maestro los descubre
  // abajo y los corre en orden, que en 2.11 es siempre asi -no hay ningun
  // `executionOrder.ordered` que poner a false-, asi que pasarle los nombres aqui
  // obligaria a decidir en este fichero el orden que ya se decide en el flujo.
  //
  // `NOOP` como formato y no `JUNIT`: este harness solo necesita el texto para
  // imprimirlo cuando algo falla, y el HTML y el XML de Maestro salen igualmente
  // en su directorio de artefactos de cada carrera.
  const args = ['test', '--format', 'NOOP'];
  // Solo si existe: el flag es opcional y un `config.yaml` borrado no puede ser la
  // razon de que un flujo no corra.
  if (existsSync(CONFIG)) args.push('--config', CONFIG);
  // `...flujos` y no `...flowsPath`: el `spread` de una cadena reparte sus
  // CARACTERES, y un directorio de area acabaria pasado a Maestro como `/`, `U`,
  // `s`, `e`... Uno de esos es un flujo que no existe y el otro es una bandera que
  // Maestro no conocia. Measured, no supuesto: `Flow path does not exist:
  // <raiz>/U`, de `.../flows/01-onboarding`.
  const flujos = Array.isArray(flowsPath) ? flowsPath : [flowsPath];
  args.push(...flujos);
  for (const tag of opts.includeTags ?? []) args.push('--include-tags', tag);
  try {
    const output = execFileSync(bin, args, {
      cwd: opts.cwd,
      encoding: 'utf8',
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (error) {
    // Ni `stdout` ni `stderr` existen cuando lo que fallo fue el propio arranque.
    // Los dos vacios dan un string, que es lo que el bucle del runner imprime: un
    // flujo que fallo sin decir nada tiene que verse como un flujo que fallo, no
    // como un runner que se ha quedado mudo.
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}` };
  }
}