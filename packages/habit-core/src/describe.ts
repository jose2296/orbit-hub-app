/**
 * Describe un horario con datos, nunca con frases.
 *
 * La pantalla no recibe texto de este modulo: solo una clave y sus
 * parametros. El texto en cada idioma lo pone el diccionario del movil.
 */
import { RRule } from 'rrule';

import type { HabitSchedule } from './types';

/** Dia de la semana, siempre en orden de lunes a domingo. */
export type WeekDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/**
 * Lo que la pantalla necesita para elegir frase: todos los dias, dias
 * sueltos o una cuota de veces por periodo.
 */
export type ScheduleDescription =
  | { key: 'daily' }
  | { key: 'weeklyDays'; days: WeekDayKey[] }
  | { key: 'timesPerPeriod'; count: number; period: 'week' | 'month' | 'year' };

/** De lunes a domingo: coincide con el orden numerico de `rrule` (MO=0). */
const DAYS_IN_ORDER: WeekDayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Respuesta generica: la pantalla cae en su texto por defecto. */
const UNKNOWN: ScheduleDescription = { key: 'weeklyDays', days: [] };

/** Normaliza `byweekday` a numeros de 0 (lunes) a 6 (domingo). */
function toDayNumbers(byweekday: unknown): number[] {
  const list = Array.isArray(byweekday) ? byweekday : [byweekday];
  const numbers: number[] = [];
  for (const entry of list) {
    if (typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry <= 6) {
      numbers.push(entry);
    } else if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { weekday?: unknown }).weekday === 'number'
    ) {
      const n = (entry as { weekday: number }).weekday;
      if (Number.isInteger(n) && n >= 0 && n <= 6) numbers.push(n);
    }
  }
  return [...new Set(numbers)].sort((a, b) => a - b);
}

function describeRrule(rule: string): ScheduleDescription {
  let parsed: RRule;
  try {
    parsed = RRule.fromString(rule);
  } catch {
    return UNKNOWN;
  }
  const { freq, interval, byweekday } = parsed.origOptions;
  // Un cada-N-dias no es "todos los dias": no se describe como daily.
  if (freq === RRule.DAILY && (interval === undefined || interval === 1)) return { key: 'daily' };
  if (byweekday === undefined || byweekday === null) return UNKNOWN;
  const days = toDayNumbers(byweekday);
  if (days.length === 0) return UNKNOWN;
  // Siete dias marcados es "todos los dias" con otro nombre.
  if (days.length === 7) return { key: 'daily' };
  const ordered: WeekDayKey[] = [];
  for (const n of days) {
    const key = DAYS_IN_ORDER[n];
    if (key !== undefined) ordered.push(key);
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
