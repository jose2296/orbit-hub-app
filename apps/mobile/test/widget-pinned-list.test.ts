import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = new Map<string, { entity: string; entityId: string; payload: string; pending: string | null; version: number; updatedAt: string; deletedAt: string | null }>();
const localUpdate = vi.fn(async () => undefined);

function cached(entity: string, id: string, payload: Record<string, unknown>, deletedAt: string | null = null) {
  rows.set(`${entity}:${id}`, {
    entity,
    entityId: id,
    payload: JSON.stringify(payload),
    pending: null,
    version: 1,
    updatedAt: "2026-10-24T10:00:00.000Z",
    deletedAt,
  });
}

vi.mock("@/lib/offline", () => ({
  localUpdate: (...args: unknown[]) => localUpdate(...(args as [])),
  readRecord: (row: { payload: string; entityId: string; version: number; updatedAt: string; deletedAt: string | null }) => ({
    ...JSON.parse(row.payload),
    id: row.entityId,
    version: row.version,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }),
  getLocalStoreReady: async () => ({
    listCached: async (entity: string) => [...rows.values()].filter((r) => r.entity === entity),
    getCached: async (entity: string, id: string) => rows.get(`${entity}:${id}`) ?? null,
    listCachedItems: async (listId: string) =>
      [...rows.values()].filter((r) => r.entity === "list_item" && JSON.parse(r.payload).listId === listId),
  }),
}));

import { completeItem, listPinnableLists, loadPinnedList } from "@/widgets/pinned-list-data";

const item = (id: string, title: string, position: number, completed = false) =>
  cached("list_item", id, { listId: "l1", title, position, completed, tags: [] });

describe("widget de lista fijada", () => {
  beforeEach(() => {
    rows.clear();
    localUpdate.mockClear();
    cached("list", "l1", { title: "Mudanza", kind: "tasks", orderMode: "manual" });
  });

  it("solo ofrece listas de tareas, sin las borradas, ni boards, ni listas de peliculas", () => {
    cached("list", "b1", { title: "Board", kind: "board" });
    cached("list", "m1", { title: "Pelis", kind: "movies" });
    cached("list", "x1", { title: "Borrada", kind: "tasks" }, "2026-10-01T00:00:00.000Z");
    return expect(listPinnableLists()).resolves.toEqual([{ id: "l1", title: "Mudanza", kind: "tasks" }]);
  });

  it("muestra los pendientes en el orden de la lista y deja fuera hechos y borrados", async () => {
    item("a", "Segunda", 2);
    item("b", "Primera", 1);
    item("c", "Hecha", 0, true);
    const data = await loadPinnedList("l1");
    expect(data?.pending.map((p) => p.title)).toEqual(["Primera", "Segunda"]);
    expect(data?.pendingTotal).toBe(2);
    expect(data?.uri).toBe("orbithub://list/l1");
  });

  it("recorta a doce filas pero cuenta todas", async () => {
    for (let i = 0; i < 15; i++) item(`i${i}`, `T${i}`, i);
    const data = await loadPinnedList("l1");
    expect(data?.pending).toHaveLength(12);
    expect(data?.pendingTotal).toBe(15);
  });

  it("una lista que ya no esta devuelve null", async () => {
    expect(await loadPinnedList("nope")).toBeNull();
    cached("list", "gone", { title: "x", kind: "tasks" }, "2026-10-01T00:00:00.000Z");
    expect(await loadPinnedList("gone")).toBeNull();
  });

  it("marcar desde el widget escribe local y encola, como la app", async () => {
    await completeItem("a");
    expect(localUpdate).toHaveBeenCalledWith("list_item", "a", { completed: true });
  });
});
