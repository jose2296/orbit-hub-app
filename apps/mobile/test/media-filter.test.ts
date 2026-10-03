import { describe, expect, it } from "vitest";

import type { ListItem } from "@orbit-hub/contracts";

import {
  EMPTY_MEDIA_FILTER,
  matchesMediaFilter,
  mediaFilterCount,
  type MediaFilter,
} from "../src/lib/lists/media-filter";

function makeItem(partial: Partial<ListItem> & { externalId: string | null }): ListItem {
  return {
    id: "item-1",
    listId: "list-1",
    version: 1,
    title: "Matrix",
    position: 0,
    completed: false,
    stateId: null,
    priority: "none",
    icon: null,
    iconStyle: "outline" as const,
    iconColor: "neutral" as const,
    tags: [],
    metadata: null,
    annotation: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    role: 'editor',
    shared: false,
    deletedAt: null,
    ...partial,
  };
}

const pelicula = (extra: Record<string, unknown> = {}) =>
  makeItem({
    externalId: "tmdb:603",
    metadata: { type: "movie", releaseDate: "1999-03-31", imageUrl: "https://x/m.jpg" },
    ...extra,
  });

/** The same day in every test, so "this month" does not depend on when it runs. */
const HOY = new Date("2026-06-15T12:00:00.000Z");

