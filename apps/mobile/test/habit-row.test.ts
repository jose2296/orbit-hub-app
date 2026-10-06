import { describe, expect, it } from "vitest";

import type { CachedEntity, LocalStore } from "../src/lib/offline/local-store";
import {
  applyHabitEntryChanges,
  mergeHabitEntry,
} from "../src/lib/offline/habit-row";

/**
 * El merge de una entrada, que es lo que Review Focus #5 mide.
 *
 * Precedencia: done > skipped > borrado. Un hecho no se deshace por sync:
 * ni un salto ni un borrado que llega del servidor cambian un done local.
 * Y nunca abre conflicto: sync_conflicts queda en 0, que es el punto entero.
 */

function cached(
  entityId: string,
  values: Record<string, unknown>,
  deletedAt: string | null = null,
): CachedEntity {
  return {
    entity: "habit_entry",
    entityId,
    version: 3,
    updatedAt: "2026-10-01T08:00:00.000Z",
    deletedAt,
    payload: JSON.stringify({
      id: entityId,
      habitId: "habito-1",
      date: "2026-10-01",
      version: 3,
      updatedAt: "2026-10-01T08:00:00.000Z",
      deletedAt,
      ...values,
    }),
    pending: null,
  };
}

function server(
  entityId: string,
  values: Record<string, unknown>,
): { entity: "habit_entry"; record: Record<string, unknown> } {
  return {
    entity: "habit_entry",
    record: {
      id: entityId,
      habitId: "habito-1",
      date: "2026-10-01",
      version: 4,
      updatedAt: "2026-10-01T09:00:00.000Z",
      deletedAt: null,
      ...values,
    },
  };
}

function storeWith(rows: CachedEntity[]): {
  store: LocalStore;
  conflicts: number;
} {
  let conflicts = 0;
  const byId = new Map(rows.map((row) => [row.entityId, row]));
  const store = {
    async getCached(_entity: string, entityId: string) {
      return byId.get(entityId) ?? null;
    },
    async upsertCached(incoming: CachedEntity[]) {
      for (const row of incoming) byId.set(row.entityId, row);
    },
    async saveConflict() {
      conflicts += 1;
    },
    rows: byId,
  };
  return {
    store: store as unknown as LocalStore,
    get conflicts() {
      return conflicts;
    },
  };
}

function read(row: CachedEntity | null): Record<string, unknown> {
  return JSON.parse(row!.payload) as Record<string, unknown>;
}

describe("el merge de una entrada", () => {
  it("done gana a skipped", async () => {
    // Servidor skipped, cliente done => done.
    const local = cached("e1", { status: "done" });
    const { store } = storeWith([local]);

    const merged = mergeHabitEntry(
      server("e1", { status: "skipped" }).record,
      JSON.parse(local.payload) as Record<string, unknown>,
    );

    expect(merged.status).toBe("done");
    expect(merged.deletedAt).toBeNull();

    const { corrections } = await applyHabitEntryChanges(store, [
      server("e1", { status: "skipped" }),
    ]);
    const kept = read(await store.getCached("habit_entry", "e1"));
    expect(kept.status).toBe("done");
    // Lo local gano: hay que contarselo al servidor para converger.
    expect(corrections).toHaveLength(1);
    expect(corrections[0]?.payload.status).toBe("done");
  });

  it("done gana a borrado", async () => {
    const local = cached("e2", { status: "done" });
    const { store } = storeWith([local]);

    const tombstone = server("e2", {
      status: "done",
      deletedAt: "2026-10-01T10:00:00.000Z",
    });
    const merged = mergeHabitEntry(
      tombstone.record,
      JSON.parse(local.payload) as Record<string, unknown>,
    );

    expect(merged.status).toBe("done");
    expect(merged.deletedAt).toBeNull();

    await applyHabitEntryChanges(store, [tombstone]);
    const kept = read(await store.getCached("habit_entry", "e2"));
    expect(kept.status).toBe("done");
    expect(kept.deletedAt).toBeNull();
  });

  it("skipped gana a borrado", async () => {
    const local = cached("e3", { status: "skipped" });
    const { store } = storeWith([local]);

    const tombstone = server("e3", {
      status: "skipped",
      deletedAt: "2026-10-01T10:00:00.000Z",
    });

    await applyHabitEntryChanges(store, [tombstone]);
    const kept = read(await store.getCached("habit_entry", "e3"));
    expect(kept.status).toBe("skipped");
    expect(kept.deletedAt).toBeNull();
  });

  it("lo que no esta en cache se guarda tal cual", async () => {
    const { store } = storeWith([]);

    await applyHabitEntryChanges(store, [server("e4", { status: "done" })]);
    const kept = read(await store.getCached("habit_entry", "e4"));
    expect(kept.status).toBe("done");
  });

  it("no abre conflicto", async () => {
    // Tres cambios que discrepan con lo local: el recuento de
    // sync_conflicts queda en 0. Esto es el punto entero.
    const fixture = storeWith([
      cached("e5", { status: "done" }),
      cached("e6", { status: "skipped" }),
    ]);

    await applyHabitEntryChanges(fixture.store, [
      server("e5", { status: "skipped" }),
      server("e6", {
        status: "skipped",
        deletedAt: "2026-10-01T10:00:00.000Z",
      }),
      server("e7", { status: "done" }),
    ]);

    expect(fixture.conflicts).toBe(0);
  });

  it("un borrado local revive en pantalla hasta que el push lo confirma", async () => {
    // La direccion inversa: lapida local (borrado sin conexion) + fila viva
    // del servidor => gana el servidor y la entrada vuelve a verse. Es
    // resurreccion transitoria, el parpadeo en sentido contrario: el borrado
    // sigue en el outbox, y cuando el push lo confirma y el pull trae la
    // lapida, converge a borrado. Se acepta el parpadeo porque la alternativa
    // (la lapida local pisa al servidor) esconderia una marca que otro
    // dispositivo ya confirmo.
    const fixture = storeWith([
      cached("e8", { status: "done" }, "2026-10-01T09:30:00.000Z"),
    ]);

    const { corrections } = await applyHabitEntryChanges(fixture.store, [
      server("e8", { status: "skipped" }),
    ]);

    const kept = read(await fixture.store.getCached("habit_entry", "e8"));
    expect(kept.status).toBe("skipped");
    expect(kept.deletedAt).toBeNull();
    // Nada que contarle al servidor: lo suyo ya gano.
    expect(corrections).toHaveLength(0);
    expect(fixture.conflicts).toBe(0);
  });

  it("lapida del servidor + done local diverge hasta la proxima marca", async () => {
    // La limitacion honesta del modelo de lapidas: el movil muestra done
    // (la precedencia lo manda) y no emite correccion (una lapida no se
    // revive por update), asi que el servidor mantiene la lapida. Converge
    // en la proxima marca o borrado manual: remarcar revive por upsert en
    // el servidor, y re-borrar confirma la lapida en ambos.
    const fixture = storeWith([cached("e9", { status: "done" })]);

    const { corrections } = await applyHabitEntryChanges(fixture.store, [
      server("e9", {
        status: "done",
        deletedAt: "2026-10-01T10:00:00.000Z",
      }),
    ]);

    const kept = read(await fixture.store.getCached("habit_entry", "e9"));
    expect(kept.status).toBe("done");
    expect(kept.deletedAt).toBeNull();
    // Sin push-back no hay convergencia: el servidor sigue borrado.
    expect(corrections).toHaveLength(0);
    expect(fixture.conflicts).toBe(0);
  });
});
