import { describe, expect, it } from 'vitest';
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