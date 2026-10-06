import { z } from 'zod';

import { syncableEntitySchema } from './api.js';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Anchos de los campos de texto, como datos.
 *
 * Como en `workspace.ts`: el `.max()` de cada esquema de abajo tiene que decir
 * lo mismo que el `varchar` de la migracion, y exportarlo desde aqui lo
 * convierte en la fuente unica que la API y el test de limites pueden leer.
 */
export const HABIT_NAME_MAX = 120;
export const HABIT_DESCRIPTION_MAX = 1000;
export const HABIT_ENTRY_NOTE_MAX = 2000;

/**
 * Un dia de calendario en la zona del habito, siempre `YYYY-MM-DD`.
 *
 * El regex solo mira la forma y no basta: `2026-02-30` lo pasa y febrero no
 * tiene 30 dias. Por eso la segunda comprobacion construye la fecha en UTC y
 * compara los componentes, que es lo que rechaza el dia que no existe sin
 * tener que listar los meses a mano.
 */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'a date is YYYY-MM-DD')
  .refine(
    (value) => {
      const [year, month, day] = value.split('-').map(Number);
      const built = new Date(Date.UTC(year as number, (month as number) - 1, day as number));
      return (
        built.getUTCFullYear() === year &&
        built.getUTCMonth() === (month as number) - 1 &&
        built.getUTCDate() === day
      );
    },
    { message: 'that day is not on the calendar' },
  );
export type LocalDate = z.infer<typeof localDateSchema>;

/**
 * Cuantas veces se puede pedir por periodo, como datos.
 *
 * El tope es fisico y por eso va por periodo: una semana solo tiene 7 dias
 * distintos, un mes 31 y un ano bisiesto 366, y con la unicidad por
 * (habito, dia) no se puede marcar mas veces distintas de las que dias hay.
 *
 * `WEEK` es 31 y no 7 por el contrato: el brief lo pinnea con test (31 pasa,
 * 32 no), asi que aqui manda el test aunque el fisico daria 7. Generoso, no
 * fisico, y asi se dice.
 */
export const QUOTA_COUNT_MAX_WEEK = 31;
export const QUOTA_COUNT_MAX_MONTH = 31;
export const QUOTA_COUNT_MAX_YEAR = 366;

const QUOTA_COUNT_MAX = {
  week: QUOTA_COUNT_MAX_WEEK,
  month: QUOTA_COUNT_MAX_MONTH,
  year: QUOTA_COUNT_MAX_YEAR,
} as const;

/**
 * Como se repite un habito: dias fijados por una regla o cuota por periodo.
 *
 * Declarado otra vez aqui y no importado de `@orbit-hub/habit-core` a
 * proposito: `contracts` solo depende de `zod`, y traer el motor meteria
 * `rrule` y `luxon` en el grafo de produccion de la API por un tipo que no
 * usa. El test de contrato compara las dos declaraciones para que no se
 * separen.
 */
export const habitScheduleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rrule'),
    /** La regla en bruto, tal como va en el campo avanzado (`FREQ=DAILY`). */
    rule: z.string().trim().min(1).max(2000),
  }),
  z
    .object({
      kind: z.literal('quota'),
      /** Cuantas veces hay que marcar en el periodo, con tope fisico arriba. */
      count: z.int().min(1),
      period: z.enum(['week', 'month', 'year']),
    })
    .superRefine((value, ctx) => {
      if (value.count > QUOTA_COUNT_MAX[value.period]) {
        ctx.addIssue({
          code: 'custom',
          message: `a ${value.period} holds at most ${QUOTA_COUNT_MAX[value.period]}`,
          path: ['count'],
        });
      }
    }),
]);
export type HabitSchedule = z.infer<typeof habitScheduleSchema>;

/**
 * Un habito con su programacion y sus limites en dias locales.
 *
 * Entidad sincronizable como las demas: lleva `version` y borrado logico
 * porque se escribe sin conexion y viaja por el outbox. Es personal y cuelga
 * del usuario, no de un espacio, asi que no lleva `workspaceId`.
 */
export const habitSchema = syncableEntitySchema.extend({
  name: z.string().trim().min(1).max(HABIT_NAME_MAX),
  description: z.string().max(HABIT_DESCRIPTION_MAX).nullable().default(null),
  schedule: habitScheduleSchema,
  /** Zona IANA congelada al crear: el historico no se reinterpreta. */
  timezone: z.string().min(1).max(64),
  /**
   * Donde empieza la semana para las cuotas: 0 es lunes (ISO, el defecto) y
   * 1 es domingo. Va en el habito y no en el usuario porque dos habitos de la
   * misma persona pueden contar la semana distinto.
   */
  weekStart: z.union([z.literal(0), z.literal(1)]).default(0),
  /** Primer dia que cuenta, en dias locales y no en instantes. */
  startDate: localDateSchema,
  endDate: localDateSchema.nullable().default(null),
  /** La meta en vasos o lo que sea, y null cuando es binario. */
  targetValue: z.int().min(1).nullable().default(null),
  position: z.number().int().min(0).default(0),
  /** Archivado y no borrado: la historia se sigue pudiendo leer. */
  archivedAt: isoDateTimeSchema.nullable().default(null),
});
export type Habit = z.infer<typeof habitSchema>;

/** Lo que se puede registrar un dia: hecho o saltado, nunca fallado a mano. */
export const habitEntryStatusSchema = z.enum(['done', 'skipped']);
export type HabitEntryStatus = z.infer<typeof habitEntryStatusSchema>;

/**
 * Lo que la persona registro un dia.
 *
 * `date` es un dia local y nunca un instante: con un timestamp viajar a otra
 * zona cambiaria lo que fue "el lunes". La unicidad por (habito, dia) vive en
 * la tabla y es lo que hace que remarcar no acumule.
 */
export const habitEntrySchema = syncableEntitySchema.extend({
  habitId: uuidSchema,
  date: localDateSchema,
  status: habitEntryStatusSchema,
  /** Cuanto se hizo hacia la meta, y null cuando el habito es binario. */
  amount: z.int().min(0).nullable().default(null),
  note: z.string().max(HABIT_ENTRY_NOTE_MAX).nullable().default(null),
});
export type HabitEntry = z.infer<typeof habitEntrySchema>;

/**
 * Lo que la lista necesita por habito para pintar la fila sin pedir mas.
 *
 * El habito mas las entradas de la ventana visible: con eso el movil calcula
 * el estado de hoy y la racha con las mismas funciones del motor que usa el
 * servidor, y no hay dos fuentes de verdad para el mismo numero.
 */
export const habitSummarySchema = z.object({
  habit: habitSchema,
  entries: z.array(habitEntrySchema).default([]),
});
export type HabitSummary = z.infer<typeof habitSummarySchema>;

export const listHabitsResponseSchema = z.object({
  items: z.array(habitSummarySchema),
});
export type ListHabitsResponse = z.infer<typeof listHabitsResponseSchema>;

/**
 * La ventana de entradas, acotada por los dos extremos.
 *
 * Sin `from` ni `to` no hay consulta: una ventana abierta sobre un habito
 * diario es pedir miles de filas para pintar una semana.
 */
export const listHabitEntriesQuerySchema = z.object({
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListHabitEntriesQuery = z.infer<typeof listHabitEntriesQuerySchema>;

export const listHabitEntriesResponseSchema = z.object({
  items: z.array(habitEntrySchema),
});
export type ListHabitEntriesResponse = z.infer<typeof listHabitEntriesResponseSchema>;
