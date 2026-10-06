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
  it('intervalDays con INTERVAL=3', () => {
    expect(
      describeSchedule({ kind: 'rrule', rule: 'FREQ=DAILY;INTERVAL=3' }),
    ).toEqual({ key: 'intervalDays', interval: 3 });
  });
  it('monthlyOrdinal con BYDAY=1MO', () => {
    expect(
      describeSchedule({ kind: 'rrule', rule: 'FREQ=MONTHLY;BYDAY=1MO' }),
    ).toEqual({ key: 'monthlyOrdinal', ordinal: 1, weekday: 'mon' });
  });
  it('monthlyOrdinal generaliza a cualquier ordinal y dia', () => {
    expect(
      describeSchedule({ kind: 'rrule', rule: 'FREQ=MONTHLY;BYDAY=3FR' }),
    ).toEqual({ key: 'monthlyOrdinal', ordinal: 3, weekday: 'fri' });
  });
  it('un ordinal en frecuencia semanal cae en weeklyDays vacio', () => {
    expect(
      describeSchedule({ kind: 'rrule', rule: 'FREQ=WEEKLY;BYDAY=1MO' }),
    ).toEqual({ key: 'weeklyDays', days: [] });
  });
  it('el generico no se comparte por referencia', () => {
    const first = describeSchedule({ kind: 'rrule', rule: 'FREQ=YEARLY' });
    const second = describeSchedule({ kind: 'rrule', rule: 'FREQ=YEARLY' });
    expect(first).toEqual({ key: 'weeklyDays', days: [] });
    expect(second).toEqual({ key: 'weeklyDays', days: [] });
    expect(first).not.toBe(second);
  });
});
