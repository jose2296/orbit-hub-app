import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMaestro } from './maestro';

/**
 * Un Maestro de mentira, y por que hace falta uno.
 *
 * Los tres fallos mas caros que ha tenido este fichero estan todos en como se le
 * pasan los argumentos y en que se devuelve cuando falla, y los tres se ven sin
 * arrancar Maestro: un script que escribe su `$@` en un fichero y sale con el
 * codigo que se le pida contesta a las dos preguntas en milisegundos.
 *
 * El falso binario se pone con `MAESTRO_BIN`, que es justo la variable que existe
 * para poder cambiarlo, asi que el test no depende de la maquina de quien lo corre.
 */
let dir: string;
let guion: string;
let argv: string;

function fake(cuerpo: string): string {
  writeFileSync(guion, `#!/bin/sh\n${cuerpo}\n`, 'utf8');
  chmodSync(guion, 0o755);
  return guion;
}

/** Lo que el falso Maestro recibio, uno por linea. */
function recibido(): string[] {
  return readFileSync(argv, 'utf8').split('\n').filter(Boolean);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maestro-'));
  guion = join(dir, 'maestro');
  argv = join(dir, 'argv.txt');
  process.env.MAESTRO_BIN = guion;
});

afterEach(() => {
  delete process.env.MAESTRO_BIN;
});

describe('runMaestro', () => {
  it('le pasa el directorio del area como un solo argumento', () => {
    // El `spread` de una cadena reparte sus caracteres, y eso es lo que paso:
    // `.../flows/01-onboarding` llego a Maestro como `/`, `U`, `s`, `e`... y
    // respondio `Flow path does not exist: <raiz>/U`. Una afirmacion sobre el argv
    // entero lo habria parado en la primera carrera, sin meter un dedo en un
    // emulador.
    fake(`printf '%s\\n' "$@" > ${argv}\nexit 0`);
    const flows = join(dir, 'flows', '01-onboarding');
    const { code } = runMaestro(flows, { cwd: dir, env: { E2E: '1' } });

    expect(code).toBe(0);
    expect(recibido()).toEqual(['test', '--format', 'NOOP', flows]);
  });

  it('acepta una lista de flujos y no la parte en trozos', () => {
    fake(`printf '%s\\n' "$@" > ${argv}\nexit 0`);
    const flows = [join(dir, 'flows', '01-a', 'uno.yaml'), join(dir, 'flows', '01-a', 'dos.yaml')];
    runMaestro(flows, { cwd: dir, env: {} });

    expect(recibido()).toEqual(['test', '--format', 'NOOP', ...flows]);
  });

  it('anade --include-tags solo por cada etiqueta que se le pase', () => {
    // Sin etiquetas no debe salir la bandera: un `--include-tags` sin valor hace que
    // Maestro se queje, y un `--include-tags` con una etiqueta que no existe deja
    // la carrera sin probar nada y en verde, que es lo peor que puede hacer.
    //
    // Una bandera POR etiqueta, y no una con todas: `maestro test --help` lo declara
    // repetible -`--include-tags=<includeTags>[,<includeTags>...]...`-, y es la
    // unica forma de no depender de como se separen en la version que toque. Esta
    // afirmacion la fijo porque aqui se escribio primero la otra y fallo: la forma
    // repetida es la que hay que afirmar, no la que se recuerda.
    fake(`printf '%s\\n' "$@" > ${argv}\nexit 0`);
    const flows = join(dir, 'flows');

    runMaestro(flows, { cwd: dir, env: {} });
    expect(recibido()).not.toContain('--include-tags');

    runMaestro(flows, { cwd: dir, env: {}, includeTags: ['smoke', 'gesture'] });
    expect(recibido()).toEqual([
      'test',
      '--format',
      'NOOP',
      flows,
      '--include-tags',
      'smoke',
      '--include-tags',
      'gesture',
    ]);
  });

  it('pone el entorno del flujo en el hijo, sin perder el de la maquina', () => {
    // El entorno que sale de la siembra -el email, la contrasena- llega a Maestro
    // por aqui y por ningun otro lado, y el harness no puede perder el `PATH` por el
    // camino: sin el, el hijo no arranca y el fallo se lee como "los flujos
    // fallaron".
    fake(`printf '%s\\n' "\${E2E_EMAIL:-}" > ${argv}\nexit 0`);
    const { code } = runMaestro(join(dir, 'flows'), {
      cwd: dir,
      env: { E2E_EMAIL: 'e2e-ana@example.com' },
    });

    expect(code).toBe(0);
    expect(recibido()).toEqual(['e2e-ana@example.com']);
  });

  it('un codigo de salida distinto de cero vuelve con su numero y con stdout y stderr', () => {
    // Las dos salidas en la misma respuesta. El `catch` de `execFileSync` solo
    // contiene lo que el hijo ha escrito en cada una, y quedarse con una es
    // quedarse con la mitad del motivo: Maestro escribe el resultado de los flujos
    // en stdout y buena parte de los avisos en stderr.
    fake(`echo "3/3 Flows Failed"\necho "Unknown Property: ordered" 1>&2\nexit 3`);
    const salida = runMaestro(join(dir, 'flows'), { cwd: dir, env: {} });

    expect(salida.code).toBe(3);
    expect(salida.output).toContain('3/3 Flows Failed');
    expect(salida.output).toContain('Unknown Property: ordered');
  });

  it('un arranque fallido devuelve una cadena, y no una excepcion sin forma', () => {
    // Un `ENOENT` o un `EACCES` no traen `stdout` ni `stderr`. Con `?? ''` la
    // respuesta sigue siendo imprimible, y un flujo que fallo sin decir nada tiene
    // que verse como un flujo que fallo y no como un runner que se ha quedado
    // mudo. Aqui se usa un directorio como binario: existe -asi que pasa el
    // `existsSync`-, y no se puede ejecutar.
    process.env.MAESTRO_BIN = dir;
    const salida = runMaestro(join(dir, 'flows'), { cwd: dir, env: {} });

    expect(typeof salida.output).toBe('string');
    expect(salida.code).not.toBe(0);
  });

  it('sin binario lanza un error que dice como instalarlo', () => {
    // Antes de invocar nada, y con la instruccion dentro del mensaje: un
    // `ENOENT` de `execFileSync` no dice de donde sale ni que hacer, y se acabaria
    // confundiendo con un flujo que ha fallado.
    process.env.MAESTRO_BIN = join(dir, 'no-existe');
    expect(() => runMaestro(join(dir, 'flows'), { cwd: dir, env: {} })).toThrow(/get\.maestro\.mobile\.dev/);
  });
});
