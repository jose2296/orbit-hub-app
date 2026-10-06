/**
 * Rachas: racha actual y racha mas larga.
 *
 * Las cuatro reglas, sin excepcion:
 *
 * 1. Hoy programado y sin marcar no rompe: el recorrido arranca en ayer.
 * 2. `skipped` es neutro: ni suma ni rompe, y un mes todo saltado da 0.
 * 3. Con `kind: 'rrule'` cuentan los dias PROGRAMADOS: un dia fuera de
 *    programa se salta sin tocar el contador, y al llegar antes de
 *    `startDate` el recorrido termina (lo anterior no es un fallo).
 * 4. Con `kind: 'quota'` cuentan los PERIODOS, no los dias: el periodo en
 *    curso solo suma si ya cumplio la cuota. Va por `periodBounds` mas
 *    `progressForPeriod`, con su `open` como el que decide; nunca por
 *    `statusForDate`, que lanza a proposito en cuota porque un habito de
 *    cuota no tiene estado por dia.
 *
 * `currentStreak` y `longestStreak` comparten el mismo recorrido
 * (`collectSlots`): la actual cuenta los aciertos seguidos desde el final
 * y la maxima el mejor tramo. Sobre una serie sin huecos dan lo mismo.
 */
import { periodBounds, scheduledDates } from './schedule';
import { progressForPeriod } from './progress';
import type { HabitEntry, HabitRecord, LocalDate } from './types';

const DAY_MS = 86_400_000;

const minDate = (a: LocalDate, b: LocalDate): LocalDate => (a <= b ? a : b);

/** Suma (o resta, con negativo) dias a un `LocalDate`. */
const addDays = (date: LocalDate, delta: number): LocalDate =>
  new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
    ) + delta * DAY_MS,
  )
    .toISOString()
    .slice(0, 10) as LocalDate;

/**
 * Marcas del habito por dia. Gana la primera si hay duplicadas, igual que
 * el `find` de `statusForDate`; las de otros habitos no entran.
 */
const marksByDate = (habit: HabitRecord, entries: HabitEntry[]): Map<LocalDate, HabitEntry> => {
  const byDate = new Map<LocalDate, HabitEntry>();
  for (const entry of entries) {
    if (entry.habitId === habit.id && !byDate.has(entry.date)) {
      byDate.set(entry.date, entry);
    }
  }
  return byDate;
};

/**
 * Tramo por dia con horario `rrule`, de mas viejo a mas nuevo. Cada dia
 * programado entre `startDate` y hoy (o `endDate`) aporta un tramo: `true`
 * si esta hecho, `false` si se paso sin marca. Lo neutro no aporta tramo:
 * ni `skipped` (regla 2), ni fuera de programa (regla 3), ni hoy sin
 * marcar (regla 1).
 */
const dailySlots = (
  habit: HabitRecord,
  entries: HabitEntry[],
  today: LocalDate,
): boolean[] => {
  const last = habit.endDate === null ? today : minDate(today, habit.endDate);
  if (last < habit.startDate) {
    return [];
  }
  const marks = marksByDate(habit, entries);
  const slots: boolean[] = [];
  for (const date of scheduledDates(habit.schedule, habit.startDate, last, habit.timezone)) {
    const mark = marks.get(date);
    if (mark !== undefined) {
      if (mark.status === 'done') {
        slots.push(true);
      }
      continue;
    }
    if (date === today) {
      continue;
    }
    slots.push(false);
  }
  return slots;
};

/**
 * Tramo por periodo con `kind: 'quota'`, de mas viejo a mas nuevo. Cada
 * periodo aporta un tramo si cumplio la cuota (`done >= target` segun
 * `progressForPeriod`) y un fallo si, ya cerrado, no la cumplio. El periodo
 * en curso sin cumplir no aporta tramo: todavia puede cumplirse (regla 4).
 */
const quotaSlots = (
  habit: HabitRecord,
  entries: HabitEntry[],
  today: LocalDate,
): boolean[] => {
  if (habit.schedule.kind !== 'quota') {
    throw new Error('quotaSlots solo vale para horarios de cuota');
  }
  const last = habit.endDate === null ? today : minDate(today, habit.endDate);
  if (last < habit.startDate) {
    return [];
  }
  const slots: boolean[] = [];
  let anchor = habit.startDate;
  while (anchor <= last) {
    const bounds = periodBounds(habit.schedule.period, anchor, habit.weekStart, habit.timezone);
    const progress = progressForPeriod(habit, habit.schedule.period, bounds.start, entries);
    const met = progress.done >= progress.target;
    const current = progress.open || (bounds.start <= today && today <= bounds.end);
    if (met || !current) {
      slots.push(met);
    }
    anchor = addDays(bounds.end, 1);
  }
  return slots;
};

/** El recorrido compartido: `true` es tramo cumplido, `false` tramo fallado. */
const collectSlots = (
  habit: HabitRecord,
  entries: HabitEntry[],
  today: LocalDate,
): boolean[] =>
  habit.schedule.kind === 'quota'
    ? quotaSlots(habit, entries, today)
    : dailySlots(habit, entries, today);

/**
 * Racha actual: tramos cumplidos seguidos hasta hoy, saltando lo neutro.
 * Hoy sin marcar no rompe (regla 1) y un `skipped` tampoco (regla 2).
 */
export function currentStreak(
  habit: HabitRecord,
  entries: HabitEntry[],
  today: LocalDate,
): number {
  const slots = collectSlots(habit, entries, today);
  let streak = 0;
  for (let i = slots.length - 1; i >= 0 && slots[i]; i -= 1) {
    streak += 1;
  }
  return streak;
}

/**
 * Racha mas larga hasta hoy: el mejor tramo del mismo recorrido, sin parar
 * en el primer fallo. Lo neutro tampoco la corta: solo un fallo la reinicia.
 */
export function longestStreak(
  habit: HabitRecord,
  entries: HabitEntry[],
  today: LocalDate,
): number {
  let best = 0;
  let run = 0;
  for (const slot of collectSlots(habit, entries, today)) {
    run = slot ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}
