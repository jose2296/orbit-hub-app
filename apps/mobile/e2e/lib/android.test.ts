import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDevices, pickDevice, xmlPrefsMetro } from './android';

describe('xmlPrefsMetro', () => {
  it('deja el host del dev server en las preferencias por defecto de la app', () => {
    expect(xmlPrefsMetro('localhost:8095')).toContain(
      '<string name="debug_http_host">localhost:8095</string>',
    );
  });

  it('no deja que el puerto cierre el elemento y se cuele otro nombre', () => {
    // El puerto viene de `E2E_METRO_PORT`, o sea de fuera. Sin escapar, un valor con
    // un `>` cerraria el `<string>` y escribiria una preferencia mas en un fichero de
    // la app.
    const xml = xmlPrefsMetro('8095</string><string name="debug_server_host">x');
    expect(xml).not.toContain('<string name="debug_server_host">');
    expect(xml).toContain('&lt;/string&gt;');
  });

  it('escapa tambien el ampersand, que en XML llega antes que el resto', () => {
    // En el orden de reemplazo de abajo `&` va primero a proposito: si se escapara
    // despues, `&lt;` se convertiria en `&amp;lt;` y el XML quedaria mal formado.
    expect(xmlPrefsMetro('a&b')).toContain('>a&amp;b<');
  });

  it('termina en salto de linea, porque el fichero que se escribe con `cat` lo espera', () => {
    // Sin el salto final, el `cat > fichero` deja la ultima linea sin cerrar en
    // cuanto el proceso escribe algo mas, y un `SharedPreferences` a medio escribir no
    // se lee: la app vuelve a su valor por defecto en silencio. Es el fallo que esta
    // funcion existe para evitar, reintroducido por un byte.
    expect(xmlPrefsMetro('localhost:8095').endsWith('</map>\n')).toBe(true);
  });
});

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