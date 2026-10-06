import { beforeEach, describe, expect, it, vi } from "vitest";

import { progressForPeriod } from "@orbit-hub/habit-core";
import type { Habit, HabitSchedule, LocalDate } from "@orbit-hub/contracts";

import type { CachedEntity, LocalStore, PendingOperationRecord } from "../src/lib/offline/local-store";

/**
 * El hook de habitos, y la disciplina que funciona sin conexion.
 *
 * La validacion de la fecha programada vive en el cliente, antes de encolar:
 * sin ella alguien marca un jueves imposible en un avion y se entera al
 * sincronizar, cuando el push vuelve rechazado. Por eso el primer test es el
 * que vale: dia no programado => { ok: false } y el outbox sigue vacio.
 *
 * La tienda va simulada en memoria (el patron de `dashboard-pull.test.ts`):
 * la de verdad es SQLite en nativo y localStorage en web, y ninguna de las
 * dos se puede cargar en node. Lo que si es de verdad es `enqueueOperation`,
 * asi que el operationId, el baseVersion y la base los pone el mismo codigo
 * que en el telefono.
 */

const HABIT_ID = "habito-lx";
const LUNES: LocalDate = "2026-03-02";
const MIERCOLES: LocalDate = "2026-03-04";
const JUEVES: LocalDate = "2026-03-05";

const cache = new Map<string, CachedEntity>();
const outbox: PendingOperationRecord[] = [];

const clave = (entity: string, entityId: string): string => `${entity}:${entityId}`;

function filaHabito(valores: Record<string, unknown> = {}): CachedEntity {
  const carga = {
    id: HABIT_ID,
    version: 2,
    createdAt: "2026-02-23T08:00:00.000Z",
    updatedAt: "2026-02-23T08:00:00.000Z",
    deletedAt: null,
    name: "Leer",
    description: null,
    schedule: { kind: "rrule", rule: "FREQ=WEEKLY;BYDAY=MO,WE" },
    timezone: "Europe/Madrid",
    weekStart: 0,
    startDate: "2026-02-23",
    endDate: null,
    targetValue: null,
    position: 0,
    archivedAt: null,
    ...valores,
  };
  return {
    entity: "habit",
    entityId: String(carga.id),
    version: 2,
    updatedAt: "2026-02-23T08:00:00.000Z",
    deletedAt: null,
    payload: JSON.stringify(carga),
    pending: null,
  };
}

function filaEntrada(
  entityId: string,
  date: LocalDate,
  status: "done" | "skipped",
  version = 5,
): CachedEntity {
  const carga = {
    id: entityId,
    habitId: HABIT_ID,
    date,
    status,
    amount: null,
    note: null,
    version,
    createdAt: "2026-03-04T08:00:00.000Z",
    updatedAt: "2026-03-04T08:00:00.000Z",
    deletedAt: null,
  };
  return {
    entity: "habit_entry",
    entityId,
    version,
    updatedAt: "2026-03-04T08:00:00.000Z",
    deletedAt: null,
    payload: JSON.stringify(carga),
    pending: null,
  };
}

