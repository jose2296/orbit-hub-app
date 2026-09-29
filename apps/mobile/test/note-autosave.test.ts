import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTOSAVE_DELAY_MS,
  createAutosave,
  isStorableDocument,
  storableDocument,
} from '../src/lib/notes/autosave';

/**
 * Autosave timing.
 *
 * The failure this exists to prevent is a note that looks saved and is not. The
 * editor is uncontrolled and the app is local first, so the only thing standing
 * between a keystroke and the outbox is this timer, and a timer that is wrong in
 * either direction loses somebody's writing: too eager and every word becomes a
 * row in the outbox, too lazy and the last paragraph before closing the app is
 * gone.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const DOC = '<p>Seis tomates</p>';

describe('createAutosave', () => {
  it('does not save while the person is still writing', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave({ read: async () => DOC, save });

    autosave.schedule();
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('waits for the writing to stop, not for the first keystroke', async () => {
    // A paragraph typed in two seconds is one save, not forty. Every keystroke
    // restarts the clock.
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave({ read: async () => DOC, save });

    for (let typed = 0; typed < 20; typed += 1) {
      autosave.schedule();
      vi.advanceTimersByTime(100);
    }
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('reads the document once per save, not once per keystroke', async () => {
    // The library parses HTML on every keystroke if you let it, and warns about
    // exactly that. `read` is the expensive part, so its count is the thing to
    // watch.
    const read = vi.fn().mockResolvedValue(DOC);
    const autosave = createAutosave({ read, save: async () => undefined });

    for (let typed = 0; typed < 10; typed += 1) {
      autosave.schedule();
      vi.advanceTimersByTime(50);
    }
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('saves what the editor holds, not what was there when the note opened', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave({
      read: async () => '<p>Lo que se ha escrito ahora</p>',
      save,
    });

    autosave.schedule();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(save).toHaveBeenCalledWith('<p>Lo que se ha escrito ahora</p>');
  });

  it('flushes on the way out rather than dropping the pending save', async () => {
    // The screen closing is the last chance. Losing the last paragraph because
    // the timer had not fired yet is the whole failure mode.
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave({ read: async () => DOC, save });

    autosave.schedule();
    vi.advanceTimersByTime(100);
    const result = await autosave.flush();

    expect(result).toEqual({ saved: true });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('has nothing to flush when nothing was written', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave({ read: async () => DOC, save });

    expect(await autosave.flush()).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('does not save twice when a flush lands on a save already running', async () => {
    // Two writes of the same document in a row is the last-write-wins case the
    // version check exists to catch. Not queuing it is the cheapest way not to
    // cause it.
    let releaseSave = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const save = vi.fn().mockImplementation(async () => {
      await gate;
    });

    const autosave = createAutosave({ read: async () => DOC, save });
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);

    const flushing = autosave.flush();
    releaseSave();
    await flushing;

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves what was typed while a save was running', async () => {
    // The person kept writing during the save. That writing is not lost just
    // because it arrived mid-flight.
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    const save = vi.fn().mockImplementation(async () => {
      if (first) {
        first = false;
        await gate;
      }
    });

    const autosave = createAutosave({ read: async () => DOC, save });
    autosave.schedule();
    // Let the first save start and get as far as the gate.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);

    // Written while the save is still in the air.
    autosave.schedule();
    release();
    await autosave.flush();

    expect(save).toHaveBeenCalledTimes(2);
  });

  it('refuses to write a document that is not in the format', async () => {
    // The editor does not produce these. A cache from another device or a future
    // build can, and `notes-editor.md` says such a document is never written.
    const save = vi.fn().mockResolvedValue(undefined);
    const onSaved = vi.fn();
    const autosave = createAutosave({
      read: async () => '<p>hola</p><script>alert(1)</script>',
      save,
      onSaved,
    });

    autosave.schedule();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(save).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith({ saved: false, reason: "invalid" });
  });

  it('reports a failing save instead of pretending it worked', async () => {
    const save = vi.fn().mockRejectedValue(new Error('disk full'));
    const onError = vi.fn();
    const onSaved = vi.fn();
    const autosave = createAutosave({ read: async () => DOC, save, onError, onSaved });

    autosave.schedule();
    const result = await autosave.flush();

    expect(save).toHaveBeenCalled();
    expect(result?.saved).toBe(false);
    expect(result?.reason).toBe('failed');
    expect(onError).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ saved: false }));
  });

  it('reports a failing read rather than saving what it does not have', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave({
      read: async () => {
        throw new Error('editor not ready');
      },
      save,
    });

    autosave.schedule();
    const result = await autosave.flush();

    expect(save).not.toHaveBeenCalled();
    expect(result?.reason).toBe('failed');
  });

  it('does not write a note that was cancelled', async () => {
    // The note is gone, the screen is going away, and the timer was already
    // running. Writing it now would resurrect it.
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave({ read: async () => DOC, save });

    autosave.schedule();
    autosave.cancel();
    const result = await autosave.flush();

    expect(save).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('does not write a note that was cancelled while a save was running', async () => {
    const save = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const autosave = createAutosave({ read: async () => DOC, save });

    autosave.schedule();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    autosave.cancel();
    await vi.runAllTimersAsync();

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('says whether there is something waiting, so the UI can show it', () => {
    const autosave = createAutosave({ read: async () => DOC, save: async () => undefined });

    expect(autosave.isPending()).toBe(false);
    autosave.schedule();
    expect(autosave.isPending()).toBe(true);
    autosave.cancel();
    expect(autosave.isPending()).toBe(false);
  });

  it('honours a different delay, because the tests need it and a screen might', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave({ read: async () => DOC, save, delayMs: 50 });

    autosave.schedule();
    await vi.advanceTimersByTimeAsync(50);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('isStorableDocument', () => {
  it('accepts what the editor produces', () => {
    expect(isStorableDocument('<h2>Salsa</h2><p>Seis tomates</p>')).toBe(true);
    expect(isStorableDocument('')).toBe(true);
  });

  it('refuses what the editor does not', () => {
    expect(isStorableDocument('<p>a</p><script>x</script>')).toBe(false);
    expect(isStorableDocument('<p style="color:red">a</p>')).toBe(false);
    expect(isStorableDocument('<table><tr><td>a</td></tr></table>')).toBe(false);
  });
});

/**
 * The web build of the editor hands over a whole `<html>` document and the native
 * one hands over the body. That is not a difference in the format, it is a
 * difference in how the two read the same editor's value — and it was only found
 * by running the app, because every test until then wrote the markup by hand.
 */
