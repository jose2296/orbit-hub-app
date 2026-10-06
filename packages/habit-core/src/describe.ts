/**
 * Describe un horario con datos, nunca con frases.
 *
 * La pantalla no recibe texto de este modulo: solo una clave y sus
 * parametros. El texto en cada idioma lo pone el diccionario del movil.
 */
import * as rruleNamespace from 'rrule';

import type { HabitSchedule } from './types';

/**
 * Ver `schedule.ts` regla 3: el namespace tal cual cuando el bundler eligio
 * el ES module, su `default` cuando el cargador eligio el CommonJS. El
 * import directo revienta en Node ESM y en Hermes; esta es la unica forma
 * que vale en Node, Metro web y Metro nativo.
 */
const rrule = (rruleNamespace as { default?: typeof rruleNamespace }).default ?? rruleNamespace;

const { RRule } = rrule;

/** Dia de la semana, siempre en orden de lunes a domingo. */
export type WeekDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/**
 * Lo que la pantalla necesita para elegir frase: todos los dias, dias
 * sueltos, cada N dias, un dia ordinal del mes o una cuota por periodo.
 */
export type ScheduleDescription =
  | { key: 'daily' }
  | { key: 'weeklyDays'; days: WeekDayKey[] }
  | { key: 'intervalDays'; interval: number }
  | { key: 'monthlyOrdinal'; ordinal: number; weekday: WeekDayKey }
  | { key: 'timesPerPeriod'; count: number; period: 'week' | 'month' | 'year' };

/** De lunes a domingo: coincide con el orden numerico de `rrule` (MO=0). */
const DAYS_IN_ORDER: WeekDayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * Respuesta generica, fresca por llamada: la pantalla cae en su texto por
 * defecto. Nunca se comparte por referencia para que ningun consumidor
 * pueda contaminar llamadas futuras mutando `days`.
 */
function unknownSchedule(): ScheduleDescription {
  return { key: 'weeklyDays', days: [] };
}

/** Un dia suelto (MO) o un ordinal del mes (1MO, con `n`). */
type WeekdaySplit = {
  days: number[];
  ordinals: Array<{ weekday: number; n: number }>;
};

function validDayNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
    ? value
    : null;
}

/**
 * Separa `byweekday` en dias sueltos y ordinales. `rrule` entrega objetos
 * (`{weekday}` o `{weekday, n}`) y a veces numeros; el ordinal viaja en
 * `entry.n` y jamas se mezcla con los dias sueltos.
 */
function splitByWeekday(byweekday: unknown): WeekdaySplit {
  const list = Array.isArray(byweekday) ? byweekday : [byweekday];
  const days: number[] = [];
  const ordinals: Array<{ weekday: number; n: number }> = [];
  for (const entry of list) {
    if (typeof entry === 'number') {
      const day = validDayNumber(entry);
      if (day !== null) days.push(day);
    } else if (typeof entry === 'object' && entry !== null) {
      const weekday = validDayNumber((entry as { weekday?: unknown }).weekday);
      if (weekday === null) continue;
      const n = (entry as { n?: unknown }).n;
      if (typeof n === 'number' && Number.isInteger(n)) {
        ordinals.push({ weekday, n });
      } else {
        days.push(weekday);
      }
    }
  }
  return { days: [...new Set(days)].sort((a, b) => a - b), ordinals };
}

/** Traduce un numero de dia (0=lunes) a su clave; nulo si no existe. */
function dayKey(day: number): WeekDayKey | null {
  const key = DAYS_IN_ORDER[day];
  return key === undefined ? null : key;
}

function describeRrule(rule: string): ScheduleDescription {
  let options: InstanceType<typeof RRule>['origOptions'];
  try {
    options = RRule.fromString(rule).origOptions;
  } catch {
    return unknownSchedule();
  }
  const { freq, interval, byweekday } = options;
  if (freq === RRule.DAILY) {
    if (interval === undefined || interval === 1) return { key: 'daily' };
    // Cada N dias no es "todos los dias": tiene clave propia.
    if (interval >= 2) return { key: 'intervalDays', interval };
    return unknownSchedule();
  }
  if (freq === RRule.MONTHLY) {
    if (byweekday === undefined || byweekday === null) return unknownSchedule();
    const { days, ordinals } = splitByWeekday(byweekday);
    // Solo un ordinal suelto (1MO, 3FR, -1SU): cualquier otra forma cae
    // en el generico en vez de inventar un semanal falso.
    if (ordinals.length === 1 && days.length === 0) {
      const single = ordinals[0];
      if (single === undefined) return unknownSchedule();
      const weekday = dayKey(single.weekday);
      if (weekday === null) return unknownSchedule();
      return { key: 'monthlyOrdinal', ordinal: single.n, weekday };
    }
    return unknownSchedule();
  }
  if (freq !== RRule.WEEKLY) return unknownSchedule();
  if (byweekday === undefined || byweekday === null) return unknownSchedule();
  const { days, ordinals } = splitByWeekday(byweekday);
  // Un ordinal (1MO) no es una seleccion semanal: generico, no semanal.
  if (ordinals.length > 0 || days.length === 0) return unknownSchedule();
  // Siete dias marcados es "todos los dias" con otro nombre.
  if (days.length === 7) return { key: 'daily' };
  const ordered: WeekDayKey[] = [];
  for (const day of days) {
    const key = dayKey(day);
    if (key !== null) ordered.push(key);
  }
  return { key: 'weeklyDays', days: ordered };
}

/** Convierte un horario en los datos que la pantalla usa para su frase. */
export function describeSchedule(schedule: HabitSchedule): ScheduleDescription {
  if (schedule.kind === 'quota') {
    return { key: 'timesPerPeriod', count: schedule.count, period: schedule.period };
  }
  return describeRrule(schedule.rule);
}
