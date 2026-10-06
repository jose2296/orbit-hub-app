import { describe, expect, it } from "vitest";

import type { DashboardWidget, Folder, List } from "@orbit-hub/contracts";

import {
  folderWidget,
  isFolderPinned,
  isFolderWidget,
  isListWidget,
  isPinned,
  listWidget,
  widgetIcon,
  withPinnedFolder,
  withPinnedList,
  withoutPinnedFolder,
  withoutPinnedList,
} from "../src/lib/dashboard/pin";
import {
  CARD_SIZES,
  pageOf,
} from "../src/lib/dashboard/panel";

/**
 * Pinning a list to the panel.
 *
 * A pinned list is a card that says which list it is and not a copy of it, so the
 * three mistakes worth preventing are a second card for a list that already has
 * one, a card on a screen that has no room, and a card on a screen nobody can get
 * to.
 */
function list(partial: Partial<List> = {}): List {
  return {
    id: "l1",
    version: 1,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    workspaceId: "w1",
    folderId: null,
    kind: "tasks",
    role: "owner",
    shared: false,
    title: "Compra",
    description: null,
    icon: null,
    tags: [],
    tagColors: {},
    position: 0,
    itemCount: 0,
    orderMode: "manual",
    ...partial,
  };
}

const tasks: DashboardWidget = {
  id: "tasks",
  kind: "tasks",
  x: 0,
  y: 0,
  w: 6,
  h: 4,
  page: 0,
  pinned: false,
};

/**
 * Six cards of two by two, which is exactly a full screen of four columns by six
 * rows.
 *
 * Two by two and not the smallest size: six of the smallest leave most of the
 * screen empty, so a "full" screen built that way is not full, and every test
 * about running out of room passes for the wrong reason.
 */
function fullScreen() {
  return Array.from({ length: 6 }, (_, i) => ({
    ...tasks,
    id: `llena${i}`,
    w: 2,
    h: 2,
    x: (i % 2) * 2,
    y: Math.floor(i / 2) * 2,
  }));
}

describe("withPinnedList", () => {
  it("adds a card that says which list it is", () => {
    const layout = withPinnedList([tasks], list());
    const card = layout.at(-1);

    expect(card?.id).toBe("list:l1");
    expect(card?.pinned).toBe(true);
    expect(card?.settings?.["listId"]).toBe("l1");
  });

  it("does not add a second card for a list that already has one", () => {
    // Pinning twice from two screens is one card, not two that hide each other.
    const once = withPinnedList([tasks], list());
    const twice = withPinnedList(once, list());

    expect(twice).toHaveLength(2);
    expect(twice).toBe(once);
  });

  it("puts the card on the first screen that has room for it", () => {
    // A seventh pin has nowhere to go on a full screen. Pinning it there
    // anyway is how a card ends up drawn on top of another one.
    const layout = withPinnedList(fullScreen(), list());
    const added = layout.at(-1);

    expect(added).toBeDefined();
    expect(pageOf(added!)).toBe(1);
  });

  it("does not invent a screen when the one it is on has room", () => {
    // The other half of the case above. One card of the smallest size leaves most
    // of the screen empty, and a card pinned there belongs on the same screen —
    // putting it on a new one would fill the panel with screens of one card each.
    const half = [{ ...tasks, w: 2, h: 2, x: 0, y: 0 }];
    const layout = withPinnedList(half, list());

    expect(pageOf(layout.at(-1)!)).toBe(0);
  });

  it("keeps pinning to the same screen while there is room", () => {
    const one = withPinnedList([], list({ id: "l1" }));
    const two = withPinnedList(one, list({ id: "l2" }));
    const three = withPinnedList(two, list({ id: "l3" }));

    // Six cards of the smallest size fill a screen of four columns by six rows,
    // and three of them are nowhere near that. All on the first one.
    expect(pageOf(three[0]!)).toBe(0);
    expect(pageOf(three[1]!)).toBe(0);
    expect(pageOf(three[2]!)).toBe(0);
  });

  it("leaves the array it is given alone", () => {
    const before = [tasks];
    withPinnedList(before, list());
    expect(before).toEqual([tasks]);
  });
});

describe("withoutPinnedList", () => {
  it("takes out the card of that list and only that one", () => {
    const layout = withPinnedList([tasks], list());
    const other = withPinnedList(layout, list({ id: "l2", title: "Vacaciones" }));

    const after = withoutPinnedList(other, "l1");
    expect(after.map((widget) => widget.id)).toEqual(["tasks", "list:l2"]);
  });

  it("leaves a list that was not pinned alone", () => {
    expect(withoutPinnedList([tasks], "l1")).toEqual([tasks]);
  });
});

