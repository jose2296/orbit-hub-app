/**
 * Tipos del dominio de habitos.
 *
 * Todo lo que cruza el motor de recurrencia usa {@link LocalDate}: un dia en la
 * zona del habito, nunca un instante. Los instantes (con hora y offset) solo
 * existen dentro de `schedule.ts`, donde se convierten a fecha local nada mas
 * leer cada ocurrencia de `rrule`.
 */

/** Como se repite un habito: dias fijados por una regla o cuota por periodo. */
export type HabitSchedule =
  | { kind: 'rrule'; rule: string }
  | { kind: 'quota'; count: number; period: 'week' | 'month' | 'year' };

/**
 * Un dia de calendario en la zona del habito, siempre `YYYY-MM-DD`.
 * No lleva hora ni offset: dos `LocalDate` iguales son el mismo dia.
 */
export type LocalDate = string;

/** Un habito con su programacion y sus limites en dias locales. */
export type HabitRecord = {
  id: string;
  name: string;
  schedule: HabitSchedule;
  timezone: string;
  weekStart: 0 | 1;
  startDate: LocalDate;
  endDate: LocalDate | null;
  targetValue: number | null;
};

/** Lo que la persona registro un dia: hecho, saltado y cantidad opcional. */
export type HabitEntry = {
  habitId: string;
  date: LocalDate;
  status: 'done' | 'skipped';
  amount: number | null;
};
