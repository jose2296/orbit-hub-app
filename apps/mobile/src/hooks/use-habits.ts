import * as Crypto from "expo-crypto";
import type {
  Habit,
  HabitEntry,
  HabitEntryStatus,
  HabitSchedule,
  HabitSummary,
  LocalDate,
} from "@orbit-hub/contracts";
import { habitScheduleSchema, localDateSchema } from "@orbit-hub/contracts";
import {
  describeSchedule,
  periodBounds,
  scheduledDates,
  todayIn,
} from "@orbit-hub/habit-core";
import type { HabitRecord, ScheduleDescription } from "@orbit-hub/habit-core";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getLocalStoreReady,
  subscribeToLocalStore,
} from "@/lib/offline/local-store";
import type { CachedEntity, LocalStore } from "@/lib/offline/local-store";
import { enqueueOperation } from "@/lib/offline/sync-service";

/**
 * Los habitos en el movil, leidos de la cache y nunca de la red.
 *
 * El mismo reparto que `use-notes.ts`: la pantalla lee de aqui y escribe con
 * las funciones de abajo, que guardan en local primero y encolan despues. La
 * diferencia esta en la puerta: una nota acepta cualquier texto, pero una
 * marca acepta solo dias que tocan. Esa validacion va aqui, antes de encolar,
 * con `scheduledDates` de `habit-core` — la misma funcion que usa la API —,
 * porque una marca imposible encolada es un rechazo al sincronizar, y eso es
 * enterarse tarde.
 *
 * El progreso optimista tambien sale del mismo motor (`progressForPeriod`):
 * si el movil calculara con otra funcion, el movil y el servidor mostrarian
 * numeros distintos y no habria forma de saber cual tiene razon.
 */

/** Lo que `checkIn` devuelve: la entrada recien escrita y nada mas. */
export interface WrittenEntry {
  habitId: string;
  date: LocalDate;
  status: HabitEntryStatus;
  amount: number | null;
  note: string | null;
  version: number;
}

export type MarkResult = { ok: true; entry: WrittenEntry } | { ok: false };

export interface CheckInInput {
  amount?: number | null;
  note?: string | null;
}

export function readHabitFromRow(row: CachedEntity): Habit {
  const server = JSON.parse(row.payload) as Record<string, unknown>;
  const pending = row.pending
    ? (JSON.parse(row.pending) as Record<string, unknown>)
    : null;

  // El pendiente gana, como en las notas: se muestra lo recien escrito y no
  // lo ultimo que llego a la red.
  return {
    ...server,
    id: row.entityId,
    version: row.version,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    ...pending,
  } as Habit;
}

export function readEntryFromRow(row: CachedEntity): HabitEntry {
  const server = JSON.parse(row.payload) as Record<string, unknown>;
  const pending = row.pending
    ? (JSON.parse(row.pending) as Record<string, unknown>)
    : null;

  return {
    ...server,
    id: row.entityId,
    version: row.version,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    ...pending,
  } as HabitEntry;
}

/** El contrato que `habit-core` necesita, sacado del habito guardado. */
export function toHabitRecord(habit: Habit): HabitRecord {
  return {
    id: habit.id,
    name: habit.name,
    schedule: habit.schedule,
    timezone: habit.timezone,
    weekStart: habit.weekStart,
    startDate: habit.startDate,
    endDate: habit.endDate,
    targetValue: habit.targetValue,
  };
}

function diaMas(fecha: LocalDate, dias: number): LocalDate {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const base = new Date(Date.UTC(anio as number, (mes as number) - 1, dia as number));
  base.setUTCDate(base.getUTCDate() + dias);
  const mesTexto = String(base.getUTCMonth() + 1).padStart(2, "0");
  const diaTexto = String(base.getUTCDate()).padStart(2, "0");
  return `${base.getUTCFullYear()}-${mesTexto}-${diaTexto}`;
}

/**
 * Si ese dia se puede marcar, con las mismas reglas que la API.
 *
 * Espeja `assertFechaValida` del servidor a proposito: todo lo que aqui pasa
 * lo acepta el push, y todo lo que aqui no pasa vuelve como `{ ok: false }`
 * sin tocar el outbox. Futuro, fuera de rango, fuera del periodo en curso
 * (cuota) o fuera de programa (rrule): no hay dia imposible encolado.
 */
