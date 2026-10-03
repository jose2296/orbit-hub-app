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
  // `.yaml` de abajo. **El orden NO se fija aqui**, y no por decision sino porque
  // no se puede sin acoplar las areas -ver el bloque de `flowsOrder` de mas
  // abajo-.
  //
  // `NOOP` como formato y no `JUNIT`: este harness solo necesita el texto para
  // imprimirlo cuando algo falla, y el HTML y el XML de Maestro salen igualmente
  // en su directorio de artefactos de cada carrera.
  //
  // **No hay `--config`.** Se quito en este commit, y no por sobra de codigo sino
  // porque medido contra Maestro 2.11.0 no queda una sola clave que haga algo:
  //
  //   - `executionOrder.ordered` y `executionOrder.failOnEveryAssert` ya no existen.
  //     Measured: `Unknown Property: ordered` / `failOnEveryAssert` al arrancar, y
  //     `javap` sobre `WorkspaceConfig$ExecutionOrder` de
  //     `maestro-orchestra-models.jar` 2.11.0 confirma que sus dos unicas
  //     propiedades son `continueOnFailure` y `flowsOrder`.
  //   - `executionOrder.continueOnFailure` se acepta pero no cambia nada de lo que
  //     se mide aqui: `false` y `true` corrieron los tres flujos igual. Lo que si
  //     hacia falta -parar el flujo en su primera afirmacion falsa, que es lo que
  //     pedia `failOnEveryAssert`-, ya es lo por defecto: measured, un flujo con
  //     dos afirmaciones falsas reporta solo la primera y la segunda no llega a
  //     ejecutarse -solo hay un `screen-hierarchy/step-004-*` en sus artefactos-.
  //   - `appId`, `name` y `tags` se aceptan y no se consultan. Measured: un flujo
  //     sin su propio `appId` falla con `Config Field Required` aunque el
  //     `config.yaml` de este proyecto lo trajera. Los tres flujos traigan el suyo,
  //     y por eso el fichero puede desaparecer sin que nada se note.
  //
  // Dejar el fichero solo con comentarios tampoco vale: Maestro lo rechaza con
  // `Failed to parse file ... List is empty.`, asi que un `config.yaml` aqui solo
  // puede existir si tiene claves, y no queda ninguna que no sea decoracion.
  //
  // Cuando una fase posterior quiera un orden fijo, `executionOrder.flowsOrder` es
  // la clave -esta measured y funciona-, pero es una lista **por espacio de
  // trabajo**: nombrar ahi los flujos de `01-onboarding` los volveria obligatorios
  // para todas las areas. Por eso el orden se defiende de otra manera, y es la
  // unica que no acopla: cada flujo termina afirmando que ha vuelto a donde
  // empezo, de modo que uno que se queda con una hoja abierta no rompe al
  // siguiente, sea cual sea el orden en que corran.
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