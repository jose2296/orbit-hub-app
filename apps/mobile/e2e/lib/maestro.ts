import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

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
  // `cwd` es la raiz del repo, y no `e2e/maestro/`, porque es lo que deja las rutas
  // relativas de los flujos cerca del resto del artefactado. Y aun asi no las deja
  // donde uno las busca: measured, un `takeScreenshot: capturas/android/01-welcome`
  // acaba en `~/.maestro/tests/<carrera>/<flujo>/takeScreenshot/capturas/android/`
  // con cualquier `cwd`. Lo que si llega a `capturas/android/` es el
  // `screenshot()` del runner, uno por area.
  //
  // El directorio entero y no la lista de flujos de dentro: Maestro descubre los
  // `.yaml` de abajo. El **orden lo fija el `config.yaml` de cada area**, con su
  // `flowsOrder`; aqui no hay nada que decidir. Que cada area lleve el suyo y no uno
  // compartido es lo que permite fijarlo sin acoplar las areas -measured: Maestro
  // descubre solo el `config.yaml` del directorio que se le pasa-.
  //
  // `NOOP` como formato y no `JUNIT`: este harness solo necesita el texto para
  // imprimirlo cuando algo falla, y el HTML y el XML de Maestro salen igualmente
  // en su directorio de artefactos de cada carrera.
  //
  // **No hay `--config`.** Se quito en este commit, y no por sobra de codigo sino
  // porque medido contra Maestro 2.11.0 no queda una sola clave que pueda ir en un
  // fichero **compartido**:
  //
  //   - `executionOrder.ordered` y `executionOrder.failOnEveryAssert` ya no existen.
  //     Measured: `Unknown Property: ordered` / `failOnEveryAssert` al arrancar, y
  //     `javap` sobre `WorkspaceConfig$ExecutionOrder` de
  //     `maestro-orchestra-models.jar` 2.11.0 confirma que sus dos unicas
  //     propiedades son `continueOnFailure` y `flowsOrder`.
  //   - `executionOrder.continueOnFailure` depende de la otra. **Sin `flowsOrder` no
  //     hace nada**: measured, `false` y `true` corrieron los tres flujos igual. Con
  //     `flowsOrder` al lado si manda -`continueOnFailure: false` mas una lista de
  //     tres nombres aborta los que quedan: `Flow ccc failed and continueOnFailure is
  //     set to false, aborting running sequential Flows`-. Asi que "esta clave esta
  //     muerta" era verdad solo para el fichero sin lista, y de ahi el error: si
  //     alguien anade orden a un area, esta clave empieza a cortar el area.
  //     Aqui la de cada area va a `true` a proposito, para que un flujo que falle no
  //     esconda al siguiente.
  //   - `appId`, `name` y `tags` se aceptan y no se consultan. Measured: un flujo
  //     sin su propio `appId` falla con `Config Field Required` aunque el
  //     `config.yaml` de este proyecto lo trajera. Los tres flujos traigan el suyo,
  //     y por eso el fichero puede desaparecer sin que nada se note.
  //
  // Y lo que si hacia falta -parar el flujo en su primera afirmacion falsa, que es
  // lo que pedia `failOnEveryAssert`-, ya es lo por defecto: measured, un flujo con
  // dos afirmaciones falsas reporta solo la primera y la segunda no llega a
  // ejecutarse -solo hay un `screen-hierarchy/step-004-*` en sus artefactos-.
  //
  // Lo que no hacia falta y se perdia sin darse cuenta: el orden. Sin `flowsOrder`
  // Maestro corre en el orden que devuelve el sistema de ficheros -measured, en una
  // prueba salio `bbb, aaa, ccc`-, y con `welcome.yaml` usando `clearState: true`
  // mientras los otros dos no, un orden asi hacia depender el resultado de donde
  // cayera el fichero. Por eso hay un `config.yaml` por area.
  const args = ['test', '--format', 'NOOP'];
  // `...flujos` y no `...flowsPath`: el `spread` de una cadena reparte sus
  // CARACTERES, y un directorio de area acabaria pasado a Maestro como `/`, `U`,
  // `s`, `e`... Cada uno de esos es un flujo que no existe. Measured, no supuesto:
  // `Flow path does not exist: <raiz>/U`, de `.../flows/01-onboarding`.
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