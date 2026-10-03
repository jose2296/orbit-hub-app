import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAreaFlag, resolveAreas } from './areas';

function raiz(contenido: Record<string, string[]>): string {
  const base = mkdtempSync(join(tmpdir(), 'areas-'));
  for (const [area, flujos] of Object.entries(contenido)) {
    mkdirSync(join(base, area), { recursive: true });
    for (const flujo of flujos) writeFileSync(join(base, area, flujo), 'appId: x\n');
  }
  return base;
}

describe('resolveAreas', () => {
  it('devuelve las areas en orden, con sus flujos', () => {
    const areas = resolveAreas(raiz({ '02-auth': ['sign-in.yaml'], '01-onboarding': ['welcome.yaml'] }));
    expect(areas.map((a) => a.name)).toEqual(['01-onboarding', '02-auth']);
    expect(areas[0]!.flows).toEqual(['welcome.yaml']);
  });

  it('con --area devuelve solo esa, y falla si no existe', () => {
    const base = raiz({ '01-onboarding': ['welcome.yaml'] });
    expect(resolveAreas(base, '01-onboarding').map((a) => a.name)).toEqual(['01-onboarding']);
    // Un nombre mal escrito tiene que fallar aqui, no descubrir la carrera en verde
    // sin haber probado nada.
    expect(() => resolveAreas(base, 'onboarding')).toThrow(/01-onboarding/);
  });

  it('una area sin flujos se avisa, pero no se cuela como trabajo hecho', () => {
    const areas = resolveAreas(raiz({ '01-onboarding': [], '02-auth': ['sign-in.yaml'] }));
    expect(areas.find((a) => a.name === '01-onboarding')!.flows).toEqual([]);
  });

  it('el config.yaml de un area no cuenta como flujo suyo', () => {
    // Cada area lleva su `config.yaml` con su `flowsOrder`, y termina en `.yaml`
    // como los flujos. Contarlo haria que el area dijera que tiene cuatro flujos
    // cuando tiene tres, y el informe de la tarea 5 sale de ahi.
    const areas = resolveAreas(
      raiz({ '01-onboarding': ['welcome.yaml', 'privacy.yaml', 'config.yaml'] }),
    );
    expect(areas[0]!.flows).toEqual(['privacy.yaml', 'welcome.yaml']);
  });
});

describe('parseAreaFlag', () => {
  it('lee --area', () => {
    expect(parseAreaFlag(['--area', '04-lists'])).toStrictEqual({ only: '04-lists' });
  });

  it('devuelve undefined cuando no hay bandera', () => {
    // `toStrictEqual` y no `toEqual`: `toEqual` no distingue `{}` de
    // `{ only: undefined, flow: undefined }`, asi que la afirmacion pasaria con una
    // `parseAreaFlag` que devolviera las dos claves explicitas y nadie lo sabria.
    expect(parseAreaFlag([])).toStrictEqual({});
  });

  it('una bandera sin valor lanza, en vez de recorrer todas las areas', () => {
    // Sin esto, `--area` a secas devuelve `{}`, que el runner lee como "sin area":
    // recorre todas en vez de ninguna y no se queja. El guard de Review Focus 5 se
    // queda sin comprobar por un espacio de mas en la linea de comandos.
    expect(() => parseAreaFlag(['--area'])).toThrow(/--area/);
    expect(() => parseAreaFlag(['--flow'])).toThrow(/--flow/);
    // Un "valor" que es otra bandera es el mismo error escrito de otra forma.
    expect(() => parseAreaFlag(['--area', '--flow', 'x.yaml'])).toThrow(/--area/);
  });
});