export function isMarkableDay(habit: Habit, date: LocalDate, today?: LocalDate): boolean {
  const hoy = today ?? todayIn(habit.timezone);
  if (date > hoy) return false;
  if (date < habit.startDate) return false;
  if (habit.endDate !== null && date > habit.endDate) return false;
  if (habit.schedule.kind === "quota") {
    // En una cuota cualquier dia del periodo en curso vale: no hay dias
    // fijados, solo un contador por periodo.
    const periodo = periodBounds(habit.schedule.period, hoy, habit.weekStart, habit.timezone);
    return date >= periodo.start && date <= periodo.end;
  }
  return scheduledDates(habit.schedule, date, date, habit.timezone).length > 0;
}

/**
 * El proximo dia programado despues de `from`, con la misma funcion que
 * decide si un dia vale. Sin ella el `{ ok: false }` seria un muro; con ella
 * la pantalla puede citar: "el lunes te toca" (`habits.error.notScheduled`).
 * Una cuota no tiene dias: devuelve null.
 */
export function nextScheduledDate(habit: Habit, from: LocalDate): LocalDate | null {
  if (habit.schedule.kind !== "rrule") return null;
  const desde = diaMas(from, 1);
  const encontrados = scheduledDates(habit.schedule, desde, diaMas(desde, 365), habit.timezone);
  return encontrados[0] ?? null;
}

