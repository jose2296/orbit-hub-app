import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CachedEntity, LocalStore } from "../src/lib/offline/local-store";

/*
 * El pull del panel, y lo que se queda de lo que trae.
 *
 * El panel es una fila por persona y el servidor le da un identificador propio, que
 * no es el que escribió este dispositivo. Por eso la fila que llega no se escribe
 * tal cual: se escribe en la fila que ya está aquí, y de la que llega se copia lo
 * que el panel necesita.
 *
 * Y de esa copia es de donde salía el bug: se copiaba el layout y nada más. El
 * número de pantallas se perdía en cada pull, y como el número de pantallas es lo
 * único que distingue "una pantalla con tarjetas" de "una pantalla vacía que
 * alguien acaba de crear", lo que se perdía era exactamente lo que no se ve: la
 * pantalla de menos. El botón de añadir pantalla funcionaba, se guardaba, y a la
 * siguiente carga no estaba — y toda comprobación del botón, hecha antes de
 * recargar, pasaba.
 */

vi.mock("@/lib/offline/local-store", () => ({
  getLocalStoreReady: async () => storeInstance,
}));

let storeInstance: LocalStore;
const guardadas: CachedEntity[] = [];

const fila = (payload: unknown, version = 1): CachedEntity => ({
  entity: "dashboard",
  entityId: "d5a0d1f2-4b3c-4a7e-9c2f-1b6d8e5a4f30",
  version,
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  payload: JSON.stringify(payload),
  pending: null,
});

storeInstance = {
  listCached: async () => guardadas,
  getCached: async (_entity: string, id: string) =>
    guardadas.find((row) => row.entityId === id) ?? null,
  upsertCached: async (rows: CachedEntity[]) => {
    for (const row of rows) {
      const donde = guardadas.findIndex((existente) => existente.entityId === row.entityId);
      if (donde >= 0) guardadas[donde] = row;
      else guardadas.push(row);
    }
  },
} as unknown as LocalStore;

const { applyDashboardChanges } = await import("@/lib/offline/apply-panel");

beforeEach(() => {
  guardadas.length = 0;
});

/** La fila tal y como la deja el pull, leída sin inventarse que existe. */
function leida(indice = 0): Record<string, unknown> {
  const fila = guardadas[indice];
  if (!fila) throw new Error(`no hay fila ${indice} en la cache`);
  return JSON.parse(fila.payload) as Record<string, unknown>;
}

const widget = (id: string, page: number) => ({
  id,
  kind: "recent_lists" as const,
  x: 0,
  y: 0,
  w: 2,
  h: 2,
  page,
  pinned: true,
  settings: { listId: `lista-${id}`, title: id, kind: "tasks" },
});

describe("el pull del panel", () => {
  it("escribe la fila que ya estaba, y no una segunda", async () => {
    // El identificador del servidor no es el de aquí, y escribir la fila tal cual
    // deja dos paneles en la cache. A partir de ahí cada lectura se lleva el
    // primero, y una lista fijada en el móvil desaparece en el portátil.
    guardadas.push(fila({ layout: [widget("a", 0)] }, 3));

    await applyDashboardChanges(storeInstance, [
      {
        entity: "dashboard",
        record: { id: "otra-cosa", version: 7, layout: [widget("b", 1)], pages: 2 },
      },
    ]);

    expect(guardadas).toHaveLength(1);
    expect(guardadas[0]?.version).toBe(7);
  });

  it("conserva cuántas pantallas dice el panel", async () => {
    guardadas.push(fila({ layout: [widget("a", 0)] }, 3));

    await applyDashboardChanges(storeInstance, [
      {
        entity: "dashboard",
        record: { id: "otra-cosa", version: 8, layout: [widget("b", 1)], pages: 4 },
      },
    ]);

    expect(leida()).toMatchObject({ pages: 4 });
  });

  it("y una pantalla vacía sobrevive al pull, que es para lo que existe la cuenta", async () => {
    // Tres pantallas y tarjetas solo en las dos primeras: la tercera es una
    // pantalla que alguien creó y no ha llenado todavía. Sin el número, el panel
    // vuelve a mirar las tarjetas y decide que solo hay dos.
    guardadas.push(fila({ layout: [widget("a", 0), widget("b", 1)], pages: 3 }, 3));

    await applyDashboardChanges(storeInstance, [
      {
        entity: "dashboard",
        record: {
          id: "otra-cosa",
          version: 9,
          layout: [widget("a", 0), widget("b", 1)],
          pages: 3,
        },
      },
    ]);

    expect(leida()).toMatchObject({ pages: 3 });
  });

  it("lee un número que no es un número como una pantalla", async () => {
    // Una fila escrita antes de que existieran las pantallas no trae cuenta, y
    // `pages: 0` borraría el panel entero si alguien lo escribiera.
    guardadas.push(fila({ layout: [widget("a", 0)] }, 3));

    for (const pages of [undefined, 0, -4, "muchas", null]) {
      await applyDashboardChanges(storeInstance, [
        {
          entity: "dashboard",
          record: { id: "otra-cosa", version: 9, layout: [widget("a", 0)], pages },
        },
      ]);
      expect(leida()).toMatchObject({ pages: 1 });
    }
  });

  it("trae el layout de la fila aunque venga en cualquiera de las dos formas", async () => {
    // El servidor manda el layout como columna y otras rutas lo mandan dentro de un
    // `payload`. Las dos tienen que acabar en el mismo sitio.
    guardadas.push(fila({ layout: [widget("a", 0)] }, 3));

    await applyDashboardChanges(storeInstance, [
      {
        entity: "dashboard",
        record: { id: "otra-cosa", version: 10, payload: { layout: [widget("c", 1)], pages: 2 } },
      },
    ]);

    const guardado = leida();
    expect(guardado["pages"]).toBe(2);
    expect((guardado["layout"] as { id: string }[])[0]?.id).toBe("c");
  });
});
