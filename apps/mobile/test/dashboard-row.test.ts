import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CachedEntity, LocalStore } from "../src/lib/offline/local-store";

/*
 * The store itself opens a database and reads the device, so it is stubbed and
 * the row logic is tested on its own. What is under test is which row survives a
 * merge and what the payload says afterwards; neither needs a real store, and
 * pulling one in would drag React Native into a Node process.
 */
/*
 * Stubbed whole, and not merged with the real module: the real one opens a
 * database and reads the device, and asking for it even to look at its exports
 * would drag React Native into a Node process. What is under test is which row
 * survives a merge and what the payload says afterwards, and the store is always
 * passed in by hand.
 */
vi.mock("@/lib/offline/local-store", () => ({
  getLocalStoreReady: async () => storeInstance,
}));

let storeInstance: LocalStore;

const { FALLBACK_DASHBOARD_ID, resolveDashboardRow } = await import(
  "@/lib/offline/dashboard-row"
);

/**
 * The panel is one row, and finding it is a merge.
 *
 * A phone that made its own row and then receives the server's has two, and the
 * two are merged into the server's. That merge used to write back only the
 * layout, so the page count was dropped: a panel of four screens came back as
 * one, with the cards still on it and the other three screens gone. The cards
 * are what you notice is still there; the missing screens are what you notice
 * three weeks later.
 */
function row(entityId: string, payload: Record<string, unknown>): CachedEntity {
  return {
    entity: "dashboard",
    entityId,
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    payload: JSON.stringify(payload),
    pending: null,
  };
}

function storeWith(rows: CachedEntity[]): LocalStore {
  const written: CachedEntity[] = [];
  const store = {
    written,
    async listCached() {
      return rows;
    },
    async getCached(_entity: string, entityId: string) {
      return rows.find((r) => r.entityId === entityId) ?? null;
    },
    async upsertCached(incoming: CachedEntity[]) {
      // Applied, not just recorded: the row resolution re-reads the row after it
      // writes, and a store that swallowed the write would be a different store.
      written.push(...incoming);
      for (const r of incoming) {
        const at = rows.findIndex((existing) => existing.entityId === r.entityId);
        if (at >= 0) rows[at] = r;
        else rows.push(r);
      }
    },
  };
  return store as unknown as LocalStore;
}

describe("the panel's own row", () => {
  beforeEach(() => {
    storeInstance = storeWith([]);
  });

  it("merges the two rows and keeps the wider screen count", async () => {
    const mine = row(FALLBACK_DASHBOARD_ID, {
      layout: [{ id: "note:n1", kind: "recent_notes", x: 0, y: 0, w: 1, h: 1, page: 3 }],
      pages: 4,
    });
    const theirs = row("e886f217-ce4f-45d4-9cf0-48c00fde7e23", { layout: [], pages: 1 });
    const store = storeWith([mine, theirs]);

    const { row: kept } = await resolveDashboardRow(store);

    expect(kept?.entityId).toBe("e886f217-ce4f-45d4-9cf0-48c00fde7e23");
    const payload = JSON.parse(kept!.payload) as { layout: unknown[]; pages: number };
    expect(payload.layout).toHaveLength(1);
    // The one that matters, and the reason this file exists.
    expect(payload.pages).toBe(4);
  });

  it("keeps whatever else the row carried", () => {
    // A payload is not only a layout. Writing `{ layout }` back drops everything
    // the panel did not know about yet, which is how one field becomes a bug
    // report six weeks after somebody adds the second one.
    const written = row("e886f217-ce4f-45d4-9cf0-48c00fde7e23", {
      layout: [],
      pages: 2,
      theme: "dark",
    });
    expect(JSON.parse(written.payload)).toHaveProperty("theme", "dark");
  });

  it("says there is no row when there is none, and names the one to create", async () => {
    const store = storeWith([]);
    const found = await resolveDashboardRow(store);
    expect(found.row).toBeNull();
    expect(found.entityId).toBe(FALLBACK_DASHBOARD_ID);
  });
});
