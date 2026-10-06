import { relations } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import type { HabitSchedule } from '@orbit-hub/contracts';

import { users } from './auth-schema';

/**
 * Un habito personal: que se repite, en que zona y desde que dia cuenta.
 *
 * Cuelga del usuario y no de un espacio, porque es personal y no se comparte
 * como un nodo. Entidad sincronizable como las demas: lleva `version` y
 * borrado logico porque se escribe sin conexion y viaja por el outbox.
 *
 * `schedule` guarda el horario del contrato (`rrule` o `quota`) tal cual, sin
 * dos columnas segun la clase: la forma la valida el contrato antes de llegar
 * aqui, y esta columna solo la guarda.
 *
 * `startDate` y `endDate` son dias locales (`date`) y nunca instantes: con un
 * timestamp, viajar a otra zona cambiaria lo que fue "el lunes".
 *
 * `weekStart` sigue al contrato: 0 es lunes (ISO, el defecto) y 1 es domingo.
 * Va en el habito y no en el usuario porque dos habitos de la misma persona
 * pueden contar la semana distinto.
 */
export const habits = pgTable(
  'habits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    description: varchar('description', { length: 1000 }),
    schedule: jsonb('schedule').$type<HabitSchedule>().notNull(),
    /** Zona IANA congelada al crear: el historico no se reinterpreta. */
    timezone: varchar('timezone', { length: 64 }).notNull(),
    weekStart: smallint('week_start').$type<0 | 1>().notNull().default(0),
    /** Primer dia que cuenta, en dias locales y no en instantes. */
    startDate: date('start_date').notNull(),
    /** Ultimo dia que cuenta, o null si sigue abierto. */
    endDate: date('end_date'),
    /** La meta en vasos o lo que sea, y null cuando es binario. */
    targetValue: integer('target_value'),
    position: integer('position').notNull().default(0),
    /** Archivado y no borrado: la historia se sigue pudiendo leer. */
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    /** Token de concurrencia optimista, contra el baseVersion del cliente. */
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /** Lapida. Los borrados nunca son duros, para que otros dispositivos se enteren. */
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('habits_user_idx').on(table.userId),
    index('habits_user_updated_at_idx').on(table.userId, table.updatedAt),
  ],
);

/**
 * Lo que la persona registro un dia.
 *
 * El indice unico en `(habit_id, date)` **es** la regla de "un dia cuenta una
 * sola vez": remarcar no acumula, y el pull por `habit_id` es lo que lee la
 * ventana visible de cada habito.
 */
export const habitEntries = pgTable(
  'habit_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    habitId: uuid('habit_id')
      .notNull()
      .references(() => habits.id, { onDelete: 'cascade' }),
    /** Dia local `YYYY-MM-DD`, nunca un instante. */
    date: date('date').notNull(),
    /** Hecho o saltado, nunca fallado a mano: el fallo lo calcula el motor. */
    status: varchar('status', { length: 16 }).$type<'done' | 'skipped'>().notNull(),
    /** Cuanto se hizo hacia la meta, y null cuando el habito es binario. */
    amount: integer('amount'),
    note: varchar('note', { length: 2000 }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('habit_entries_habit_date_unique').on(table.habitId, table.date),
    index('habit_entries_habit_idx').on(table.habitId),
  ],
);

export const habitsRelations = relations(habits, ({ one, many }) => ({
  user: one(users, { fields: [habits.userId], references: [users.id] }),
  entries: many(habitEntries),
}));

export const habitEntriesRelations = relations(habitEntries, ({ one }) => ({
  habit: one(habits, { fields: [habitEntries.habitId], references: [habits.id] }),
}));

export type HabitRow = typeof habits.$inferSelect;
export type NewHabitRow = typeof habits.$inferInsert;
export type HabitEntryRow = typeof habitEntries.$inferSelect;
export type NewHabitEntryRow = typeof habitEntries.$inferInsert;
