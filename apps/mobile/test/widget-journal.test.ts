import { beforeEach, describe, expect, it, vi } from "vitest";

const rows: Array<{
  payload: string;
  pending: string | null;
  deletedAt: string | null;
}> = [];

vi.mock("@/lib/offline", () => ({
  getLocalStoreReady: async () => ({ listCached: async () => rows }),
}));

import { loadJournalToday } from "@/widgets/journal-data";

const NOW = new Date(2026, 9, 24, 9, 0);
const entry = (
  day: string,
  plainText: string,
  extra: Partial<(typeof rows)[number]> = {},
) =>
  rows.push({
    payload: JSON.stringify({ day, plainText }),
    pending: null,
    deletedAt: null,
    ...extra,
  });

describe("widget del diario de hoy", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it("devuelve las lineas del dia de hoy, sin vacias", async () => {
    entry("2026-10-23", "ayer");
    entry("2026-10-24", "primera\n\n  segunda  \n");
    const today = await loadJournalToday(NOW);
    expect(today.day).toBe("2026-10-24");
    expect(today.lines).toEqual(["primera", "segunda"]);
    expect(today.uri).toBe("orbithub://journal");
  });

  it("sin entrada de hoy no hay lineas", async () => {
    entry("2026-10-23", "ayer");
    expect((await loadJournalToday(NOW)).lines).toEqual([]);
  });

  it("una edicion pendiente manda sobre la copia del servidor", async () => {
    entry("2026-10-24", "viejo", {
      pending: JSON.stringify({ plainText: "nuevo" }),
    });
    expect((await loadJournalToday(NOW)).lines).toEqual(["nuevo"]);
  });

  it("una entrada borrada no cuenta y el widget corta en 100 lineas", async () => {
    entry("2026-10-24", "borrada", { deletedAt: "2026-10-24T08:00:00Z" });
    expect((await loadJournalToday(NOW)).lines).toEqual([]);
    rows.length = 0;
    entry(
      "2026-10-24",
      Array.from({ length: 130 }, (_, i) => `l${i}`).join("\n"),
    );
    expect((await loadJournalToday(NOW)).lines).toHaveLength(100);
  });
});