const tienda = {
  async getClientId(): Promise<string> {
    return "device-1";
  },
  async getCached(entity: string, entityId: string): Promise<CachedEntity | null> {
    return cache.get(clave(entity, entityId)) ?? null;
  },
  async upsertCached(filas: CachedEntity[]): Promise<void> {
    for (const fila of filas) cache.set(clave(fila.entity, fila.entityId), fila);
  },
  async listCached(entity: string, opciones: { includeDeleted?: boolean } = {}): Promise<CachedEntity[]> {
    return [...cache.values()]
      .filter((fila) => fila.entity === entity)
      .filter((fila) => opciones.includeDeleted === true || fila.deletedAt === null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async listCachedEntries(habitId: string): Promise<CachedEntity[]> {
    return [...cache.values()]
      .filter((fila) => fila.entity === "habit_entry" && fila.deletedAt === null)
      .filter(
        (fila) => (JSON.parse(fila.payload) as { habitId?: string }).habitId === habitId,
      )
      .sort((a, b) =>
        (JSON.parse(a.payload) as { date: string }).date.localeCompare(
          (JSON.parse(b.payload) as { date: string }).date,
        ),
      );
  },
  async enqueue(registro: PendingOperationRecord): Promise<void> {
    const donde = outbox.findIndex((op) => op.operationId === registro.operationId);
    if (donde >= 0) outbox[donde] = registro;
    else outbox.push(registro);
  },
  async listPending(limite: number): Promise<PendingOperationRecord[]> {
    return [...outbox]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limite);
  },
  async remove(operationId: string): Promise<void> {
    const donde = outbox.findIndex((op) => op.operationId === operationId);
    if (donde >= 0) outbox.splice(donde, 1);
  },
};

vi.mock("@/lib/offline/local-store", () => ({
  getLocalStoreReady: async () => tienda as unknown as LocalStore,
  subscribeToLocalStore: () => () => undefined,
}));

vi.mock("@/lib/storage/key-value", () => ({
  keyValueStore: {
    get: () => null,
    set: () => undefined,
    remove: () => undefined,
    getJson: () => null,
    setJson: () => undefined,
  },
}));

vi.mock("expo-crypto", () => {
  let n = 0;
  return { randomUUID: (): string => `uuid-test-${(n += 1)}` };
});

const {
  archiveHabit,
  checkInHabit,
  clearHabitEntry,
  createHabit,
  extractUntilDate,
  loadHabitDetail,
  loadHabitSummaries,
  nextScheduledDate,
  normalizeRuleUntil,
  readEntryFromRow,
  removeHabit,
  setEntryAmount,
  skipHabit,
  toHabitRecord,
  unarchiveHabit,
  updateHabit,
} = await import("../src/hooks/use-habits");

beforeEach(() => {
  cache.clear();
  outbox.length = 0;
});

function habito(): Habit {
  const fila = filaHabito();
  return JSON.parse(fila.payload) as Habit;
}

async function progresoDe(fecha: LocalDate): Promise<{ done: number; target: number }> {
  const detalle = await loadHabitDetail(tienda as unknown as LocalStore, HABIT_ID);
  if (!detalle.habit) throw new Error("el habito tendria que estar en cache");
  return progressForPeriod(toHabitRecord(detalle.habit), "week", fecha, detalle.entries);
}

describe("el hook de habitos", () => {
  it("no encola una entrada en un dia que no estaba programado", async () => {
    // Este es el que vale: sin el, alguien marca en un avion y se entera al sincronizar.
    cache.set(clave("habit", HABIT_ID), filaHabito());

    const ok = await checkInHabit(HABIT_ID, JUEVES); // jueves, el habito es L/X

    expect(ok).toEqual({ ok: false }); // y el outbox sigue vacio
    expect(outbox).toHaveLength(0);
    expect([...cache.values()].filter((fila) => fila.entity === "habit_entry")).toHaveLength(0);
  });

  it("encola con operationId, baseVersion y base", async () => {
    cache.set(clave("habit", HABIT_ID), filaHabito());
    cache.set(clave("habit_entry", "e1"), filaEntrada("e1", MIERCOLES, "skipped", 5));

    const resultado = await checkInHabit(HABIT_ID, MIERCOLES);

    expect(resultado).toEqual({
      ok: true,
      entry: {
        habitId: HABIT_ID,
        date: MIERCOLES,
        status: "done",
        amount: null,
        note: null,
        version: 5,
      },
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      entity: "habit_entry",
      kind: "update",
      baseVersion: 5,
    });
    expect(typeof outbox[0]?.operationId).toBe("string");
    expect((outbox[0]?.operationId ?? "").length).toBeGreaterThan(0);
    expect(JSON.parse(outbox[0]?.payload ?? "{}")).toMatchObject({ status: "done" });
    expect(JSON.parse(outbox[0]?.base ?? "{}")).toMatchObject({ status: "skipped" });
  });

  it("desmarcar y remarcar el mismo dia no acumula", async () => {
    cache.set(clave("habit", HABIT_ID), filaHabito());

    await checkInHabit(HABIT_ID, MIERCOLES);
    const primera = await loadHabitDetail(tienda as unknown as LocalStore, HABIT_ID);
    const idPrimera = primera.entries[0]?.id;
    expect(typeof idPrimera).toBe("string");

    expect(await clearHabitEntry(HABIT_ID, MIERCOLES)).toBe(true);
    const remarcado = await checkInHabit(HABIT_ID, MIERCOLES);

    expect(remarcado.ok).toBe(true);
    const detalle = await loadHabitDetail(tienda as unknown as LocalStore, HABIT_ID);
    expect(detalle.entries.filter((e) => e.date === MIERCOLES)).toHaveLength(1);
    expect(detalle.entries[0]?.status).toBe("done");
    // Un dia = una fila: remarcar revive la lapida con update, no crea otro
    // id. Dos creates vivos para el mismo dia partirian el UNIQUE del servidor.
    expect(detalle.entries[0]?.id).toBe(idPrimera);
    const ops = outbox.filter((op) => op.entity === "habit_entry");
    expect(ops.filter((op) => op.kind === "create")).toHaveLength(0);
    expect(ops.map((op) => op.kind).sort()).toEqual(["delete", "update"]);
    expect(new Set(ops.map((op) => op.entityId))).toEqual(new Set([idPrimera]));
  });

  it("el progreso se mueve al instante, sin esperar al pull", async () => {
    // La misma funcion que usa la API: si divergen, el movil y el servidor
    // muestran numeros distintos y no hay forma de saber cual tiene razon.
    cache.set(clave("habit", HABIT_ID), filaHabito());

    expect(await progresoDe(MIERCOLES)).toMatchObject({ done: 0, target: 2 });

    await checkInHabit(HABIT_ID, MIERCOLES);

    expect(await progresoDe(MIERCOLES)).toMatchObject({ done: 1, target: 2 });
  });

  it("saltar un dia programado tambien encola, y en jueves no", async () => {
    cache.set(clave("habit", HABIT_ID), filaHabito());

    const salto = await skipHabit(HABIT_ID, LUNES);
    expect(salto).toMatchObject({ ok: true });
    if (salto.ok) expect(salto.entry.status).toBe("skipped");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ entity: "habit_entry", kind: "create" });

    expect(await skipHabit(HABIT_ID, JUEVES)).toEqual({ ok: false });
    expect(outbox).toHaveLength(1);
  });

  it("la cantidad viaja en la entrada y se puede corregir", async () => {
    cache.set(clave("habit", HABIT_ID), filaHabito());

    const marcado = await checkInHabit(HABIT_ID, MIERCOLES, { amount: 2 });
    expect(marcado).toMatchObject({ ok: true });
    if (marcado.ok) expect(marcado.entry.amount).toBe(2);

    const corregido = await setEntryAmount(HABIT_ID, MIERCOLES, 3);
    expect(corregido).toMatchObject({ ok: true });
    if (corregido.ok) expect(corregido.entry.amount).toBe(3);
    // La correccion cae dentro del create que aun no salio, no como segunda
    // operacion: es el plegado del outbox, y el servidor recibe una sola
    // fila con la cantidad final.
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ entity: "habit_entry", kind: "create" });
    expect(JSON.parse(outbox[0]?.payload ?? "{}")).toMatchObject({ amount: 3 });

    // Sin entrada no hay nada que corregir.
    expect(await setEntryAmount(HABIT_ID, LUNES, 1)).toEqual({ ok: false });
  });

  it("un habito que no esta en cache no se marca", async () => {
    expect(await checkInHabit(HABIT_ID, MIERCOLES)).toEqual({ ok: false });
    expect(outbox).toHaveLength(0);
  });

  it("la lista esconde archivados salvo que se pidan", async () => {
    cache.set(clave("habit", HABIT_ID), filaHabito());
    cache.set(
      clave("habit", "habito-viejo"),
      filaHabito({ id: "habito-viejo", archivedAt: "2026-03-01T08:00:00.000Z" }),
    );

    const visibles = await loadHabitSummaries(tienda as unknown as LocalStore, false);
    expect(visibles.map((r) => r.habit.id)).toEqual([HABIT_ID]);

    const todos = await loadHabitSummaries(tienda as unknown as LocalStore, true);
    expect(todos.map((r) => r.habit.id).sort()).toEqual([HABIT_ID, "habito-viejo"]);
  });

  it("el proximo dia programado sale del mismo motor", async () => {
    // Jueves 5 de marzo con habito L/X: el siguiente es el lunes 9.
    expect(nextScheduledDate(habito(), JUEVES)).toBe("2026-03-09");
    // Y lo ya leido de una fila se puede usar como entrada del motor.
    cache.set(clave("habit", HABIT_ID), filaHabito());
    cache.set(clave("habit_entry", "e1"), filaEntrada("e1", MIERCOLES, "done", 5));
    const detalle = await loadHabitDetail(tienda as unknown as LocalStore, HABIT_ID);
    expect(detalle.entries.map((e) => readEntryFromRow(filaEntrada("e1", e.date, e.status))).length).toBe(1);
  });
});