function parsePayload(row: CachedEntity): Record<string, unknown> {
  try {
    return JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function findEntryRow(
  store: LocalStore,
  habitId: string,
  date: LocalDate,
): Promise<CachedEntity | null> {
  // Con lapidas incluidas a proposito: `listCachedEntries` filtra borrados,
  // y sin esto remarcar tras desmarcar no encuentra la fila y crea otra con
  // otro id — un dia = una fila, como el UNIQUE del servidor. La lectura
  // caliente (`loadHabitSummaries`, `loadHabitDetail`) sigue usando
  // `listCachedEntries`; esto solo corre en acciones de escritura.
  const rows = await store.listCached("habit_entry", { includeDeleted: true });
  return (
    rows.find((row) => {
      const carga = parsePayload(row);
      return carga.habitId === habitId && carga.date === date;
    }) ?? null
  );
}

function toWritten(
  habitId: string,
  date: LocalDate,
  values: { status: HabitEntryStatus; amount: number | null; note: string | null },
  version: number,
): WrittenEntry {
  return {
    habitId,
    date,
    status: values.status,
    amount: values.amount,
    note: values.note,
    version,
  };
}

/**
 * Escribe la marca en cache y la encola. `create` si el dia es nuevo,
 * `update` si ya habia fila (viva o lapida: revivir es reescribir, y asi
 * desmarcar y remarcar no acumula). La unicidad por (habito, dia) la da
 * buscar antes de escribir, como el UNIQUE del servidor.
 */
async function writeEntry(
  habitId: string,
  date: LocalDate,
  values: { status: HabitEntryStatus; amount: number | null; note: string | null },
): Promise<MarkResult> {
  const store = await getLocalStoreReady();
  const existing = await findEntryRow(store, habitId, date);
  const now = new Date().toISOString();

  if (!existing) {
    const entityId = Crypto.randomUUID();
    const payload = { id: entityId, habitId, date, ...values };
    await store.upsertCached([
      {
        entity: "habit_entry",
        entityId,
        version: 0,
        updatedAt: now,
        deletedAt: null,
        payload: JSON.stringify(payload),
        pending: JSON.stringify(values),
      },
    ]);
    await enqueueOperation({
      kind: "create",
      entity: "habit_entry",
      entityId,
      baseVersion: 0,
      payload,
    });
    return { ok: true, entry: toWritten(habitId, date, values, 0) };
  }

  const base = parsePayload(existing);
  await store.upsertCached([
    {
      entity: "habit_entry",
      entityId: existing.entityId,
      version: existing.version,
      updatedAt: now,
      // Una lapida revive al remarcar: el borrado sigue en el outbox y el
      // servidor converge al aplicar el update despues del delete.
      deletedAt: null,
      payload: JSON.stringify({ ...base, ...values, deletedAt: null }),
      pending: JSON.stringify(values),
    },
  ]);
  await enqueueOperation({
    kind: "update",
    entity: "habit_entry",
    entityId: existing.entityId,
    baseVersion: existing.version,
    payload: values,
    base,
  });
  return { ok: true, entry: toWritten(habitId, date, values, existing.version) };
}

async function requireMarkableHabit(habitId: string, date: LocalDate): Promise<Habit | null> {
  const store = await getLocalStoreReady();
  const row = await store.getCached("habit", habitId);
  if (!row || row.deletedAt) return null;
  const habit = readHabitFromRow(row);
  if (!isMarkableDay(habit, date)) return null;
  return habit;
}

/**
 * Marca un dia como hecho. Dia que no toca => `{ ok: false }` y el outbox
 * sigue vacio: la disciplina funciona sin conexion o no funciona.
 */
export async function checkInHabit(
  habitId: string,
  date: LocalDate,
  input: CheckInInput = {},
): Promise<MarkResult> {
  const habit = await requireMarkableHabit(habitId, date);
  if (!habit) return { ok: false };
  // Como en el servidor: lo no dicho se borra, no se conserva. Marcar sin
  // cantidad quita la anterior en vez de dejarla colgando de otro dia.
  return writeEntry(habitId, date, {
    status: "done",
    amount: input.amount ?? null,
    note: input.note ?? null,
  });
}

/** Salta un dia programado. La puerta es la misma que al marcar. */
export async function skipHabit(habitId: string, date: LocalDate): Promise<MarkResult> {
  const habit = await requireMarkableHabit(habitId, date);
  if (!habit) return { ok: false };
  return writeEntry(habitId, date, { status: "skipped", amount: null, note: null });
}

/**
 * Desmarca un dia: lapida en local para que otros dispositivos se enteren.
 * Desmarcar no pide dia valido: quitar nunca es imposible.
 */
export async function clearHabitEntry(habitId: string, date: LocalDate): Promise<boolean> {
  const store = await getLocalStoreReady();
  const existing = await findEntryRow(store, habitId, date);
  if (!existing || existing.deletedAt) return false;
  const now = new Date().toISOString();
  await store.upsertCached([
    {
      entity: "habit_entry",
      entityId: existing.entityId,
      version: existing.version,
      updatedAt: now,
      deletedAt: now,
      payload: existing.payload,
      pending: null,
    },
  ]);
  await enqueueOperation({
    kind: "delete",
    entity: "habit_entry",
    entityId: existing.entityId,
    baseVersion: existing.version,
  });
  return true;
}

/**
 * Corrige la cantidad de una marca que ya existe. Sin marca no hay nada que
 * corregir: la cantidad entra con `checkInHabit` al marcar.
 */
export async function setEntryAmount(
  habitId: string,
  date: LocalDate,
  amount: number | null,
): Promise<MarkResult> {
  const store = await getLocalStoreReady();
  const existing = await findEntryRow(store, habitId, date);
  if (!existing || existing.deletedAt) return { ok: false };
  const base = parsePayload(existing);
  const status = (base.status === "done" ? "done" : "skipped") as HabitEntryStatus;
  const values = {
    status,
    amount,
    note: (base.note as string | null) ?? null,
  };
  const now = new Date().toISOString();
  await store.upsertCached([
    {
      entity: "habit_entry",
      entityId: existing.entityId,
      version: existing.version,
      updatedAt: now,
      deletedAt: null,
      payload: JSON.stringify({ ...base, ...values }),
      pending: JSON.stringify({ amount }),
    },
  ]);
  await enqueueOperation({
    kind: "update",
    entity: "habit_entry",
    entityId: existing.entityId,
    baseVersion: existing.version,
    payload: { amount },
    base,
  });
  return { ok: true, entry: toWritten(habitId, date, values, existing.version) };
}

/**
 * El UNTIL de una regla como dia local, o null si no hay o no vale.
 *
 * Solo lee los ocho primeros digitos (`YYYYMMDD`, con o sin hora detras):
 * la hora no pinta nada porque el habito cuenta dias, y un UNTIL que no
 * trae dia no es adoptable ni normalizable.
 */
export function extractUntilDate(rule: string): LocalDate | null {
  const match = rule.match(/UNTIL=([0-9A-Za-z]+)/);
  const digits = (match?.[1] ?? "").slice(0, 8);
  if (!/^\d{8}$/.test(digits)) return null;
  const text = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return localDateSchema.safeParse(text).success ? (text as LocalDate) : null;
}

/**
 * endDate es la unica fuente de verdad para el fin.
 *
 * Al guardar, una regla que trae UNTIL se reescribe con el endDate vigente
 * (o se le quita si no hay): dos sitios para el mismo dato son una
 * sorpresa, y el campo manda. Una regla sin UNTIL se deja tal cual aunque
 * haya endDate: el fin ya vive en el campo y la regla limpia no se ensucia.
 *
 * El UNTIL se escribe como fin de dia en UTC (`T235959Z`): el motor lee las
 * ocurrencias como hora de pared en la zona, asi que ese instante incluye
 * todo el ultimo dia local y nada del siguiente.
 */
export function normalizeRuleUntil(rule: string, endDate: LocalDate | null): string {
  const parts = rule.split(";").filter((part) => !part.startsWith("UNTIL="));
  if (parts.length === rule.split(";").length) return rule;
  if (endDate === null) return parts.join(";");
  return [...parts, `UNTIL=${endDate.replaceAll("-", "")}T235959Z`].join(";");
}

/**
 * Si ese horario se puede guardar, con la misma puerta que el servidor
 * (`assertScheduleUsable`): la regla se prueba contra un dia y la cuota
 * contra el contrato. Lo que aqui no pasa no se encola.
 */
export function scheduleUsable(schedule: HabitSchedule, timezone: string): boolean {
  if (schedule.kind === "quota") {
    // El tope fisico vive en el contrato (31 por semana, 366 por ano): un
    // numero mayor lo rechaza el push y aqui no sale del telefono.
    return habitScheduleSchema.safeParse(schedule).success;
  }
  try {
    const today = todayIn(timezone);
    scheduledDates(schedule, today, today, timezone);
    return true;
  } catch {
    return false;
  }
}

function habitRangeUsable(startDate: LocalDate, endDate: LocalDate | null): boolean {
  return endDate === null || endDate >= startDate;
}

export interface CreateHabitInput {
  name: string;
  schedule: HabitSchedule;
  timezone: string;
  startDate: LocalDate;
  endDate: LocalDate | null;
  targetValue: number | null;
}

export type CreateHabitResult = { ok: true; habitId: string } | { ok: false };

/**
 * Crea el habito en local y lo encola, como `createNoteAction`: primero la
 * fila en cache y despues la operacion, sin esperar a la red. Es un `create`
 * de `habit` y no un `update` sin fila, que el push rechaza.
 */
export async function createHabit(input: CreateHabitInput): Promise<CreateHabitResult> {
  if (input.name.trim().length === 0) return { ok: false };
  if (!habitRangeUsable(input.startDate, input.endDate)) return { ok: false };
  if (!scheduleUsable(input.schedule, input.timezone)) return { ok: false };
  const schedule =
    input.schedule.kind === "rrule"
      ? { ...input.schedule, rule: normalizeRuleUntil(input.schedule.rule, input.endDate) }
      : input.schedule;
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  const habit: Habit = {
    id,
    version: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    name: input.name.trim(),
    description: null,
    schedule,
    timezone: input.timezone,
    weekStart: 0,
    startDate: input.startDate,
    endDate: input.endDate,
    targetValue: input.targetValue,
    position: 0,
    archivedAt: null,
  };
  const store = await getLocalStoreReady();
  await store.upsertCached([
    {
      entity: "habit",
      entityId: id,
      version: 0,
      updatedAt: now,
      deletedAt: null,
      payload: JSON.stringify(habit),
      pending: JSON.stringify(habit),
    },
  ]);
  await enqueueOperation({
    kind: "create",
    entity: "habit",
    entityId: id,
    baseVersion: 0,
    payload: {
      name: habit.name,
      description: habit.description,
      schedule: habit.schedule,
      timezone: habit.timezone,
      weekStart: habit.weekStart,
      startDate: habit.startDate,
      endDate: habit.endDate,
      targetValue: habit.targetValue,
      position: habit.position,
    },
  });
  return { ok: true, habitId: id };
}

export interface HabitChanges {
  name?: string;
  description?: string | null;
  schedule?: HabitSchedule;
  weekStart?: 0 | 1;
  startDate?: LocalDate;
  endDate?: LocalDate | null;
  targetValue?: number | null;
  position?: number;
}

export type UpdateHabitResult = { ok: true } | { ok: false };

/**
 * Cambia un habito con la misma disciplina que al crearlo: lo fundido se
 * valida y el UNTIL se renormaliza con el fin vigente, porque un fin
 * cambiado con una regla intacta dejaria el UNTIL viejo mandando.
 */
export async function updateHabit(
  habitId: string,
  changes: HabitChanges,
): Promise<UpdateHabitResult> {
  const store = await getLocalStoreReady();
  const row = await store.getCached("habit", habitId);
  if (!row || row.deletedAt) return { ok: false };
  const current = readHabitFromRow(row);
  const name = changes.name ?? current.name;
  const startDate = changes.startDate ?? current.startDate;
  const endDate = changes.endDate !== undefined ? changes.endDate : current.endDate;
  const schedule = changes.schedule ?? current.schedule;
  if (name.trim().length === 0) return { ok: false };
  if (!habitRangeUsable(startDate, endDate)) return { ok: false };
  if (!scheduleUsable(schedule, current.timezone)) return { ok: false };
  const values: Record<string, unknown> = {
    ...changes,
    name: name.trim(),
    schedule:
      schedule.kind === "rrule"
        ? { ...schedule, rule: normalizeRuleUntil(schedule.rule, endDate) }
        : schedule,
  };
  const base = parsePayload(row);
  const now = new Date().toISOString();
  await store.upsertCached([
    {
      entity: "habit",
      entityId: habitId,
      version: row.version,
      updatedAt: now,
      deletedAt: null,
      payload: JSON.stringify({ ...base, ...values }),
      pending: JSON.stringify(values),
    },
  ]);
  await enqueueOperation({
    kind: "update",
    entity: "habit",
    entityId: habitId,
    baseVersion: row.version,
    payload: values,
    base,
  });
  return { ok: true };
}

async function setHabitArchived(habitId: string, archivedAt: string | null): Promise<boolean> {
  const store = await getLocalStoreReady();
  const row = await store.getCached("habit", habitId);
  if (!row || row.deletedAt) return false;
  const base = parsePayload(row);
  const values = { archivedAt };
  const now = new Date().toISOString();
  await store.upsertCached([
    {
      entity: "habit",
      entityId: habitId,
      version: row.version,
      updatedAt: now,
      deletedAt: null,
      payload: JSON.stringify({ ...base, ...values }),
      pending: JSON.stringify(values),
    },
  ]);
  await enqueueOperation({
    kind: "update",
    entity: "habit",
    entityId: habitId,
    baseVersion: row.version,
    payload: values,
    base,
  });
  return true;
}

/** Archiva: la historia se sigue pudiendo leer, la lista la esconde. */
export async function archiveHabit(habitId: string): Promise<boolean> {
  return setHabitArchived(habitId, new Date().toISOString());
}

/** Desarchiva: vuelve a la lista. */
export async function unarchiveHabit(habitId: string): Promise<boolean> {
  return setHabitArchived(habitId, null);
}

/**
 * Borra un habito: lapida en local para que otros dispositivos se enteren,
 * como al desmarcar una entrada. Borrar lo inexistente es false.
 */
export async function removeHabit(habitId: string): Promise<boolean> {
  const store = await getLocalStoreReady();
  const row = await store.getCached("habit", habitId);
  if (!row || row.deletedAt) return false;
  const now = new Date().toISOString();
  await store.upsertCached([
    {
      entity: "habit",
      entityId: habitId,
      version: row.version,
      updatedAt: now,
      deletedAt: now,
      payload: row.payload,
      pending: null,
    },
  ]);
  await enqueueOperation({
    kind: "delete",
    entity: "habit",
    entityId: habitId,
    baseVersion: row.version,
  });
  return true;
}

function byPositionThenCreated(a: Habit, b: Habit): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.createdAt.localeCompare(b.createdAt);
}

/**
 * La lista con su proyeccion de resumen: el habito mas sus entradas vivas.
 * Misma forma que la API, para que la pantalla no distinga cache de red.
 */
export async function loadHabitSummaries(
  store: LocalStore,
  includeArchived: boolean,
): Promise<HabitSummary[]> {
  const rows = await store.listCached("habit");
  const habits = rows
    .map(readHabitFromRow)
    .filter((habit) => includeArchived || habit.archivedAt === null)
    .sort(byPositionThenCreated);
  return Promise.all(
    habits.map(async (habit) => {
      const entries = await store.listCachedEntries(habit.id);
      return { habit, entries: entries.map(readEntryFromRow) };
    }),
  );
}

export async function loadHabitDetail(
  store: LocalStore,
  habitId: string,
): Promise<{ habit: Habit | null; entries: HabitEntry[] }> {
  const row = await store.getCached("habit", habitId);
  if (!row || row.deletedAt) return { habit: null, entries: [] };
  const rows = await store.listCachedEntries(habitId);
  return { habit: readHabitFromRow(row), entries: rows.map(readEntryFromRow) };
}

export function useHabits(options: { includeArchived?: boolean } = {}): {
  habits: HabitSummary[];
  isLoading: boolean;
  reload: () => void;
  create: (input: CreateHabitInput) => Promise<CreateHabitResult>;
  update: (habitId: string, changes: HabitChanges) => Promise<UpdateHabitResult>;
  archive: (habitId: string) => Promise<boolean>;
  unarchive: (habitId: string) => Promise<boolean>;
  remove: (habitId: string) => Promise<boolean>;
} {
  const [habits, setHabits] = useState<HabitSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const includeArchived = options.includeArchived ?? false;

  const load = useCallback(async () => {
    const store = await getLocalStoreReady();
    setHabits(await loadHabitSummaries(store, includeArchived));
    setIsLoading(false);
  }, [includeArchived]);

  useEffect(() => {
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  return useMemo(
    () => ({
      habits,
      isLoading,
      reload: load,
      create: async (input: CreateHabitInput): Promise<CreateHabitResult> => {
        const result = await createHabit(input);
        await load();
        return result;
      },
      update: async (habitId: string, changes: HabitChanges): Promise<UpdateHabitResult> => {
        const result = await updateHabit(habitId, changes);
        await load();
        return result;
      },
      archive: async (habitId: string): Promise<boolean> => {
        const result = await archiveHabit(habitId);
        await load();
        return result;
      },
      unarchive: async (habitId: string): Promise<boolean> => {
        const result = await unarchiveHabit(habitId);
        await load();
        return result;
      },
      remove: async (habitId: string): Promise<boolean> => {
        const result = await removeHabit(habitId);
        await load();
        return result;
      },
    }),
    [habits, isLoading, load],
  );
}

export function useHabit(habitId: string | null): {
  habit: Habit | null;
  entries: HabitEntry[];
  isLoading: boolean;
  scheduleDescription: ScheduleDescription | null;
  reload: () => void;
  checkIn: (date: LocalDate, input?: CheckInInput) => Promise<MarkResult>;
  skip: (date: LocalDate) => Promise<MarkResult>;
  clear: (date: LocalDate) => Promise<boolean>;
  setAmount: (date: LocalDate, amount: number | null) => Promise<MarkResult>;
  update: (changes: HabitChanges) => Promise<UpdateHabitResult>;
  archive: () => Promise<boolean>;
  unarchive: () => Promise<boolean>;
  remove: () => Promise<boolean>;
} {
  const [habit, setHabit] = useState<Habit | null>(null);
  const [entries, setEntries] = useState<HabitEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!habitId) {
      setHabit(null);
      setEntries([]);
      setIsLoading(false);
      return;
    }
    const store = await getLocalStoreReady();
    const detail = await loadHabitDetail(store, habitId);
    setHabit(detail.habit);
    setEntries(detail.entries);
    setIsLoading(false);
  }, [habitId]);

  useEffect(() => {
    setIsLoading(true);
    void load();
    return subscribeToLocalStore(() => {
      void load();
    });
  }, [load]);

  return useMemo(
    () => ({
      habit,
      entries,
      isLoading,
      // Datos, nunca frases: el texto lo pone la pantalla con `habits.*`.
      scheduleDescription: habit ? describeSchedule(habit.schedule) : null,
      reload: load,
      checkIn: (date: LocalDate, input?: CheckInInput) =>
        habitId ? checkInHabit(habitId, date, input) : Promise.resolve({ ok: false } as MarkResult),
      skip: (date: LocalDate) =>
        habitId ? skipHabit(habitId, date) : Promise.resolve({ ok: false } as MarkResult),
      clear: (date: LocalDate) =>
        habitId ? clearHabitEntry(habitId, date) : Promise.resolve(false),
      setAmount: (date: LocalDate, amount: number | null) =>
        habitId
          ? setEntryAmount(habitId, date, amount)
          : Promise.resolve({ ok: false } as MarkResult),
      update: (changes: HabitChanges) =>
        habitId
          ? updateHabit(habitId, changes)
          : Promise.resolve({ ok: false } as UpdateHabitResult),
      archive: () => (habitId ? archiveHabit(habitId) : Promise.resolve(false)),
      unarchive: () => (habitId ? unarchiveHabit(habitId) : Promise.resolve(false)),
      remove: () => (habitId ? removeHabit(habitId) : Promise.resolve(false)),
    }),
    [habit, entries, isLoading, load, habitId],
  );
}
