import { describe, expect, it } from "vitest";

import type { ListItem } from "@orbit-hub/contracts";

import { completedMatch, normaliseToCompare } from "@/lib/lists/done-match";

const fila = (title: string, completed: boolean): ListItem =>
  ({
    id: title,
    listId: "l",
    title,
    position: 0,
    completed,
    priority: "none",
    icon: null,
    iconStyle: "outline",
    iconColor: "neutral",
    tags: [],
    externalId: null,
    metadata: null,
    annotation: null,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    role: 'editor',
    shared: false,
    deletedAt: null,
  }) as ListItem;

describe("normaliseToCompare", () => {
  it("ignores case and accents, so the same word matches itself", () => {
    // "Pañales" and "panales" are the same word to somebody typing on a phone
    // with the accent key two keys away, and the whole feature is worthless if it
    // only fires on the exact spelling.
    expect(normaliseToCompare("Pañales")).toBe(normaliseToCompare("panales"));
    expect(normaliseToCompare("  Leche  ")).toBe("leche");
  });

  it("squashes the spaces, so a double space is not a different thing", () => {
    expect(normaliseToCompare("leche  de  avena")).toBe(
      normaliseToCompare("leche de avena"),
    );
  });
});

describe("completedMatch", () => {
  const Pan = fila("Pan", true);
  const Leche = fila("Leche", false);
  const Pildoras = fila("Pildoras", true);
  const Borrada = { ...fila("Yogur", true), deletedAt: "2026-02-01T00:00:00.000Z" };

  it("finds the row you already did, and only that one", () => {
    const encontrada = completedMatch("pan", [Pan, Leche, Pildoras]);
    expect(encontrada?.id).toBe("Pan");
  });

  it("finds it with the accents written the other way round", () => {
    const encontrada = completedMatch("pañales", [fila("Pañales", true)]);
    expect(encontrada?.title).toBe("Pañales");
  });

  it("ignores the spacing and the case", () => {
    expect(completedMatch("  LECHE ", [Leche, Pan])).toBeNull();
    const conEspacios = completedMatch("leche  de  avena", [
      fila("Leche de avena", true),
    ]);
    expect(conEspacios?.title).toBe("Leche de avena");
  });

  it("says nothing when the row is still pending", () => {
    // Offering to "put back" something that was never done is a button that
    // lies about what it is going to do.
    expect(completedMatch("Leche", [Leche])).toBeNull();
  });

  it("says nothing about a deleted row", () => {
    expect(completedMatch("Yogur", [Borrada])).toBeNull();
  });

  it("says nothing for a title too short to be a real match", () => {
    // Two letters match half the shop, and offering "you already did this" for
    // everything makes the offer worthless by the third time it appears.
    expect(completedMatch("  ", [Pan])).toBeNull();
    expect(completedMatch("p", [Pan])).toBeNull();
  });

  it("gives the most recent one when there are several", () => {
    // The same thing bought twice is on the list twice; the one you did last is
    // the one you mean.
    const antigua = { ...fila("Pan", true), id: "vieja", updatedAt: "2026-01-01T00:00:00.000Z" };
    const reciente = { ...fila("Pan", true), id: "nueva", updatedAt: "2026-06-01T00:00:00.000Z" };
    expect(completedMatch("pan", [antigua, reciente])?.id).toBe("nueva");
  });
});
