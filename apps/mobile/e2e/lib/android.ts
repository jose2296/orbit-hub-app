import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';

export const ADB =
  process.env.ANDROID_ADB ?? `${homedir()}/Library/Android/sdk/platform-tools/adb`;
export const PAQUETE = process.env.PAQUETE ?? 'com.jrzlabs.orbithub';

export type Device = { serial: string; state: string };

export function adb(args: string[], serial?: string): string {
  return execFileSync(ADB, [...(serial ? ['-s', serial] : []), ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * The pure half of `adb devices`: everything not in state `device` is dropped
 * here. Split out so it can be tested — `devices()` itself shells out to adb and
 * cannot be.
 *
 * The header goes because it does not look like a device row, not because it is
 * the first line. Dropping by position throws away whatever happens to be first,
 * and if that happens to be a real device then `pickDevice` sees fewer devices
 * than exist — the one thing it exists to prevent.
 */
export function parseDevices(salida: string): Device[] {
  return salida
    .split('\n')
    .map((linea) => linea.trim().split(/\s+/))
    .filter((partes): partes is [string, string] => partes.length >= 2 && partes[1] === 'device')
    .map(([serial, state]) => ({ serial, state }));
}

export function devices(): Device[] {
  return parseDevices(adb(['devices']));
}

export function pickDevice(conectados: Device[]): string {
  if (conectados.length === 0) throw new Error('no hay ningun dispositivo android conectado');
  if (conectados.length > 1) {
    throw new Error(
      `hay mas de un dispositivo android conectado: ${conectados.map((d) => d.serial).join(', ')}. ` +
        'Deja uno solo, o reinicia el emulador.',
    );
  }
  return conectados[0]!.serial;
}

export function requireOneDevice(): string {
  return pickDevice(devices());
}

/**
 * `pidof` returns nothing both when the app is dead and when it never ran, so
 * `null` here means "no hay proceso" and the caller treats it as a fault.
 */
export function appPid(serial: string, pkg: string = PAQUETE): string | null {
  try {
    return (adb(['shell', 'pidof', pkg], serial) || '').trim().split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

/**
 * The crash lines the device admits to, `FATAL EXCEPTION` first.
 *
 * An adb failure is NOT an empty buffer. Swallowing it here would let a harness
 * with a wrong `adb` path see a clean crash log and pass every flow, which is the
 * worst way for this harness to be wrong. It throws instead, so the run dies at
 * the step that could not talk to the device.
 *
 * `FATAL EXCEPTION` is a dead native process; `JavascriptException` is a red
 * screen that may well have recovered. Reporting the native crash in preference
 * to the JS one matches the order the signals are checked in, and this array is
 * ordered so `crashes[0]` is the one that matters. Order within each kind is the
 * buffer's own.
 */
export function crashLines(serial: string): string[] {
  const lineas = adb(['logcat', '-d', '-b', 'crash', '-v', 'brief'], serial)
    .split('\n')
    .filter((linea) => /FATAL EXCEPTION|JavascriptException/.test(linea));
  return [
    ...lineas.filter((linea) => linea.includes('FATAL EXCEPTION')),
    ...lineas.filter((linea) => linea.includes('JavascriptException')),
  ];
}

export function clearLogcat(serial: string): void {
  adb(['logcat', '-c'], serial);
}

/**
 * Asks the system to kill the app. Swallows the failure on purpose: a package
 * that was not running is the state this is trying to reach.
 *
 * It does NOT reset the baseline pid, and it does not clear the log. Reading a
 * baseline that belongs to this run is the caller's job, and it needs clearLogcat
 * and forceStop in that order, before the first `appPid`.
 */
export function forceStop(serial: string, pkg: string = PAQUETE): void {
  try {
    adb(['shell', 'am', 'force-stop', pkg], serial);
  } catch {
    /* si no estaba corriendo, no hay nada que parar */
  }
}

export function screenshot(serial: string, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  // Straight to the file, with no shell in between. Interpolating a serial and a
  // path into `sh -c` means a space, a quote or a `$` in either one decides what
  // runs; passing the same words as an argv cannot.
  //
  // `maxBuffer` es obligatorio y no es un adorno. `execFileSync` corta la salida
  // del hijo en un megasibyte por defecto y lanza `ENOBUFS` al pasarse: un PNG de
  // 1080x2400 pesa entre 1 y 2 megas, y el de este emulador medido 1_058_378
  // bytes -nueve mil por encima del limite-. Con el limite por defecto esta funcion
  // falla en una pantalla con muchos pixeles distintos y se pasa en otra con menos,
  // que es peor que no funcionar: el harness escribe la captura que prueba que ha
  // mirado la app, y que falle depende de lo que haya en la pantalla. 32 MB es muy
  // superior a cualquier captura real y sigue siendo un tope.
  writeFileSync(
    file,
    execFileSync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 32 * 1024 * 1024 }),
  );
}