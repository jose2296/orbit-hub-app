import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { entityId: string; payload: string; pending: string | null; version: number; updatedAt: string; deletedAt: string | null };
const lists: Row[] = [];
const items = new Map<string, Row[]>();
const entries: Row[] = [];

const row = (id: string, payload: Record<string, unknown>, deletedAt: string | null = null): Row => ({
  entityId: id,
  payload: JSON.stringify(payload),
  pending: null,
  version: 1,
  updatedAt: "2026-10-24T10:00:00.000Z",
  deletedAt,
});

vi.mock("@/lib/offline", () => ({
  readRecord: (r: Row) => ({ ...JSON.parse(r.payload), id: r.entityId, deletedAt: r.deletedAt }),
  getLocalStoreReady: async () => ({
    listCached: async (entity: string) => (entity === "list" ? lists : entries),
    listCachedItems: async (listId: string) => items.get(listId) ?? [],
  }),
}));

import { loadDashboard } from "@/widgets/dashboard-data";

const NOW = new Date(2026, 9, 24, 9, 0);

describe("widget del resumen", () => {
  beforeEach(() => {
    lists.length = 0;
    items.clear();
    entries.length = 0;
  });

  it("suma pendientes de las listas de tareas y nombra las que mas tienen", async () => {
    lists.push(row("a", { title: "A", kind: "tasks" }), row("b", { title: "B", kind: "tasks" }), row("n", { title: "N", kind: "notes" }));
    items.set("a", [row("1", { completed: false }), row("2", { completed: true })]);
    items.set("b", [row("3", { completed: false }), row("4", { completed: false }), row("5", { completed: false }, "2026-10-24T08:00:00Z")]);
    const summary = await loadDashboard(NOW);
    expect(summary.pendingTotal).toBe(3);
    expect(summary.top.map((l) => l.id)).toEqual(["b", "a"]);
    expect(summary.top[0]?.uri).toBe("orbithub://list/b");
  });

  it("sin pendientes no hay listas, y el diario cuenta si hay texto de hoy", async () => {
    expect((await loadDashboard(NOW)).top).toEqual([]);
    entries.push(row("e", { day: "2026-10-24", plainText: "hola" }));
    expect((await loadDashboard(NOW)).wroteToday).toBe(true);
  });
});
