import { describe, expect, it, vi } from "vitest";

// Las acciones tocan el almacen local y la cola, que no existen en Node: solo
// se prueba el helper puro que decide QUE bookmarks hay que soltar.
vi.mock("expo-crypto", () => ({ randomUUID: () => "id" }));
vi.mock("../src/lib/offline", () => ({
  enqueueOperation: async () => {},
  getLocalStoreReady: async () => ({}),
  localUpdate: async () => {},
}));
vi.mock("../src/lib/bookmarks/actions", () => ({ updateBookmarkAction: async () => {} }));

import { bookmarksDeLaColeccion } from "../src/lib/collections/actions";

const fila = (entityId: string, collectionId: string | null, deletedAt: string | null = null) => ({
  entityId,
  version: 3,
  deletedAt,
  payload: JSON.stringify({ id: entityId, collectionId }),
});

describe("bookmarksDeLaColeccion", () => {
  it("devuelve solo los vivos que estan en esa coleccion, con su version", () => {
    const filas = [
      fila("a", "c1"),
      fila("b", "c2"),
      fila("c", null),
      fila("d", "c1", "2026-10-07T00:00:00.000Z"),
    ];
    expect(bookmarksDeLaColeccion(filas, "c1")).toEqual([{ id: "a", version: 3 }]);
  });

  it("ignora un payload ilegible en vez de romper el borrado", () => {
    const rota = { entityId: "x", version: 1, deletedAt: null, payload: "{no es json" };
    expect(bookmarksDeLaColeccion([rota, fila("a", "c1")], "c1")).toEqual([{ id: "a", version: 3 }]);
  });
});
