import type { Note, NoteTemplate } from "@orbit-hub/contracts";
import { describe, expect, it } from "vitest";

import { canEditTemplate } from "@/hooks/use-note-templates";
import { isNotePinned, noteWidget, withPinnedNote, withoutPinnedNote } from "@/lib/dashboard/pin";

function noteFor(over: Partial<Note> & { id: string }): Note {
  return {
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    workspaceId: "w1",
    folderId: null,
    title: "",
    document: "<p>x</p>",
    plainText: "x",
    tags: [],
    attachmentCount: 0,
    position: 0,
    role: "editor",
    shared: false,
    ...over,
  };
}

function templateFor(over: Partial<NoteTemplate> & { id: string }): NoteTemplate {
  return {
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    workspaceId: null,
    name: "Mia",
    description: "",
    icon: "document-text-outline",
    scope: "personal",
    document: "<p>x</p>",
    plainText: "x",
    builtInKey: null,
    createdBy: "u1",
    ...over,
  };
}

/**
 * A note on the panel.
 *
 * This replaced a star on the note, and the star is gone: it was a second way of
 * saying "I want this near me" that nothing acted on, and there were two of them
 * on screen — the star in the list and the card on the panel — saying the same
 * thing differently. These tests pin the card, which is the one that puts the
 * note somewhere.
 */
describe("pinning a note to the panel", () => {
  const note = noteFor({ id: "n1", title: "Recetas" });

  it("is a card that says which note it is", () => {
    const card = noteWidget(note);
    expect(card.kind).toBe("recent_notes");
    expect(card.settings?.["noteId"]).toBe("n1");
    // The title is written into the card so it still says what it was if the note
    // is deleted while the card is on the panel.
    expect(card.settings?.["title"]).toBe("Recetas");
  });

  it("lands on the page the person is looking at", () => {
    // The same rule as a list's card. A card added from page 3 that lands on page
    // 1 is a card that appears to have not been added.
    const threePages = [
      { ...noteWidget(noteFor({ id: "a" })), page: 0 },
      { ...noteWidget(noteFor({ id: "b" })), page: 1 },
      { ...noteWidget(noteFor({ id: "c" })), page: 2 },
    ];
    const layout = withPinnedNote(threePages, note, 2);
    expect(layout.find((w) => w.settings?.["noteId"] === "n1")?.page).toBe(2);
  });

  it("is one card, however many times it is pinned", () => {
    const once = withPinnedNote([], note, 0);
    const twice = withPinnedNote(once, note, 0);
    expect(twice).toBe(once);
    expect(twice.filter((w) => w.settings?.["noteId"] === "n1")).toHaveLength(1);
  });

  it("is found again by the note it belongs to", () => {
    const layout = withPinnedNote([], note, 0);
    expect(isNotePinned(layout, "n1")).toBe(true);
    expect(isNotePinned(layout, "otra")).toBe(false);
  });

  it("comes off the panel without touching the note", () => {
    // Removing the card is not deleting the note. It is the difference between
    // "stop showing this" and "throw this away", and a menu row that did both
    // would be the worst button in the app.
    const layout = withPinnedNote([], note, 0);
    const after = withoutPinnedNote(layout, "n1");
    expect(after).toHaveLength(0);
    expect(note.title).toBe("Recetas");
  });
});

/**
 * Which templates can be changed.
 *
 * The catalogue is code: it arrives with the build and is replaced by the build
 * after it, so an edit would be lost on the next update with no warning. Deciding
 * that from what the template carries — rather than asking — means the answer is
 * the same offline, on a fresh install, and on a device that has never synced.
 */
describe("which templates can be edited", () => {
  const yo = "u1";
  const otro = "u2";

  it("lets you change one of yours, personal or shared", () => {
    expect(canEditTemplate(templateFor({ id: "t1" }), yo)).toBe(true);
    expect(
      canEditTemplate(templateFor({ id: "t2", scope: "workspace", workspaceId: "w1" }), yo),
    ).toBe(true);
  });

  it("does not let you change one that comes with the app", () => {
    expect(
      canEditTemplate(
        templateFor({ id: "builtin:recipe", builtInKey: "recipe", scope: "public" }),
        yo,
      ),
    ).toBe(false);
  });

  it("lets you change one you published, and not one somebody else published", () => {
    // Publishing is "everybody may use this", and it stops there. One person's
    // recipe offered to the world is still that person's recipe; a catalogue
    // anybody can rewrite is a catalogue nobody trusts.
    expect(canEditTemplate(templateFor({ id: "t3", scope: "public" }), yo)).toBe(true);
    expect(canEditTemplate(templateFor({ id: "t4", scope: "public", createdBy: otro }), yo)).toBe(
      false,
    );
  });

  it("does not decide anything about no template", () => {
    expect(canEditTemplate(null, yo)).toBe(false);
  });
});
