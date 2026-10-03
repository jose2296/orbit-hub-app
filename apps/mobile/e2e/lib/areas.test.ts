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
});

describe('parseAreaFlag', () => {
  it('lee --area', () => {
    expect(parseAreaFlag(['--area', '04-lists'])).toEqual({ only: '04-lists' });
  });

  it('devuelve undefined cuando no hay bandera', () => {
    expect(parseAreaFlag([])).toEqual({});
  });
});