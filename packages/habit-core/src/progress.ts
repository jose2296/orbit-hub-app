/**
 * Estado por dia y progreso por periodo.
 *
 * - `statusForDate` solo vale para horarios `rrule`: una cuota cuenta marcas
 *   por periodo y no tiene estado por dia, asi que con cuota lanza en vez de
 *   devolver algo falsamente tranquilizador.
 * - En los conteos `rrule`, solo suma lo que cae en dia programado: una marca
 *   fuera de programa es valida como registro, pero no cuenta como progreso
 *   del programa. Asi `done` nunca pasa de `target` y la tasa queda en [0, 1].
 * - Todo lo que es un dia compara `LocalDate` como texto: el formato
 *   `YYYY-MM-DD` ordena igual en texto que en calendario.
 */
import { periodBounds, scheduledDates, todayIn } from './schedule';
import type { HabitEntry, HabitRecord, LocalDate } from './types';

/** El estado de un dia con horario `rrule`, y solo hay estos cinco. */
export type HabitStatus = 'due' | 'done' | 'skipped' | 'missed' | 'not_due';

/** Hechas contra objetivo en un periodo, mas si el periodo sigue en curso. */
export type PeriodProgress = { done: number; target: number; open: boolean };

const isDoneMark = (habitId: string, entry: HabitEntry): boolean =>
  entry.habitId === habitId && entry.status === 'done';

const maxDate = (a: LocalDate, b: LocalDate): LocalDate => (a >= b ? a : b);

const minDate = (a: LocalDate, b: LocalDate): LocalDate => (a <= b ? a : b);

/**
 * Estado del habito en un dia. Solo para `kind: 'rrule'`; con `kind: 'quota'`
 * lanza porque una cuota no tiene estado por dia.
 *
 * Sin marca, manda el programa: fuera de programa (incluido fuera del rango
 * activo del habito) es `not_due`, programado en hoy o futuro es `due` y
 * programado en pasado es `missed`. Con marca, manda la marca.
 */
export function statusForDate(
  habit: HabitRecord,
  date: LocalDate,
  entries: HabitEntry[],
): HabitStatus {
  if (habit.schedule.kind !== 'rrule') {
    throw new Error(
      `statusForDate solo vale para horarios 'rrule': el habito ${JSON.stringify(habit.id)} ` +
        `usa una cuota ('quota') y no tiene estado por dia; usa progressForPeriod`,
    );
  }
  const mark = entries.find((entry) => entry.habitId === habit.id && entry.date === date);
  if (mark !== undefined) {
    return mark.status;
  }
  if (date < habit.startDate || (habit.endDate !== null && date > habit.endDate)) {
    return 'not_due';
  }
  if (scheduledDates(habit.schedule, date, date, habit.timezone).length === 0) {
    return 'not_due';
  }
  return date < todayIn(habit.timezone) ? 'missed' : 'due';
}

/**
 * Progreso en el periodo que contiene a `date`.
 *
 * - Con `kind: 'quota'`: `done` cuenta marcas `done` dentro de los limites
 *   del periodo y `target` es la cuota del periodo.
 * - Con `kind: 'rrule'`: el mismo objeto, pero `target` es el numero de dias
 *   programados del periodo (recortado al rango activo del habito).
 * - `open` es si el periodo sigue en curso: contiene al hoy en la zona del
 *   habito. Un periodo ya cerrado (o futuro) no esta abierto.
 */
export function progressForPeriod(
  habit: HabitRecord,
  period: 'week' | 'month' | 'year',
  date: LocalDate,
  entries: HabitEntry[],
): PeriodProgress {
  const bounds = periodBounds(period, date, habit.weekStart, habit.timezone);
  const today = todayIn(habit.timezone);
  const open = bounds.start <= today && today <= bounds.end;
  if (habit.schedule.kind === 'quota') {
    const done = entries.filter(
      (entry) =>
        isDoneMark(habit.id, entry) && entry.date >= bounds.start && entry.date <= bounds.end,
    ).length;
    return { done, target: habit.schedule.count, open };
  }
  const from = maxDate(bounds.start, habit.startDate);
  const to = habit.endDate === null ? bounds.end : minDate(bounds.end, habit.endDate);
  if (from > to) {
    return { done: 0, target: 0, open };
  }
  const planned = new Set(scheduledDates(habit.schedule, from, to, habit.timezone));
  const done = entries.filter((entry) => isDoneMark(habit.id, entry) && planned.has(entry.date)).length;
  return { done, target: planned.size, open };
}

/**
 * Cumplidos sobre programados en la ventana `[from, to]`, entre 0 y 1.
 *
 * El divisor son solo los dias programados de la ventana, no los dias del
 * rango. Sin dias programados (ventana vacia, habito inactivo o cuota, que no
 * tiene dias) devuelve 0 en vez de NaN.
 */
export function completionRate(
  habit: HabitRecord,
  from: LocalDate,
  to: LocalDate,
  entries: HabitEntry[],
): number {
  if (from > to) {
    return 0;
  }
  const start = maxDate(from, habit.startDate);
  const end = habit.endDate === null ? to : minDate(to, habit.endDate);
  if (start > end) {
    return 0;
  }
  const planned = scheduledDates(habit.schedule, start, end, habit.timezone);
  if (planned.length === 0) {
    return 0;
  }
  const plannedDays = new Set(planned);
  const done = entries.filter(
    (entry) => isDoneMark(habit.id, entry) && plannedDays.has(entry.date),
  ).length;
  return done / planned.length;
}