describe('the document the editor hands over', () => {
  it('accepts a whole document and stores the body', () => {
    expect(isStorableDocument('<html><p>Hola <b>mundo</b></p></html>')).toBe(true);
    expect(storableDocument('<html><p>Hola <b>mundo</b></p></html>')).toBe(
      '<p>Hola <b>mundo</b></p>',
    );
  });

  it('stores the same bytes whatever the platform wrote it', () => {
    // Two notes that look identical and are stored differently is the same class
    // of bug as two notes that are one.
    expect(storableDocument('<html><p>a</p></html>')).toBe(storableDocument('<p>a</p>'));
  });

  it('does not grow a wrapper per round trip', () => {
    let stored = '<p>hola</p>';
    for (let round = 0; round < 5; round += 1) {
      stored = `<html>${stored}</html>`;
      stored = storableDocument(stored) as string;
    }
    expect(stored).toBe('<p>hola</p>');
  });

  it('does not let the wrapper become a way in', () => {
    // Stripping a wrapper must not become stripping safety: a script inside the
    // document is still refused, wrapped or not.
    expect(isStorableDocument('<html><p>a</p><script>x</script></html>')).toBe(false);
    expect(storableDocument('<!DOCTYPE html><html><head><title>t</title></head><body><script>x</script></body></html>')).toBeNull();
  });

  it('saves the body and not the wrapper', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave({
      read: async () => '<html><p>Hola <b>mundo</b></p></html>',
      save,
    });

    autosave.schedule();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(save).toHaveBeenCalledWith('<p>Hola <b>mundo</b></p>');
    const result = { saved: true };
    expect(result.saved).toBe(true);
  });
});

