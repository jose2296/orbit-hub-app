/**
 * Tests de `currentStreak` y `longestStreak` y sus cuatro reglas.
 *
 * El hoy de todos los tests es el jueves 2026-03-05 (fijado con relojes
 * falsos): asi la regla 1 (hoy pendiente no rompe) y `open` en cuota se
 * leen contra fechas escritas a mano, no contra el dia en que se corre.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { currentStreak, longestStreak } from './streak';
import type { HabitEntry, HabitRecord, LocalDate } from './types';

const TZ = 'Europe/Madrid';
// Jueves. En el habito de lunes y miercoles, hoy cae fuera de programa.
const TODAY: LocalDate = '2026-03-05';

const dailyHabit: HabitRecord = {
  id: 'h-daily',
  name: 'Meditar',
  schedule: { kind: 'rrule', rule: 'FREQ=DAILY' },
  timezone: TZ,
  weekStart: 0,
  startDate: '2026-02-01',
  endDate: null,
  targetValue: null,
};

// Lunes y miercoles: en la semana del 2026-03-02 son el 2 y el 4.
const weeklyHabit: HabitRecord = {
  id: 'h-lw',
  name: 'Leer',
  schedule: { kind: 'rrule', rule: 'FREQ=WEEKLY;BYDAY=MO,WE' },
  timezone: TZ,
  weekStart: 0,
  startDate: '2026-02-01',
  endDate: null,
  targetValue: null,
};

// Cuota de 2 por semana.
const quotaHabit: HabitRecord = {
  id: 'h-quota',
  name: 'Correr',
  schedule: { kind: 'quota', count: 2, period: 'week' },
  timezone: TZ,
  weekStart: 0,
  startDate: '2026-02-01',
  endDate: null,
  targetValue: null,
};

const entry = (
  habitId: string,
  date: LocalDate,
  status: 'done' | 'skipped' = 'done',
): HabitEntry => ({ habitId, date, status, amount: null });

/** Todos los dias entre `from` y `to`, ambos inclusive. */
const everyDay = (from: LocalDate, to: LocalDate): LocalDate[] => {
  const days: LocalDate[] = [];
  const start = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const end = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  );
  for (let at = start; at <= end; at += 86_400_000) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
};

beforeEach(() => {
  // Jueves 2026-03-05 12:00Z = 13:00 en Madrid: el hoy local es el 5.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-05T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

// Regla 1, y el fallo mas visible del producto entero.
it('hoy sin marcar NO rompe la racha', () => {
  // Ayer hecho, hoy programado y sin marcar: la racha sigue viva.
  expect(currentStreak(dailyHabit, [entry('h-daily', '2026-03-04')], TODAY)).toBe(1);
  // Y si hoy si se marco, hoy suma como un dia mas.
  expect(
    currentStreak(
      dailyHabit,
      [entry('h-daily', '2026-03-04'), entry('h-daily', '2026-03-05')],
      TODAY,
    ),
  ).toBe(2);
});

// Regla 2: neutro. Ni suma ni rompe.
it('skipped ni suma ni rompe', () => {
  const marks = [
    entry('h-daily', '2026-03-05'),
    entry('h-daily', '2026-03-04', 'skipped'),
    entry('h-daily', '2026-03-03'),
  ];
  expect(currentStreak(dailyHabit, marks, TODAY)).toBe(2);
});

it('saltar un mes entero da racha 0, no una racha infinita', () => {
  const allSkipped = everyDay('2026-02-01', TODAY).map((date) =>
    entry('h-daily', date, 'skipped'),
  );
  // Una marca de otro habito no pinta nada aqui.
  allSkipped.push(entry('otro', '2026-03-04'));
  expect(currentStreak(dailyHabit, allSkipped, TODAY)).toBe(0);
  expect(longestStreak(dailyHabit, allSkipped, TODAY)).toBe(0);
});

// Regla 3: cuenta dias PROGRAMADOS.
it('los dias no programados no rompen ni suman', () => {
  // Lunes 2 y miercoles 4 marcados; hoy jueves no es dia de lectura y no
  // hay marca: la racha vale 2, el fin de semana del medio no existe.
  const marks = [entry('h-lw', '2026-03-02'), entry('h-lw', '2026-03-04')];
  expect(currentStreak(weeklyHabit, marks, TODAY)).toBe(2);
});

it('un dia programado sin marcar corta la racha', () => {
  // Solo el lunes 2 marcado: el miercoles 4 (ayer, programado) se paso.
  expect(currentStreak(weeklyHabit, [entry('h-lw', '2026-03-02')], TODAY)).toBe(0);
});

// Regla 4: para cuota, cuenta PERIODOS.
it('una cuota cuenta periodos, no dias', () => {
  // Tres marcas en una semana que pide 2: la semana cuenta 1 periodo.
  const marks = [
    entry('h-quota', '2026-03-03'),
    entry('h-quota', '2026-03-04'),
    entry('h-quota', '2026-03-05'),
  ];
  expect(currentStreak(quotaHabit, marks, TODAY)).toBe(1);
  // La semana anterior tambien cumplio (2 marcas): 2 periodos.
  marks.push(entry('h-quota', '2026-02-24'), entry('h-quota', '2026-02-26'));
  expect(currentStreak(quotaHabit, marks, TODAY)).toBe(2);
});

it('la semana en curso solo cuenta si ya cumplio la cuota', () => {
  // Esta semana lleva 1 de 2: no cuenta, pero tampoco rompe; la anterior
  // cumplio y sostiene la racha en 1.
  const marks = [
    entry('h-quota', '2026-03-04'),
    entry('h-quota', '2026-02-24'),
    entry('h-quota', '2026-02-26'),
  ];
  expect(currentStreak(quotaHabit, marks, TODAY)).toBe(1);
});

// El limite de la vida del habito.
it('el recorrido termina en startDate', () => {
  // Habito creado hoy y marcado ayer: ayer esta antes de startDate, asi
  // que no cuenta y la racha es 0, no un fallo de nadie.
  const newborn: HabitRecord = { ...dailyHabit, startDate: TODAY };
  expect(currentStreak(newborn, [entry('h-daily', '2026-03-04')], TODAY)).toBe(0);
});

// longestStreak sobre una serie con un hueco.
it('longestStreak guarda el maximo, no el actual', () => {
  // 5 seguidos, hueco, 3 seguidos: la mejor es 5 y la actual es 3.
  const marks = [
    ...everyDay('2026-02-23', '2026-02-27'),
    ...everyDay('2026-03-02', '2026-03-04'),
  ].map((date) => entry('h-daily', date));
  expect(longestStreak(dailyHabit, marks, TODAY)).toBe(5);
  expect(currentStreak(dailyHabit, marks, TODAY)).toBe(3);
});

it('sin huecos, actual y maxima coinciden', () => {
  const marks = everyDay('2026-03-01', TODAY).map((date) => entry('h-daily', date));
  expect(currentStreak(dailyHabit, marks, TODAY)).toBe(5);
  expect(longestStreak(dailyHabit, marks, TODAY)).toBe(5);
});