describe("las mutaciones del habito", () => {
  const ZONA = "Europe/Madrid";

  function habitoGuardado(id: string): Habit {
    const fila = cache.get(clave("habit", id));
    if (!fila) throw new Error("el habito tendria que estar en cache");
    return JSON.parse(fila.payload) as Habit;
  }

  it("crear rechaza un horario imposible sin encolar", async () => {
    const resultado = await createHabit({
      name: "Leer",
      schedule: { kind: "rrule", rule: "NOT_A_RULE" },
      timezone: ZONA,
      startDate: "2026-03-02",
      endDate: null,
      targetValue: null,
    });

    expect(resultado).toEqual({ ok: false });
    expect(outbox).toHaveLength(0);
    expect([...cache.values()].filter((fila) => fila.entity === "habit")).toHaveLength(0);
  });

  it("crear rechaza el nombre vacio y el fin anterior al inicio", async () => {
    const base = {
      schedule: { kind: "rrule", rule: "FREQ=DAILY" } as HabitSchedule,
      timezone: ZONA,
      startDate: "2026-03-02" as LocalDate,
      endDate: null,
      targetValue: null,
    };
    expect(await createHabit({ ...base, name: "   " })).toEqual({ ok: false });
    expect(
      await createHabit({ ...base, name: "Leer", endDate: "2026-03-01" }),
    ).toEqual({ ok: false });
    expect(outbox).toHaveLength(0);
  });

  it("crear guarda con el UNTIL de endDate cuando la regla trae otro", async () => {
    const resultado = await createHabit({
      name: "Leer",
      schedule: { kind: "rrule", rule: "FREQ=DAILY;UNTIL=20261231T235959Z" },
      timezone: ZONA,
      startDate: "2026-03-02",
      endDate: "2026-04-30",
      targetValue: null,
    });
    if (!resultado.ok) throw new Error("tendria que haberse creado");

    // endDate es la unica fuente de verdad: el UNTIL que traia se reemplaza.
    expect(habitoGuardado(resultado.habitId).schedule).toEqual({
      kind: "rrule",
      rule: "FREQ=DAILY;UNTIL=20260430T235959Z",
    });
    // Y recarga: la lista lo trae sin esperar al pull.
    const visibles = await loadHabitSummaries(tienda as unknown as LocalStore, false);
    expect(visibles.map((resumen) => resumen.habit.id)).toContain(resultado.habitId);
    expect(outbox[0]).toMatchObject({ kind: "create", entity: "habit" });
  });

  it("crear sin endDate quita el UNTIL de la regla", async () => {
    const resultado = await createHabit({
      name: "Leer",
      schedule: { kind: "rrule", rule: "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T235959Z" },
      timezone: ZONA,
      startDate: "2026-03-02",
      endDate: null,
      targetValue: null,
    });
    if (!resultado.ok) throw new Error("tendria que haberse creado");

    expect(habitoGuardado(resultado.habitId).schedule).toEqual({
      kind: "rrule",
      rule: "FREQ=WEEKLY;BYDAY=MO",
    });
  });

  it("una regla sin UNTIL se guarda tal cual aunque haya endDate", async () => {
    const resultado = await createHabit({
      name: "Leer",
      schedule: { kind: "rrule", rule: "FREQ=DAILY" },
      timezone: ZONA,
      startDate: "2026-03-02",
      endDate: "2026-04-30",
      targetValue: null,
    });
    if (!resultado.ok) throw new Error("tendria que haberse creado");

    // El fin vive en el campo endDate; la regla limpia no se ensucia.
    const guardado = habitoGuardado(resultado.habitId);
    expect(guardado.schedule).toEqual({ kind: "rrule", rule: "FREQ=DAILY" });
    expect(guardado.endDate).toBe("2026-04-30");
  });

  it("actualizar valida antes de escribir", async () => {
    cache.set(clave("habit", HABIT_ID), filaHabito());

    expect(
      await updateHabit(HABIT_ID, { schedule: { kind: "rrule", rule: "FREQ=XXX" } }),
    ).toEqual({ ok: false });
    expect(outbox).toHaveLength(0);
  });

  it("actualizar reescribe el UNTIL con el fin vigente", async () => {
    cache.set(clave("habit", HABIT_ID), filaHabito());

    const resultado = await updateHabit(HABIT_ID, {
      schedule: { kind: "rrule", rule: "FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T235959Z" },
      endDate: "2026-05-31",
    });
    expect(resultado).toEqual({ ok: true });
    expect(habitoGuardado(HABIT_ID).schedule).toEqual({
      kind: "rrule",
      rule: "FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260531T235959Z",
    });
    expect(outbox[0]).toMatchObject({ kind: "update", entity: "habit" });
  });

  it("archivar y desarchivar recargan", async () => {
    cache.set(clave("habit", HABIT_ID), filaHabito());

    expect(await archiveHabit(HABIT_ID)).toBe(true);
    expect(habitoGuardado(HABIT_ID).archivedAt).not.toBeNull();
    const sinArchivados = await loadHabitSummaries(tienda as unknown as LocalStore, false);
    expect(sinArchivados).toHaveLength(0);

    expect(await unarchiveHabit(HABIT_ID)).toBe(true);
    expect(habitoGuardado(HABIT_ID).archivedAt).toBeNull();
    const recargados = await loadHabitSummaries(tienda as unknown as LocalStore, false);
    expect(recargados.map((resumen) => resumen.habit.id)).toEqual([HABIT_ID]);
  });

  it("borrar pone lapida y encola delete", async () => {
    cache.set(clave("habit", HABIT_ID), filaHabito());

    expect(await removeHabit(HABIT_ID)).toBe(true);
    const recargados = await loadHabitSummaries(tienda as unknown as LocalStore, true);
    expect(recargados).toHaveLength(0);
    expect(outbox[0]).toMatchObject({ kind: "delete", entity: "habit" });
    expect(await removeHabit(HABIT_ID)).toBe(false);
  });

  it("el UNTIL se lee como dia local", () => {
    expect(extractUntilDate("FREQ=DAILY;UNTIL=20260430T235959Z")).toBe("2026-04-30");
    expect(extractUntilDate("FREQ=DAILY")).toBeNull();
    expect(extractUntilDate("FREQ=DAILY;UNTIL=basura")).toBeNull();
  });

  it("normalizar solo toca reglas que traen UNTIL", () => {
    expect(normalizeRuleUntil("FREQ=DAILY", "2026-04-30")).toBe("FREQ=DAILY");
    expect(normalizeRuleUntil("FREQ=DAILY;UNTIL=20261231T235959Z", null)).toBe("FREQ=DAILY");
  });
});
