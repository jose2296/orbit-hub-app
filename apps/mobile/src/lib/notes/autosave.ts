import { noteDocumentSchema } from "@orbit-hub/contracts";

/**
 * Autosave for a note.
 *
 * The editor is uncontrolled and the app is local first, so this is the whole
 * rule: a keystroke schedules a save, a save is not taken until the writing
 * stops, and leaving the screen takes the pending save with it rather than
 * dropping it.
 *
 * It is its own module with no React in it because the timing is the part worth
 * testing, and a debounce that only works when a screen is mounted cannot be
 * tested at all.
 */

/** How long the writing has to stop before the note is saved. */
export const AUTOSAVE_DELAY_MS = 800;

export interface AutosaveResult {
  saved: boolean;
  /** Why it was not saved, when it was not. */
  reason?: "invalid" | "failed" | "unchanged" | "cancelled";
  error?: unknown;
}

export interface AutosaveOptions {
  /**
   * Reads the document out of the editor.
   *
   * A function and not the HTML itself because the library parses HTML on every
   * keystroke if you let it, and warns about exactly that. `onChangeText` says
   * something changed; this is called later, once, when it is worth the cost.
   */
  read: () => Promise<string>;
  /** Writes it. Should not throw for a document it cannot store. */
  save: (document: string) => Promise<void>;
  delayMs?: number;
  onSaved?: (result: AutosaveResult) => void;
  onError?: (error: unknown) => void;
}

export interface Autosave {
  /** Call on every keystroke. Restarts the clock. */
  schedule(): void;
  /** Save now if anything is pending. Called on background and on leaving. */
  flush(): Promise<AutosaveResult | null>;
  /** Forget a pending save without running it. Used when the note goes away. */
  cancel(): void;
  /** Is there a save waiting to happen? The UI shows a dot for this. */
  isPending(): boolean;
}

/**
 * A note being saved is checked against the format before it is written.
 *
 * The editor only produces HTML we accept, so this is not about the editor. It
 * is about a document that came from the cache, from another device, or from a
 * future build that knows a tag this one does not: writing it would store
 * something the next reader cannot render, and the rule in `notes-editor.md` is
 * that a document which fails validation is never written.
 *
 * It returns the document to store, which is not always the one it was given:
 * the web build of the editor hands over a whole `<html>` document and the
 * stored form is the body, so the two platforms end up with the same note rather
 * than two notes that look the same.
 */
export function storableDocument(document: string): string | null {
  const result = noteDocumentSchema.safeParse(document);
  return result.success ? result.data : null;
}

export function isStorableDocument(document: string): boolean {
  return storableDocument(document) !== null;
}

export function createAutosave(options: AutosaveOptions): Autosave {
  const delay = options.delayMs ?? AUTOSAVE_DELAY_MS;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  /** Set by `cancel`, read by the save so a cancelled note is not written. */
  let cancelled = false;
  let inFlight: Promise<AutosaveResult | null> | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const run = async (): Promise<AutosaveResult | null> => {
    clear();
    if (!pending) return null;
    if (cancelled) {
      pending = false;
      return { saved: false, reason: "cancelled" };
    }

    pending = false;

    let document: string;
    try {
      document = await options.read();
    } catch (error) {
      options.onError?.(error);
      const result: AutosaveResult = { saved: false, reason: "failed", error };
      options.onSaved?.(result);
      return result;
    }

    if (cancelled) {
      return { saved: false, reason: "cancelled" };
    }

    const storable = storableDocument(document);
    if (storable === null) {
      // Not an error the person can act on and not something to show as one: the
      // document is left as it is and the next save tries again with whatever
      // the editor has then.
      const result: AutosaveResult = { saved: false, reason: "invalid" };
      options.onSaved?.(result);
      return result;
    }

    try {
      // The body, not whatever the editor wrapped it in.
      await options.save(storable);
      const result: AutosaveResult = { saved: true };
      options.onSaved?.(result);
      return result;
    } catch (error) {
      options.onError?.(error);
      const result: AutosaveResult = { saved: false, reason: "failed", error };
      options.onSaved?.(result);
      return result;
    }
  };

  return {
    schedule(): void {
      pending = true;
      cancelled = false;
      clear();
      timer = setTimeout(() => {
        timer = null;
        inFlight = run().finally(() => {
          inFlight = null;
        });
      }, delay);
    },

    /**
     * Save now.
     *
     * A save already running is awaited rather than started again: two writes of
     * the same document in a row is the last-write-wins case the version check
     * exists to catch, and the cheapest way not to cause it is not to queue it.
     */
    async flush(): Promise<AutosaveResult | null> {
      clear();
      if (inFlight) {
        await inFlight;
        // Something may have been typed while the previous save ran.
        return pending ? run() : null;
      }
      return run();
    },

    cancel(): void {
      clear();
      cancelled = true;
      pending = false;
    },

    isPending(): boolean {
      return pending;
    },
  };
}
