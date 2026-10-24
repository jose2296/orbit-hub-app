import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  entityId: string;
  payload: string;
  pending: string | null;
  version: number;
  updatedAt: string;
  deletedAt: string | null;
};
const notes = new Map<string, Row>();

const note = (
  id: string,
  payload: Record<string, unknown>,
  deletedAt: string | null = null,
  pending: string | null = null,
) =>
  notes.set(id, {
    entityId: id,
    payload: JSON.stringify(payload),
    pending,
    version: 1,
    updatedAt: "2026-10-24T10:00:00.000Z",
    deletedAt,
  });

vi.mock("@/lib/offline", () => ({
  readRecord: (r: Row) => ({
    ...JSON.parse(r.payload),
    id: r.entityId,
    deletedAt: r.deletedAt,
  }),
  getLocalStoreReady: async () => ({
    listCached: async () => [...notes.values()],
    getCached: async (_entity: string, id: string) => notes.get(id) ?? null,
  }),
}));

import { listNotesIn, loadPinnedNote } from "@/widgets/note-data";

describe("widget de nota fijada", () => {
  beforeEach(() => notes.clear());

  it("ofrece las notas de un sitio: la raiz del espacio o una carpeta, sin borradas", async () => {
    note("a", { title: "Zeta", workspaceId: "w1", folderId: null });
    note("b", { title: "Alfa", workspaceId: "w1", folderId: null });
    note("c", { title: "En carpeta", workspaceId: "w1", folderId: "f1" });
    note("d", { title: "Otro espacio", workspaceId: "w2", folderId: null });
    note(
      "e",
      { title: "Borrada", workspaceId: "w1", folderId: null },
      "2026-10-24T08:00:00Z",
    );
    expect((await listNotesIn("w1", null)).map((n) => n.title)).toEqual([
      "Alfa",
      "Zeta",
    ]);
    expect((await listNotesIn("w1", "f1")).map((n) => n.title)).toEqual([
      "En carpeta",
    ]);
  });

  it("muestra titulo y lineas, y un toque abre la nota", async () => {
    note("a", {
      title: "Compra",
      workspaceId: "w1",
      plainText: "pan\n\n  leche \nhuevos",
    });
    const data = await loadPinnedNote("a");
    expect(data).toEqual({
      id: "a",
      title: "Compra",
      lines: ["pan", "leche", "huevos"],
      uri: "orbithub://note/a",
    });
  });

  it("una edicion pendiente manda, y una nota que ya no esta devuelve null", async () => {
    note(
      "a",
      { title: "T", workspaceId: "w1", plainText: "viejo" },
      null,
      JSON.stringify({ plainText: "nuevo" }),
    );
    expect((await loadPinnedNote("a"))?.lines).toEqual(["nuevo"]);
    note("b", { title: "T", workspaceId: "w1" }, "2026-10-24T08:00:00Z");
    expect(await loadPinnedNote("b")).toBeNull();
    expect(await loadPinnedNote("zzz")).toBeNull();
  });
});
