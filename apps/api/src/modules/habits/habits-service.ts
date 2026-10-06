import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type {
  Habit,
  HabitEntry,
  HabitEntryStatus,
  HabitSchedule,
  HabitSummary,
  LocalDate,
} from '@orbit-hub/contracts';

import { getDatabase } from '../../db/client.js';
import type { Database } from '../../db/client.js';
import type { HabitEntryRow, HabitRow } from '../../db/habit-schema.js';
import { habitEntries, habits } from '../../db/habit-schema.js';
import { HttpError } from '../../lib/http-error.js';

import { assertFechaValida, assertRango, assertScheduleUsable } from './habit-dates.js';

/** Lo que `POST /habits` acepta: todo el habito menos lo que pone el servidor. */
export interface CreateHabitInput {
  name: string;
  description: string | null;
  schedule: HabitSchedule;
  timezone: string;
  weekStart: 0 | 1;
  startDate: LocalDate;
  endDate: LocalDate | null;
  targetValue: number | null;
  position: number;
}

/**
 * Lo que `PATCH /habits/:habitId` acepta.
 *
 * Sin `timezone` a proposito: la zona se congela al crear y el historico no se
 * reinterpreta, asi que no hay parche que la cambie.
 */
export type UpdateHabitPatch = Partial<
  Pick<
    CreateHabitInput,
    'name' | 'description' | 'schedule' | 'weekStart' | 'startDate' | 'endDate' | 'targetValue' | 'position'
  >
>;

/** Lo que `POST /habits/:habitId/entries` acepta. */
export interface CheckInInput {
  date: LocalDate;
  status: HabitEntryStatus;
  amount: number | null;
  note: string | null;
}

/** Lo que `PATCH /habits/:habitId/entries/:date` acepta. */
export interface EntryPatch {
  status?: HabitEntryStatus;
  amount?: number | null;
  note?: string | null;
}

/**
 * Lo que `checkIn` devuelve: la entrada recien escrita y nada mas.
 *
 * Sin el resumen del periodo a proposito: el movil ya lo recalcula en local
 * con `progressForPeriod`, la misma funcion que usa el servidor, y devolverlo
 * crearia dos fuentes de verdad para el mismo numero.
 */
export interface WrittenEntry {
  habitId: string;
  date: LocalDate;
  status: HabitEntryStatus;
  amount: number | null;
  note: string | null;
  version: number;
}

