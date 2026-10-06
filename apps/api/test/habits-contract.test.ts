import {
  habitEntrySchema,
  habitScheduleSchema,
  habitSchema,
  habitSummarySchema,
  listHabitEntriesQuerySchema,
  listHabitEntriesResponseSchema,
  listHabitsResponseSchema,
  syncEntitySchema,
} from '@orbit-hub/contracts';
import type { HabitSchedule } from '@orbit-hub/contracts';
// Solo el tipo: contracts no depende de habit-core (arrastraria rrule y luxon
// a la API) y este import se borra al compilar, asi que no trae nada.
import type { HabitSchedule as CoreHabitSchedule } from '../../../packages/habit-core/src/types.js';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const horarioCuota = { kind: 'quota', count: 2, period: 'week' } as const;

function habitoValido() {
  return {
    id: randomUUID(),
    version: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    name: 'Ir al gim',
    description: null,
    schedule: { kind: 'rrule', rule: 'FREQ=WEEKLY;BYDAY=MO,WE' },
    timezone: 'Europe/Madrid',
    weekStart: 0,
    startDate: '2026-03-01',
    endDate: null,
    targetValue: null,
    position: 0,
    archivedAt: null,
  };
}

function entradaValida() {
  return {
    id: randomUUID(),
    version: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    habitId: randomUUID(),
    date: '2026-03-04',
    status: 'done',
    amount: null,
    note: null,
  };
}

describe('habitScheduleSchema', () => {
  it('acepta un horario de rrule', () => {
    expect(habitScheduleSchema.safeParse({ kind: 'rrule', rule: 'FREQ=DAILY' }).success).toBe(true);
  });

  it('rechaza una regla que no es string', () => {
    expect(habitScheduleSchema.safeParse({ kind: 'rrule', rule: 7 }).success).toBe(false);
  });

  it('rechaza una cuota de 0', () => {
    expect(
      habitScheduleSchema.safeParse({ kind: 'quota', count: 0, period: 'week' }).success,
    ).toBe(false);
  });

  it('rechaza una cuota semanal de mas de 31', () => {
    expect(
      habitScheduleSchema.safeParse({ kind: 'quota', count: 32, period: 'week' }).success,
    ).toBe(false);
  });

  it('acepta 31 por semana, que es el tope', () => {
    expect(
      habitScheduleSchema.safeParse({ kind: 'quota', count: 31, period: 'week' }).success,
    ).toBe(true);
  });

  // Las dos declaraciones del horario no se pueden separar: contracts la
  // repite en vez de importar habit-core para no meter rrule ni luxon en la
  // API, asi que este test es la correa. Si el motor cambia la union, una de
  // las dos asignaciones deja de compilar.
  it('describe el mismo horario que el motor', () => {
    const desdeContrato: CoreHabitSchedule = habitScheduleSchema.parse({
      kind: 'rrule',
      rule: 'FREQ=DAILY',
    });
    const haciaContrato: HabitSchedule = { ...horarioCuota } satisfies CoreHabitSchedule;
    expect(desdeContrato).toEqual({ kind: 'rrule', rule: 'FREQ=DAILY' });
    expect(haciaContrato.kind).toBe('quota');
  });
});

describe('habitEntrySchema', () => {
  it('date es YYYY-MM-DD y no un instante', () => {
    expect(
      habitEntrySchema.safeParse({ ...entradaValida(), date: '2026-03-04T10:00:00Z' }).success,
    ).toBe(false);
  });

  it('acepta una fecha valida', () => {
    expect(habitEntrySchema.safeParse(entradaValida()).success).toBe(true);
  });

  it('rechaza un dia que no existe en el calendario', () => {
    expect(habitEntrySchema.safeParse({ ...entradaValida(), date: '2026-02-30' }).success).toBe(
      false,
    );
  });

  it('status solo es done o skipped', () => {
    expect(habitEntrySchema.safeParse({ ...entradaValida(), status: 'missed' }).success).toBe(
      false,
    );
  });
});

describe('habitSchema', () => {
  it('acepta un habito completo', () => {
    expect(habitSchema.safeParse(habitoValido()).success).toBe(true);
  });

  it('los opcionales llegan solos con su defecto', () => {
    const parsed = habitSchema.safeParse({
      ...habitoValido(),
      description: undefined,
      endDate: undefined,
      targetValue: undefined,
      archivedAt: undefined,
    });
    expect(parsed.success).toBe(true);
  });

  it('el nombre vacio no es un habito', () => {
    expect(habitSchema.safeParse({ ...habitoValido(), name: '  ' }).success).toBe(false);
  });
});

describe('respuestas y consultas', () => {
  it('el resumen lleva el habito y sus entradas', () => {
    const parsed = habitSummarySchema.safeParse({ habit: habitoValido(), entries: [] });
    expect(parsed.success).toBe(true);
  });

  it('la lista es un array de resumenes', () => {
    const parsed = listHabitsResponseSchema.safeParse({
      items: [{ habit: habitoValido(), entries: [entradaValida()] }],
    });
    expect(parsed.success).toBe(true);
  });

  it('las entradas se piden por ventana', () => {
    const parsed = listHabitEntriesQuerySchema.safeParse({ from: '2026-03-01', to: '2026-03-31' });
    expect(parsed.success).toBe(true);
  });

  it('la ventana tambien rechaza instantes', () => {
    expect(
      listHabitEntriesQuerySchema.safeParse({ from: '2026-03-01T00:00:00Z' }).success,
    ).toBe(false);
  });

  it('la respuesta de entradas es un array', () => {
    expect(listHabitEntriesResponseSchema.safeParse({ items: [] }).success).toBe(true);
  });
});

describe('sync', () => {
  it('habit y habit_entry son entidades sincronizables', () => {
    expect(syncEntitySchema.safeParse('habit').success).toBe(true);
    expect(syncEntitySchema.safeParse('habit_entry').success).toBe(true);
  });
});
