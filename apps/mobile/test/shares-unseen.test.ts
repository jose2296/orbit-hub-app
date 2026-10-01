import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The count behind the badge.
 *
 * Written against a fake store rather than the real one because `key-value.ts` reads
 * `window.localStorage`, which is not what is being tested: what is being tested is
 * *what counts as unseen*, and that needs the clock and the stored value under
 * control.
 */
const guardada = new Map<string, string>();

vi.mock("../src/lib/storage/key-value", () => ({
  keyValueStore: {
    get: (k: string) => (guardada.has(k) ? guardada.get(k)! : null),
    set: (k: string, v: string) => void guardada.set(k, v),
    remove: (k: string) => void guardada.delete(k),
  },
}));

const { countUnseen, lastSeenAt, markAllSeen } = await import("../src/lib/shares/last-seen");

const llega = (titulo: string, creada: string) =>
  ({
    id: `id-${titulo}`,
    nodeType: "list" as const,
    title: titulo,
    ownerName: "Ana",
    createdAt: creada,
  });

beforeEach(() => guardada.clear());

describe("lo que no has mirado todavia", () => {
  it("sin nada guardado, cuenta todo: no lo has mirado nunca", () => {
    // Deliberate, and the alternative hides anything that arrived while logged out.
    expect(countUnseen([llega("A", "2026-01-01T10:00:00Z")], "ana")).toBe(1);
  });

  it("despues de mirar, no cuenta lo que ya estaba", () => {
    markAllSeen("ana", Date.parse("2026-01-02T12:00:00Z"));
    expect(
      countUnseen(
        [llega("vieja", "2026-01-01T10:00:00Z"), llega("masVieja", "2025-12-31T10:00:00Z")],
        "ana",
      ),
    ).toBe(0);
  });

  it("despues de mirar, cuenta lo que ha llegado despues", () => {
    markAllSeen("ana", Date.parse("2026-01-02T12:00:00Z"));
    expect(
      countUnseen(
        [
          llega("vieja", "2026-01-01T10:00:00Z"),
          llega("nueva", "2026-01-03T09:00:00Z"),
          llega("otraNueva", "2026-01-04T09:00:00Z"),
        ],
        "ana",
      ),
    ).toBe(2);
  });

  it("lo de este mismo instante cuenta como visto; un milisegundo despues, no", () => {
    /*
     * `markAllSeen` stamps the moment the drawer opened, so an invitation created in
     * that exact millisecond sits **on** the line.
     *
     * It counts as seen, and that is a decision rather than an accident. The other
     * choice — `>=` — counts it as unseen, which puts a phantom "1" in the badge for
     * one cycle about something nobody can see, and the line moves past it on the next
     * open anyway. The cost the other way is a one-millisecond window in which
     * something arrives after the list was drawn and is treated as seen; it clears on
     * the next open, and it is the only window this rule has.
     */
    const instante = Date.parse("2026-01-02T12:00:00Z");
    markAllSeen("ana", instante);
    expect(countUnseen([llega("justo", "2026-01-02T12:00:00.000Z")], "ana")).toBe(0);
    expect(countUnseen([llega("unMSDespues", "2026-01-02T12:00:00.001Z")], "ana")).toBe(1);
  });

  it("son cuentas distintas: mirar como Ana no limpia lo de Beto", () => {
    // One key for everybody would mean opening the drawer as Ana hides Beto's badge,
    // and the next thing to arrive is invisible.
    markAllSeen("ana", Date.parse("2026-06-01T00:00:00Z"));
    expect(countUnseen([llega("paraBeto", "2026-01-01T00:00:00Z")], "beto")).toBe(1);
    expect(countUnseen([llega("paraBeto", "2026-01-01T00:00:00Z")], "ana")).toBe(0);
  });

  it("una fecha ilegible se cuenta como no vista", () => {
    // A share you cannot date is not a share you have seen. Counting it as seen is
    // the failure that hides a real invitation.
    markAllSeen("ana", Date.parse("2026-01-02T12:00:00Z"));
    expect(countUnseen([llega("rota", "no-es-una-fecha")], "ana")).toBe(1);
  });

  it("un valor guardado que no es un numero no tapa nada", () => {
    // A wiped key, or a future version of the file that stored something else. Read as
    // "seen at the beginning of time" it would hide everything.
    guardada.set("orbit.shares.lastSeen.ana", "ayer");
    expect(lastSeenAt("ana")).toBeNull();
    expect(countUnseen([llega("A", "2026-01-01T10:00:00Z")], "ana")).toBe(1);
  });

  it("una lista vacia es cero, y no es un error", () => {
    expect(countUnseen([], "ana")).toBe(0);
    markAllSeen("ana", Date.parse("2026-01-02T12:00:00Z"));
    expect(countUnseen([], "ana")).toBe(0);
  });
});