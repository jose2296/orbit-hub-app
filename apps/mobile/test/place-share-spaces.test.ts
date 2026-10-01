import { describe, expect, it } from "vitest";

import { spacesYouCanFileInto } from "../src/lib/shares/fileable-spaces";

/**
 * Which spaces the "where does this go" panel is allowed to offer.
 *
 * This exists because the panel offered every space in the sync cache, and the cache
 * holds spaces you are not a member of: the ones you can see because something inside
 * them was shared with you. `placeShare` checks membership on the server and refuses,
 * so the panel was offering rows that could only ever fail.
 *
 * The trap was total for a new person. Receiving your first shared thing means you
 * have no space of your own, so the cache held exactly one space — the sender's — and
 * it was the only row in the picker. One option, it never worked, and nothing on
 * screen said why: "You can only file it in one of your own spaces".
 *
 * `shared` and not `role`, because a `viewer` who was *invited* and a `viewer` who
 * was *given a list* are the same role and not the same thing, and only the second one
 * is `shared`. Testing on `role` here would pass on the invited viewer and fail on the
 * other one, which is the mistake this is guarding against.
 */
function space(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "w1",
    name: "Casa",
    role: "viewer",
    memberCount: 2,
    shared: false,
    ...over,
  } as never;
}

describe("espacios en los que se puede guardar lo recibido", () => {
  it("ofrece los espacios de los que eres miembro", () => {
    const mio = space({ id: "w1", name: "Mio", role: "owner", shared: false });
    const invitation = space({ id: "w2", name: "Invitado", role: "viewer", shared: false });

    expect(spacesYouCanFileInto([mio, invitation])).toEqual([mio, invitation]);
  });

  it("NO ofrece un espacio que solo ves porque te compartieron algo", () => {
    const deOtro = space({ id: "w9", name: "Casa de Ana", role: "viewer", shared: true });
    const mio = space({ id: "w1", name: "Mio", role: "owner", shared: false });

    // The one with `role: 'viewer'` is the interesting half: it is a real role, and it
    // still is not yours.
    expect(spacesYouCanFileInto([deOtro, mio])).toEqual([mio]);
  });

  it("deja vacia la lista cuando solo hay espacios ajenos", () => {
    // The new-person case, which is the one that produced the bug report.
    expect(spacesYouCanFileInto([space({ shared: true })])).toEqual([]);
  });

  it("un registro antiguo sin la marca `shared` se ofrece", () => {
    // A record cached before the flag existed has no `shared` at all. Offering a space
    // that turns out to be somebody else's costs one refused request; hiding a space
    // that is genuinely yours hides the only way to file at all. So the default is to
    // offer it.
    const sinMarca = { id: "w1", name: "Mio", role: "owner", memberCount: 1 } as never;
    expect(spacesYouCanFileInto([sinMarca])).toEqual([sinMarca]);
  });

  it("no muta la lista que le llega", () => {
    const original = [space({ id: "w1" }), space({ id: "w2", shared: true })];
    spacesYouCanFileInto(original);
    expect(original).toHaveLength(2);
  });
});