import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
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
 */
export function parseDevices(salida: string): Device[] {
  return salida
    .split('\n')
    .slice(1)
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

export function crashLines(serial: string): string[] {
  try {
    return adb(['logcat', '-d', '-b', 'crash', '-v', 'brief'], serial)
      .split('\n')
      .filter((linea) => /FATAL EXCEPTION|JavascriptException/.test(linea));
  } catch {
    return [];
  }
}

export function clearLogcat(serial: string): void {
  adb(['logcat', '-c'], serial);
}

/** Review Focus 2: the baseline pid has to belong to this run, not the last one. */
export function forceStop(serial: string, pkg: string = PAQUETE): void {
  try {
    adb(['shell', 'am', 'force-stop', pkg], serial);
  } catch {
    /* si no estaba corriendo, no hay nada que parar */
  }
}

export function screenshot(serial: string, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  execFileSync('sh', ['-c', `"${ADB}" -s ${serial} exec-out screencap -p > "${file}"`]);
}