function toHabit(row: HabitRow): Habit {
  return {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    name: row.name,
    description: row.description,
    schedule: row.schedule,
    timezone: row.timezone,
    weekStart: row.weekStart,
    startDate: row.startDate,
    endDate: row.endDate,
    targetValue: row.targetValue,
    position: row.position,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

function toEntry(row: HabitEntryRow): HabitEntry {
  return {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    habitId: row.habitId,
    date: row.date,
    status: row.status,
    amount: row.amount,
    note: row.note,
  };
}

function toWritten(row: HabitEntryRow): WrittenEntry {
  return {
    habitId: row.habitId,
    date: row.date,
    status: row.status,
    amount: row.amount,
    note: row.note,
    version: row.version,
  };
}

/**
 * Los habitos de una persona y sus marcas.
 *
 * Todo metodo lleva `userId` primero y no hay contexto ambiental, como en
 * `PeopleService`: la autorizacion es del servidor y el cliente no es una
 * frontera de seguridad. El habito de otra persona es 404 y no 403, porque
 * confirmar que existe ya dice que existe.
 */
export class HabitsService {
  private async db(): Promise<Database> {
    return (await getDatabase()).db;
  }

  /**
   * El habito vivo del que llama, o 404.
   *
   * Un 404 para "no existe", "es de otro" y "se borro": las tres respuestas
   * son la misma para no contar nada de lo que el que llama no tiene.
   */
  private async requireHabit(userId: string, habitId: string): Promise<HabitRow> {
    const db = await this.db();
    const [row] = await db
      .select()
      .from(habits)
      .where(and(eq(habits.id, habitId), eq(habits.userId, userId), isNull(habits.deletedAt)))
      .limit(1);
    if (!row) throw HttpError.notFound('Habit not found');
    return row;
  }

  /** La lista con su proyeccion de resumen: el habito mas sus entradas vivas. */
  async list(userId: string, includeArchived: boolean): Promise<HabitSummary[]> {
    const db = await this.db();
    const filas = await db
      .select()
      .from(habits)
      .where(and(eq(habits.userId, userId), isNull(habits.deletedAt)))
      .orderBy(asc(habits.position), asc(habits.createdAt));
    const visibles = includeArchived ? filas : filas.filter((row) => row.archivedAt === null);
    return Promise.all(
      visibles.map(async (row) => {
        const marcas = await db
          .select()
          .from(habitEntries)
          .where(and(eq(habitEntries.habitId, row.id), isNull(habitEntries.deletedAt)))
          .orderBy(asc(habitEntries.date));
        return { habit: toHabit(row), entries: marcas.map(toEntry) };
      }),
    );
  }

  async create(userId: string, input: CreateHabitInput): Promise<Habit> {
    assertRango(input.startDate, input.endDate);
    assertScheduleUsable(input.schedule, input.timezone);
    const db = await this.db();
    const [row] = await db
      .insert(habits)
      .values({
        userId,
        name: input.name,
        description: input.description,
        schedule: input.schedule,
        timezone: input.timezone,
        weekStart: input.weekStart,
        startDate: input.startDate,
        endDate: input.endDate,
        targetValue: input.targetValue,
        position: input.position,
      })
      .returning();
    if (!row) throw HttpError.internal('No se pudo crear el habito');
    return toHabit(row);
  }

  async update(userId: string, habitId: string, patch: UpdateHabitPatch): Promise<Habit> {
    const actual = await this.requireHabit(userId, habitId);
    const startDate = patch.startDate ?? actual.startDate;
    const endDate = patch.endDate ?? actual.endDate;
    assertRango(startDate, endDate);
    if (patch.schedule) assertScheduleUsable(patch.schedule, actual.timezone);
    const db = await this.db();
    const [row] = await db
      .update(habits)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.schedule !== undefined ? { schedule: patch.schedule } : {}),
        ...(patch.weekStart !== undefined ? { weekStart: patch.weekStart } : {}),
        ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
        ...(patch.endDate !== undefined ? { endDate: patch.endDate } : {}),
        ...(patch.targetValue !== undefined ? { targetValue: patch.targetValue } : {}),
        ...(patch.position !== undefined ? { position: patch.position } : {}),
        updatedAt: new Date(),
        version: sql<number>`${habits.version} + 1`,
      })
      .where(eq(habits.id, habitId))
      .returning();
    if (!row) throw HttpError.internal('No se pudo guardar el habito');
    return toHabit(row);
  }

  async setArchived(userId: string, habitId: string, archived: boolean): Promise<Habit> {
    await this.requireHabit(userId, habitId);
    const db = await this.db();
    const [row] = await db
      .update(habits)
      .set({
        archivedAt: archived ? new Date() : null,
        updatedAt: new Date(),
        version: sql<number>`${habits.version} + 1`,
      })
      .where(eq(habits.id, habitId))
      .returning();
    if (!row) throw HttpError.internal('No se pudo archivar el habito');
    return toHabit(row);
  }

  /** Borrado logico: la historia se sigue pudiendo leer, pero ya no se marca. */
  async remove(userId: string, habitId: string): Promise<void> {
    await this.requireHabit(userId, habitId);
    const db = await this.db();
    await db
      .update(habits)
      .set({ deletedAt: new Date(), updatedAt: new Date(), version: sql<number>`${habits.version} + 1` })
      .where(eq(habits.id, habitId));
  }

  /** Las entradas vivas de la ventana `[from, to]`, en orden de dia. */
  async entries(
    userId: string,
    habitId: string,
    from: LocalDate,
    to: LocalDate,
    limit = 200,
  ): Promise<HabitEntry[]> {
    await this.requireHabit(userId, habitId);
    if (from > to) throw HttpError.validation('El desde no puede ser posterior al hasta');
    const db = await this.db();
    const filas = await db
      .select()
      .from(habitEntries)
      .where(and(eq(habitEntries.habitId, habitId), isNull(habitEntries.deletedAt)))
      .orderBy(asc(habitEntries.date))
      .limit(limit);
    return filas.filter((row) => row.date >= from && row.date <= to).map(toEntry);
  }

  /**
   * Registra un dia.
   *
   * Remarcar no acumula: el UNIQUE (habito, dia) es la regla y el upsert la
   * aplica, asi que la segunda marca reescribe la primera en vez de sumar.
   */
  async checkIn(userId: string, habitId: string, input: CheckInInput): Promise<WrittenEntry> {
    const habit = await this.requireHabit(userId, habitId);
    assertFechaValida(habit, input.date);
    const db = await this.db();
    const [row] = await db
      .insert(habitEntries)
      .values({
        habitId,
        date: input.date,
        status: input.status,
        amount: input.amount,
        note: input.note,
      })
      .onConflictDoUpdate({
        target: [habitEntries.habitId, habitEntries.date],
        set: {
          status: input.status,
          amount: input.amount,
          note: input.note,
          updatedAt: new Date(),
          deletedAt: null,
          version: sql<number>`${habitEntries.version} + 1`,
        },
      })
      .returning();
    if (!row) throw HttpError.internal('No se pudo registrar el dia');
    return toWritten(row);
  }

  /** La entrada viva de ese dia, o 404: desmarcar y editar es reescribir. */
  private async requireEntry(userId: string, habitId: string, fecha: LocalDate): Promise<HabitEntryRow> {
    await this.requireHabit(userId, habitId);
    const db = await this.db();
    const [row] = await db
      .select()
      .from(habitEntries)
      .where(
        and(
          eq(habitEntries.habitId, habitId),
          eq(habitEntries.date, fecha),
          isNull(habitEntries.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw HttpError.notFound('Entry not found');
    return row;
  }

  async patchEntry(
    userId: string,
    habitId: string,
    fecha: LocalDate,
    patch: EntryPatch,
  ): Promise<WrittenEntry> {
    await this.requireEntry(userId, habitId, fecha);
    const db = await this.db();
    const [row] = await db
      .update(habitEntries)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        updatedAt: new Date(),
        version: sql<number>`${habitEntries.version} + 1`,
      })
      .where(and(eq(habitEntries.habitId, habitId), eq(habitEntries.date, fecha)))
      .returning();
    if (!row) throw HttpError.internal('No se pudo editar la entrada');
    return toWritten(row);
  }

  /** Desmarcar: borrado logico para que otros dispositivos se enteren. */
  async clearEntry(userId: string, habitId: string, fecha: LocalDate): Promise<void> {
    await this.requireEntry(userId, habitId, fecha);
    const db = await this.db();
    await db
      .update(habitEntries)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
        version: sql<number>`${habitEntries.version} + 1`,
      })
      .where(and(eq(habitEntries.habitId, habitId), eq(habitEntries.date, fecha)));
  }
}

export const habitsService = new HabitsService();