describe("matchesMediaFilter", () => {
  it("lets everything through when nothing is filtered", () => {
    expect(matchesMediaFilter(pelicula(), EMPTY_MEDIA_FILTER, HOY)).toBe(true);
  });

  describe("text", () => {
    it("finds a title whatever its case", () => {
      const filtro: MediaFilter = { ...EMPTY_MEDIA_FILTER, text: "MATRIX" };
      expect(matchesMediaFilter(pelicula({ title: "Matrix" }), filtro, HOY)).toBe(true);
    });

    it("finds a title without its accents", () => {
      // "pelicula" has to find "Película". Lowercasing does not do this — it
      // keeps the tilde — and the phone keyboard does not insist on it either, so
      // without stripping the mark the one axis that can narrow a long list
      // answers only to accented typing.
      const filtro: MediaFilter = { ...EMPTY_MEDIA_FILTER, text: "pelicula" };
      expect(matchesMediaFilter(pelicula({ title: "Pelea película a muerte" }), filtro, HOY)).toBe(
        true,
      );
    });

    it("finds an ñ written without the tilde", () => {
      const filtro: MediaFilter = { ...EMPTY_MEDIA_FILTER, text: "ano" };
      expect(matchesMediaFilter(pelicula({ title: "El año del Diluvio" }), filtro, HOY)).toBe(true);
    });

    it("finds a title in the middle of it and not only at the start", () => {
      const filtro: MediaFilter = { ...EMPTY_MEDIA_FILTER, text: "reloaded" };
      expect(
        matchesMediaFilter(pelicula({ title: "The Matrix Reloaded" }), filtro, HOY),
      ).toBe(true);
    });
  });

  describe("decade", () => {
    it("puts a film in the decade of its release", () => {
      const filtro: MediaFilter = { ...EMPTY_MEDIA_FILTER, decade: 1990 };
      expect(matchesMediaFilter(pelicula(), filtro, HOY)).toBe(true);
    });

    it("does not put a 2000s film in the nineties", () => {
      const filtro: MediaFilter = { ...EMPTY_MEDIA_FILTER, decade: 1990 };
      const dosMil = pelicula({ metadata: { type: "movie", releaseDate: "2001-01-01" } });
      expect(matchesMediaFilter(dosMil, filtro, HOY)).toBe(false);
    });

    it("has nowhere to put a film with no date", () => {
      // A typed-in item has no release date, and the honest answer to "is this
      // from the nineties?" is no. Inventing a year to make it fit is the bug
      // this same rule was written to avoid in the ordering.
      const filtro: MediaFilter = { ...EMPTY_MEDIA_FILTER, decade: 1990 };
      const sinFecha = makeItem({ externalId: null, title: "Lo que me apetece" });
      expect(matchesMediaFilter(sinFecha, filtro, HOY)).toBe(false);
    });
  });

  describe("type", () => {
    it("puts a film in films and not in series", () => {
      const filtro: MediaFilter = { ...EMPTY_MEDIA_FILTER, type: "movie" };
      expect(matchesMediaFilter(pelicula(), filtro, HOY)).toBe(true);
      const serie = pelicula({ metadata: { type: "tv" } });
      expect(matchesMediaFilter(serie, filtro, HOY)).toBe(false);
    });

    it("leaves a typed-in item out of both", () => {
      // It is not a film and it is not a series, and guessing would be a lie the
      // filter is then built on.
      const filtro: MediaFilter = { ...EMPTY_MEDIA_FILTER, type: "movie" };
      const aMano = makeItem({ externalId: null, title: "Anotación" });
      expect(matchesMediaFilter(aMano, filtro, HOY)).toBe(false);
    });
  });

  describe("artwork", () => {
    it("separates the ones with a picture from the ones without", () => {
      const con: MediaFilter = { ...EMPTY_MEDIA_FILTER, artwork: true };
      const sin: MediaFilter = { ...EMPTY_MEDIA_FILTER, artwork: false };
      const aMano = makeItem({ externalId: null, title: "Sin poster" });
      expect(matchesMediaFilter(pelicula(), con, HOY)).toBe(true);
      expect(matchesMediaFilter(aMano, con, HOY)).toBe(false);
      expect(matchesMediaFilter(pelicula(), sin, HOY)).toBe(false);
      expect(matchesMediaFilter(aMano, sin, HOY)).toBe(true);
    });

    it("is not fooled by an empty image url", () => {
      // An empty string is truthy, and a filter that reads it as a picture sends
      // the item to the wrong side of the sheet.
      const sin: MediaFilter = { ...EMPTY_MEDIA_FILTER, artwork: false };
      const vacia = pelicula({ metadata: { type: "movie", imageUrl: "   " } });
      expect(matchesMediaFilter(vacia, sin, HOY)).toBe(true);
    });
  });

  describe("added", () => {
    const haceDias = (dias: number) =>
      new Date(HOY.getTime() - dias * 86_400_000).toISOString();

    it("separates this month, this year and before", () => {
      const mes: MediaFilter = { ...EMPTY_MEDIA_FILTER, added: "month" };
      const anio: MediaFilter = { ...EMPTY_MEDIA_FILTER, added: "year" };
      const antes: MediaFilter = { ...EMPTY_MEDIA_FILTER, added: "older" };

      const nuevo = pelicula({ createdAt: haceDias(3) });
      const medio = pelicula({ createdAt: haceDias(200) });
      const viejo = pelicula({ createdAt: haceDias(900) });

      expect(matchesMediaFilter(nuevo, mes, HOY)).toBe(true);
      expect(matchesMediaFilter(medio, mes, HOY)).toBe(false);
      expect(matchesMediaFilter(medio, anio, HOY)).toBe(true);
      expect(matchesMediaFilter(viejo, anio, HOY)).toBe(false);
      expect(matchesMediaFilter(viejo, antes, HOY)).toBe(true);
    });

    it("has nowhere to put a row with an unreadable date", () => {
      const antes: MediaFilter = { ...EMPTY_MEDIA_FILTER, added: "older" };
      const roto = pelicula({ createdAt: "no es una fecha" });
      expect(matchesMediaFilter(roto, antes, HOY)).toBe(false);
    });
  });

  describe("tags", () => {
    it("needs every chosen label to be on the row", () => {
      const dos: MediaFilter = { ...EMPTY_MEDIA_FILTER, tags: ["noche", "largo"] };
      const uno = pelicula({ tags: ["noche"] });
      expect(matchesMediaFilter(uno, dos, HOY)).toBe(false);
      expect(matchesMediaFilter(pelicula({ tags: ["noche", "largo"] }), dos, HOY)).toBe(true);
    });
  });

  it("narrows with every axis at once, not with the last one", () => {
    const filtro: MediaFilter = {
      type: "movie",
      decade: 1990,
      tags: ["noche"],
      text: "matrix",
      artwork: true,
      added: "older",
    };
    const buena = pelicula({
      title: "Matrix",
      tags: ["noche"],
      createdAt: "2019-01-01T00:00:00.000Z",
    });
    expect(matchesMediaFilter(buena, filtro, HOY)).toBe(true);

    // One axis wrong is enough to be out, and the axis that is wrong is the one
    // the caller changed last.
    expect(matchesMediaFilter({ ...buena, title: " Solaris" }, filtro, HOY)).toBe(false);
  });
});

describe("mediaFilterCount", () => {
  it("counts each axis once, and the labels one by one", () => {
    expect(mediaFilterCount(EMPTY_MEDIA_FILTER)).toBe(0);
    expect(
      mediaFilterCount({
        ...EMPTY_MEDIA_FILTER,
        type: "movie",
        decade: 1990,
        tags: ["a", "b"],
        text: "x",
        artwork: false,
        added: "month",
      }),
    ).toBe(7);
  });
});
