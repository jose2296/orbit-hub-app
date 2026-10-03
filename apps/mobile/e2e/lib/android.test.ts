import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDevices, pickDevice } from './android';

describe('pickDevice', () => {
  it('elige el unico dispositivo conectado', () => {
    expect(pickDevice([{ serial: 'emulator-5554', state: 'device' }])).toBe('emulator-5554');
  });

  it('se niega a adivinar cuando hay mas de uno, y dice cuales', () => {
    const dos = [
      { serial: 'emulator-5554', state: 'device' },
      { serial: 'R58M12345XY', state: 'device' },
    ];
    expect(() => pickDevice(dos)).toThrow(/emulator-5554/);
    expect(() => pickDevice(dos)).toThrow(/R58M12345XY/);
  });

  it('dice que no hay ninguno cuando no hay ninguno', () => {
    expect(() => pickDevice([])).toThrow(/no hay/);
  });
});

describe('parseDevices', () => {
  it('se queda con los que estan en estado device', () => {
    // La filtracion vive aqui y no en pickDevice: pickDevice recibe una lista ya
    // filtrada. Probarlo con un `offline` ahi pasaria por la razon equivocada.
    const salida = ['List of devices attached', 'emulator-5554\tdevice', 'ZY3\tunauthorized', ''].join('\n');
    expect(parseDevices(salida)).toEqual([{ serial: 'emulator-5554', state: 'device' }]);
  });

  it('no descarta la primera linea si es un dispositivo de verdad', () => {
    const salida = 'ZY22\tdevice\nemulator-5554\tdevice\n';
    expect(parseDevices(salida)).toEqual([
      { serial: 'ZY22', state: 'device' },
      { serial: 'emulator-5554', state: 'device' },
    ]);
  });
});

/**
 * El techo de `execFileSync` son un megasibyte, y ahi se perdio una captura entera
 * en la primera carrera de este arnes -`ENOBUFS` con un PNG de 1_058_378 bytes-. Un
 * techo que no se puede ver es un techo que se vuelve a quitar: por eso se afirma
 * aqui, con un adb de mentira que devuelve mas de un megasibyte.
 *
 * `ANDROID_ADB` se lee al cargar el modulo, asi que la importacion es dinamica y con
 * `resetModules`: en el import estatico de arriba la constante ya esta fijada a la
 * de esta maquina y el test no probaria nada.
 */
afterEach(() => {
  delete process.env.ANDROID_ADB;
  vi.resetModules();
});

describe('adb', () => {
  it('aguanta una salida de mas de un megasibyte', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'adb-'));
    const guion = join(dir, 'adb');
    // Dos megas de stdout. `yes` esta en el PATH de todo macOS y `head` tambien, y
    // el guion no necesita permiso de nada mas que ser ejecutable.
    writeFileSync(guion, '#!/bin/sh\nyes 0123456789012345678901234567890123456789 | head -c 2000000\n', 'utf8');
    chmodSync(guion, 0o755);
    process.env.ANDROID_ADB = guion;

    vi.resetModules();
    const { adb } = await import('./android');
    const salida = adb(['devices']);

    expect(salida.length).toBeGreaterThan(1024 * 1024);
  });
});