describe("isPinned", () => {
  it("says which lists have a card", () => {
    const layout = withPinnedList([], list());
    expect(isPinned(layout, "l1")).toBe(true);
    expect(isPinned(layout, "l2")).toBe(false);
  });

  it("is not fooled by a card that has no list in its settings", () => {
    expect(isPinned([tasks], "l1")).toBe(false);
  });
});

/**
 * Pinning a folder.
 *
 * A folder is a place you can jump to, the same as a list, and the panel was
 * asked for both. What is worth testing here is that they are the *same kind of
 * thing*: a folder card and a list card differ in a kind string and an id prefix,
 * and everything about where it lands and what happens when it is already there
 * is shared.
 */
describe("withPinnedFolder", () => {
  const folder = (partial: Partial<Folder> = {}): Folder => ({
    id: "d1",
    workspaceId: "w1",
    parentId: null,
    name: "Viajes",
    icon: { type: "emoji", value: "✈️", color: "auto" },
    position: 0,
    version: 1,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    role: "owner",
    shared: false,
    ...partial,
  });

  it("makes a card that opens the folder", () => {
    const card = folderWidget(folder());
    expect(card.kind).toBe("folder");
    expect(card.id).toBe("folder:d1");
    expect(card.settings?.["folderId"]).toBe("d1");
    expect(card.settings?.["workspaceId"]).toBe("w1");
    // A size the panel can actually draw, not a leftover from the old grid.
    expect(CARD_SIZES).toContainEqual({ w: card.w, h: card.h });
  });

  it("is one card, however many times it is pinned", () => {
    const once = withPinnedFolder([], folder());
    const twice = withPinnedFolder(once, folder());
    expect(twice).toHaveLength(1);
    expect(twice).toBe(once);
  });

  it("is a different card from the list of the same id", () => {
    // A list and a folder can have the same uuid — they are different tables — and
    // the panel would end up with one card standing in for both if the id were
    // not namespaced.
    const layout = withPinnedList([], list({ id: "d1" }));
    const withBoth = withPinnedFolder(layout, folder());
    expect(withBoth).toHaveLength(2);
    expect(withBoth.map((widget) => widget.id)).toEqual(["list:d1", "folder:d1"]);
  });

  it("goes to the first screen with room, like a list", () => {
    expect(pageOf(withPinnedFolder(fullScreen(), folder()).at(-1)!)).toBe(1);
  });

  it("takes out the card of that folder and only that one", () => {
    const layout = withPinnedFolder(withPinnedList([], list()), folder());
    const after = withoutPinnedFolder(layout, "d1");
    expect(after.map((widget) => widget.id)).toEqual(["list:l1"]);
  });

  it("is not fooled by a list card when asked about a folder", () => {
    // Both use `settings`, and a folder card with no id in it must not answer
    // about a list or vice versa.
    const layout = withPinnedList([], list({ id: "d1" }));
    expect(isFolderPinned(layout, "d1")).toBe(false);
    expect(isPinned(withPinnedFolder([], folder()), "d1")).toBe(false);
  });

  it("tells the two kinds apart", () => {
    expect(isFolderWidget(folderWidget(folder()))).toBe(true);
    expect(isListWidget(folderWidget(folder()))).toBe(false);
    expect(isListWidget(listWidget(list()))).toBe(true);
    expect(isFolderWidget(listWidget(list()))).toBe(false);
  });
});

describe("widgetIcon", () => {
  it("lee el icono entero que guardo el pin", () => {
    const icono = { type: "vector", value: "carpeta", library: "ionicons", style: "fill", color: "blue" } as const;
    expect(widgetIcon({ icon: { ...icono } })).toEqual({ ...icono });
  });

  it("lee el emoji suelto de los pines de antes", () => {
    // Los pines de antes de que hubiera iconos guardaban el emoji como texto.
    // Un panel ordenado hace meses no es algo que una build nueva pueda olvidar.
    expect(widgetIcon({ emoji: "🏠" })).toEqual({ type: "emoji", value: "🏠", color: "auto" });
  });

  it("prefiere el icono al emoji cuando hay los dos", () => {
    expect(
      widgetIcon({
        icon: { type: "emoji", value: "🛒", color: "auto" },
        emoji: "🏠",
      }),
    ).toEqual({ type: "emoji", value: "🛒", color: "auto" });
  });

  it("sin nada es sin icono, no un error", () => {
    expect(widgetIcon({})).toBeNull();
    expect(widgetIcon({ emoji: "" })).toBeNull();
    expect(widgetIcon({ icon: { type: "vector", value: "no-existe", library: "ionicons" } })).toBeNull();
  });
});
