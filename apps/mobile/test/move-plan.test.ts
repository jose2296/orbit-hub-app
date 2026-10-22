import { describe, expect, it } from "vitest";

import { arrastradosPorMudanza, valoresDeMudanza } from "@/lib/move/plan";

const destino = { workspaceId: "ws-b", folderId: null };

describe("valoresDeMudanza", () => {
  it("una carpeta se cuelga con parentId; el resto con folderId", () => {
    expect(valoresDeMudanza("folder", destino)).toEqual({
      workspaceId: "ws-b",
      parentId: null,
    });
    for (const kind of ["list", "note", "collection"] as const) {
      expect(valoresDeMudanza(kind, { workspaceId: "ws-b", folderId: "f1" })).toEqual({
        workspaceId: "ws-b",
        folderId: "f1",
      });
    }
  });

  it("un bookmark pierde su coleccion, que es del espacio viejo", () => {
    expect(valoresDeMudanza("bookmark", destino)).toEqual({
      workspaceId: "ws-b",
      folderId: null,
      collectionId: null,
    });
  });
});

const fila = (entity: string, id: string, payload: Record<string, unknown>) => ({
  entity,
  entityId: id,
  payload,
});

describe("arrastradosPorMudanza", () => {
  const cache = [
    fila("folder", "raiz", { parentId: null }),
    fila("folder", "hija", { parentId: "raiz" }),
    fila("folder", "otra", { parentId: null }),
    fila("list", "l1", { folderId: "hija" }),
    fila("list", "l2", { folderId: "otra" }),
    fila("note", "n1", { folderId: "raiz" }),
    fila("collection", "c1", { folderId: "hija" }),
    fila("bookmark", "b1", { folderId: "hija", collectionId: "c1" }),
    fila("bookmark", "b2", { folderId: null, collectionId: "c2" }),
  ];

  it("una carpeta arrastra descendientes y todo lo que cuelga de ellos", () => {
    const ids = arrastradosPorMudanza("folder", "raiz", cache).map((x) => x.entityId).sort();
    expect(ids).toEqual(["b1", "c1", "hija", "l1", "n1"]);
  });

  it("una coleccion arrastra sus bookmarks", () => {
    const ids = arrastradosPorMudanza("collection", "c2", cache).map((x) => x.entityId);
    expect(ids).toEqual(["b2"]);
  });

  it("una lista, una nota o un bookmark no arrastran nada", () => {
    for (const kind of ["list", "note", "bookmark"] as const) {
      expect(arrastradosPorMudanza(kind, "l1", cache)).toEqual([]);
    }
  });

  it("un ciclo en el cache no cuelga el calculo", () => {
    const ciclo = [
      fila("folder", "a", { parentId: "b" }),
      fila("folder", "b", { parentId: "a" }),
    ];
    expect(() => arrastradosPorMudanza("folder", "a", ciclo)).not.toThrow();
  });
});
