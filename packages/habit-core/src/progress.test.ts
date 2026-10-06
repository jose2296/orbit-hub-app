/**
 * Tests de `statusForDate`, `progressForPeriod` y `completionRate`.
 *
 * El hoy de todos los tests es el jueves 2026-03-05 (fijado con relojes
 * falsos): asi `due` contra `missed` y `open` contra cerrado son fechas
 * escritas a mano, no calculos contra el dia en que se corre el test.
 */
import { afterEach, beforeEach, vi } from 'vitest';

import { completionRate, progressForPeriod, statusForDate } from './progress';
import type { HabitEntry, HabitRecord, LocalDate } from './types';

const TZ = 'Europe/Madrid';

// Lunes y miercoles: en la semana del 2026-03-02 son el 2 y el 4.
const rruleHabit: HabitRecord = {
  id: 'h-lx',
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
  status: 'done' | 'skipped',
): HabitEntry => ({ habitId, date, status, amount: null });

beforeEach(() => {
  // Jueves 2026-03-05 12:00Z = 13:00 en Madrid: el hoy local es el 5.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-05T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

// Los cinco estados, y solo son cinco.
it('un dia programado sin marcar es due, uno fuera de programa es not_due', () => {
  // Lunes 9, futuro y programado, sin marca: toca hacerlo.
  expect(statusForDate(rruleHabit, '2026-03-09', [])).toBe('due');
  // Viernes 6, no programado: no toca, aunque tampoco hay marca.
  expect(statusForDate(rruleHabit, '2026-03-06', [])).toBe('not_due');
});

it('un dia pasado sin marcar es missed', () => {
  // Miercoles 4 (ayer), programado y sin marca: se paso.
  expect(statusForDate(rruleHabit, '2026-03-04', [])).toBe('missed');
});

it('skipped es su propio estado, ni done ni missed', () => {
  const marks = [entry('h-lx', '2026-03-04', 'skipped'), entry('h-lx', '2026-03-02', 'done')];
  expect(statusForDate(rruleHabit, '2026-03-04', marks)).toBe('skipped');
  expect(statusForDate(rruleHabit, '2026-03-02', marks)).toBe('done');
});

// Aqui esta la mitad del contrato: una cuota NO tiene estado por dia.
it('una cuota no tiene estado por dia', () => {
  expect(() => statusForDate(quotaHabit, '2026-03-04', [])).toThrow(/cuota/);
});

// '3 de 5': la semana del 2026-03-04 va del lunes 2 al domingo 8.
it('la cuota cuenta las marcas del periodo', () => {
  const marks = [
    entry('h-quota', '2026-03-03', 'done'),
    entry('h-quota', '2026-03-04', 'done'),
    entry('h-quota', '2026-03-10', 'done'), // otra semana: no cuenta
    entry('h-quota', '2026-03-05', 'skipped'), // saltado no es hecho
    entry('otro', '2026-03-03', 'done'), // otro habito: no cuenta
  ];
  expect(progressForPeriod(quotaHabit, 'week', '2026-03-04', marks)).toEqual({
    done: 2,
    target: 2,
    open: true,
  });
});

it('un periodo ya cerrado deja de estar abierto', () => {
  expect(progressForPeriod(quotaHabit, 'month', '2026-04-01', []).open).toBe(false);
});

it('el progreso rrule pone de objetivo los dias programados', () => {
  // Semana 2-8 de marzo: programados lunes 2 y miercoles 4. La marca del
  // jueves 5 cae fuera de programa y no suma al progreso del programa.
  const marks = [
    entry('h-lx', '2026-03-02', 'done'),
    entry('h-lx', '2026-03-05', 'done'),
  ];
  expect(progressForPeriod(rruleHabit, 'week', '2026-03-04', marks)).toEqual({
    done: 1,
    target: 2,
    open: true,
  });
});

// Un habito rrule completo en la ventana.
it('completionRate es cumplidos sobre programados, no sobre dias del rango', () => {
  // Del 2 al 15 de marzo hay 14 dias pero solo 4 programados (lun 2, mie 4,
  // lun 9, mie 11). Con 3 marcados devuelve 0.75, no 3/14.
  const marks = [
    entry('h-lx', '2026-03-02', 'done'),
    entry('h-lx', '2026-03-04', 'done'),
    entry('h-lx', '2026-03-09', 'done'),
  ];
  expect(completionRate(rruleHabit, '2026-03-02', '2026-03-15', marks)).toBe(0.75);
});

it('completionRate es 0 cuando no hay nada programado, no NaN', () => {
  // Jueves 5 y viernes 6: ningun dia programado en la ventana.
  expect(completionRate(rruleHabit, '2026-03-05', '2026-03-06', [])).toBe(0);
  // Una cuota no tiene dias programados nunca.
  expect(completionRate(quotaHabit, '2026-03-02', '2026-03-15', [])).toBe(0);
});
