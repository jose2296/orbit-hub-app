import { describe, expect, it } from 'vitest';
import { verdict } from './guard';

const vivo = { pid: '4242' };
const muerto = { pid: null };

describe('verdict', () => {
  it('pasa cuando el proceso sigue igual y no hay crashes', () => {
    expect(verdict(vivo, vivo, [])).toEqual({ ok: true, problems: [] });
  });

  it('falla cuando no queda proceso', () => {
    expect(verdict(vivo, muerto, []).ok).toBe(false);
    expect(verdict(vivo, muerto, []).problems[0]).toContain('se cerro');
  });

  it('falla cuando el pid cambia, que es un relanzamiento en silencio', () => {
    const v = verdict(vivo, { pid: '5151' }, []);
    expect(v.ok).toBe(false);
    expect(v.problems[0]).toContain('4242');
    expect(v.problems[0]).toContain('5151');
  });

  it('falla ante un crash del buffer, y lo cita', () => {
    const v = verdict(vivo, vivo, ['FATAL EXCEPTION: main']);
    expect(v.ok).toBe(false);
    expect(v.problems[0]).toContain('FATAL EXCEPTION');
  });

  it('un proceso muerto se reporta como muerto, no como crash', () => {
    // El buffer puede tener lneas de antes. El sintoma que manda es la ausencia
    // de proceso, y reportar las dos cosas mete ruido en el informe.
    const v = verdict(vivo, muerto, ['FATAL EXCEPTION: main']);
    expect(v.problems).toHaveLength(1);
    expect(v.problems[0]).toContain('se cerro');
  });

  it('acepta un pid inicial desconocido sin inventar un relanzamiento', () => {
    // La app no estaba corriendo antes del area: no hubo cambio de pid porque no
    // habia pid. Esto no es un fallo.
    expect(verdict(muerto, vivo, []).ok).toBe(true);
  });
});