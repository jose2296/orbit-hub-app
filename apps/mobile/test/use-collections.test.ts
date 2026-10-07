import { describe, expect, it, vi } from "vitest";

// El hook toca el almacen local, que no existe en Node: solo se prueban las dos
// funciones puras que deciden que se ve y con que numero.
vi.mock("../src/lib/offline", () => ({
  getLocalStoreReady: async () => ({}),
  subscribeToLocalStore: () => () => {},
}));

import { countBookmarksByCollection, readCollectionFromRow } from "../src/hooks/use-collections";

const fila = (over: Record<string, unknown> = {}) => ({
  entity: "collection",
  entityId: "c1",
  version: 2,
  updatedAt: "2026-10-07T10:00:00.000Z",
  deletedAt: null,
  payload: JSON.stringify({ id: "c1", workspaceId: "w1", folderId: null, name: "Recetas", position: 1 }),
  pending: null,
  ...over,
});

describe("readCollectionFromRow", () => {
  it("lee el payload y deja que lo pendiente gane (una coleccion recien creada o renombrada)", () => {
    const lectura = readCollectionFromRow(
      fila({ pending: JSON.stringify({ name: "Cenas" }) }) as never,
    );
    expect(lectura).toMatchObject({ id: "c1", workspaceId: "w1", name: "Cenas", version: 2 });
  });

  it("una fila con tombstone no se ofrece, y una ilegible tampoco rompe nada", () => {
    expect(readCollectionFromRow(fila({ deletedAt: "2026-10-07T11:00:00.000Z" }) as never)).toBeNull();
    expect(readCollectionFromRow(fila({ payload: "{roto" }) as never)).toBeNull();
  });

  it("rellena lo que falta: sin emoji ni carpeta no es una coleccion rota", () => {
    const lectura = readCollectionFromRow(fila() as never);
    expect(lectura?.emoji).toBeNull();
    expect(lectura?.folderId).toBeNull();
  });
});

describe("countBookmarksByCollection", () => {
  it("cuenta por coleccion y deja fuera los sin clasificar", () => {
    const bookmarks = [
      { collectionId: "c1" },
      { collectionId: "c1" },
      { collectionId: "c2" },
      { collectionId: null },
    ] as never;
    expect(countBookmarksByCollection(bookmarks)).toEqual({ c1: 2, c2: 1 });
  });
});
