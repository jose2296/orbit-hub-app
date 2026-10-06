/**
 * Tests de `describeSchedule`: el horario se describe con datos, no con frases.
 *
 * Ningun caso espera texto de interfaz; eso lo pone el diccionario del movil.
 */
import { describe, expect, it } from 'vitest';

import { describeSchedule } from './describe';

describe('describeSchedule', () => {
  it('daily', () =>
    expect(describeSchedule({ kind: 'rrule', rule: 'FREQ=DAILY' })).toEqual({
      key: 'daily',
    }));
  it('weeklyDays trae los dias en orden de lunes a domingo', () => {
    expect(
      describeSchedule({ kind: 'rrule', rule: 'FREQ=WEEKLY;BYDAY=WE,MO,FR' }),
    ).toEqual({ key: 'weeklyDays', days: ['mon', 'wed', 'fri'] });
  });
  it('timesPerPeriod', () => {
    expect(describeSchedule({ kind: 'quota', count: 2, period: 'week' })).toEqual({
      key: 'timesPerPeriod',
      count: 2,
      period: 'week',
    });
  });
  it('una BYDAY de 7 dias tambien es daily', () => {
    expect(
      describeSchedule({
        kind: 'rrule',
        rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU',
      }),
    ).toEqual({ key: 'daily' });
  });
  it('un rrule no reconocido cae en weeklyDays vacio', () => {
    expect(
      describeSchedule({ kind: 'rrule', rule: 'FREQ=MONTHLY;BYMONTHDAY=15' }),
    ).toEqual({ key: 'weeklyDays', days: [] });
  });
});
