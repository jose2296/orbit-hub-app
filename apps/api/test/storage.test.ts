import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isImageMime } from '@orbit-hub/contracts';

import {
  newStorageKey,
  storage,
  verifyLocalSignature,
} from '../src/modules/notes/storage';

/**
 * The local storage driver.
 *
 * It is the one piece of the notes feature that reads a path built from a value
 * that came out of a database, and a database is not a security boundary. A row
 * with `../../../etc/passwd` in its key and a driver that joins it blindly reads
 * anywhere the process can reach, so the two properties tested here are the ones
 * that stop that: the key is the server's, and a key that escapes is refused.
 */
describe('storage keys', () => {
  it('puts the key inside the note it belongs to', () => {
    const noteId = 'abcdef01-2345-4000-8000-000000000000';
    const key = newStorageKey(noteId, 'image/png');

    // The prefix is what `confirm` checks, so it has to be derivable from the note.
    expect(key.startsWith(`${noteId.slice(0, 2)}/${noteId}/`)).toBe(true);
    expect(key.endsWith('.png')).toBe(true);
  });

  it('never uses the name the client sent', () => {
    // Two files called `photo.png` must not collide, and a name is the one part
    // of the request the server does not need.
    const noteId = 'abcdef01-2345-4000-8000-000000000000';
    const first = newStorageKey(noteId, 'image/png');
    const second = newStorageKey(noteId, 'image/png');

    expect(first).not.toBe(second);
  });

  it('gives a different extension to a different kind of file', () => {
    const noteId = 'abcdef01-2345-4000-8000-000000000000';
    expect(newStorageKey(noteId, 'image/png')).toMatch(/\.png$/);
    expect(newStorageKey(noteId, 'image/jpeg')).toMatch(/\.jpg$/);
    expect(newStorageKey(noteId, 'application/pdf')).toMatch(/\.pdf$/);
  });
});

describe('isImageMime', () => {
  it('is what decides which size ceiling applies', () => {
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('application/pdf')).toBe(false);
    expect(isImageMime('text/plain')).toBe(false);
  });
});

describe('a local storage directory', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orbit-storage-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('refuses a key that points outside it', async () => {
    const driver = storage();
    if (driver.name !== 'local') {
      // The test environment uses the local driver; if it ever stops doing so this
      // test would pass without testing anything, so it says so.
      throw new Error(`This test needs the local driver and got "${driver.name}"`);
    }

    const escapes = [
      '../../etc/passwd',
      '/etc/passwd',
      'aa/bb/../../../../outside.txt',
      './../outside',
    ];

    for (const key of escapes) {
      await expect(driver.createUpload(key, 'image/png')).rejects.toThrow(/outside/i);
    }
  });

  it('accepts a key that stays inside it', async () => {
    const noteId = 'abcdef01-2345-4000-8000-000000000000';
    const key = newStorageKey(noteId, 'image/png');
    const ticket = await storage().createUpload(key, 'image/png');

    expect(ticket.key).toBe(key);
    expect(ticket.url).toContain('upload/');
  });

  it('refuses to confirm a file that is not there', async () => {
    const noteId = 'abcdef01-2345-4000-8000-000000000000';
    await expect(
      storage().confirm(newStorageKey(noteId, 'image/png'), 10),
    ).rejects.toThrow();
  });
});

describe('signed links', () => {
  /**
   * The round trip, through the real driver.
   *
   * The signature covers the key, the name and the expiry together, so a link
   * cannot be edited into a different file, a different name, or a longer life.
   * Testing the pieces separately would not catch a parameter that was left out of
   * what is signed, which is the only way this goes wrong.
   */
  it('accepts a link it just made', async () => {
    const key = 'aa/bbbbbbbb-cccc-4000-8000-000000000000/foto.png';
    const url = await storage().createDownload(key, 'foto.png', 'image/png');

    const query = new URL(url, 'http://localhost').searchParams;
    const verified = verifyLocalSignature(
      decodeURIComponent(url.split('/file/')[1]?.split('?')[0] ?? ''),
      query.get('name') ?? '',
      Number(query.get('expires')),
      query.get('signature') ?? '',
    );
    expect(verified).toBe(true);
  });

  it('refuses the same link with a different name', async () => {
    const key = 'aa/bbbbbbbb-cccc-4000-8000-000000000000/foto.png';
    const url = await storage().createDownload(key, 'foto.png', 'image/png');
    const query = new URL(url, 'http://localhost').searchParams;
    const expires = Number(query.get('expires'));
    const signature = query.get('signature') ?? '';

    // Renaming it in the URL is the cheapest edit there is, and it is what would
    // make a download claim to be a file it is not.
    expect(verifyLocalSignature(key, 'otro.png', expires, signature)).toBe(false);
    expect(verifyLocalSignature(key, 'foto.png', expires, signature)).toBe(true);
  });

  it('refuses the same link with a longer life', async () => {
    const key = 'aa/bbbbbbbb-cccc-4000-8000-000000000000/foto.png';
    const url = await storage().createDownload(key, 'foto.png', 'image/png');
    const query = new URL(url, 'http://localhost').searchParams;
    const signature = query.get('signature') ?? '';

    expect(verifyLocalSignature(key, 'foto.png', Number(query.get('expires')) + 86400, signature)).toBe(false);
  });

  it('refuses a different file with a real signature', async () => {
    const key = 'aa/bbbbbbbb-cccc-4000-8000-000000000000/foto.png';
    const url = await storage().createDownload(key, 'foto.png', 'image/png');
    const query = new URL(url, 'http://localhost').searchParams;
    const signature = query.get('signature') ?? '';
    const expires = Number(query.get('expires'));

    expect(
      verifyLocalSignature('aa/bbbbbbbb-cccc-4000-8000-000000000000/otra.png', 'foto.png', expires, signature),
    ).toBe(false);
  });

  it('refuses an expired link whatever the signature says', () => {
    expect(verifyLocalSignature('aa/bb/file.png', 'file.png', 1, 'cualquiera')).toBe(false);
  });
});
