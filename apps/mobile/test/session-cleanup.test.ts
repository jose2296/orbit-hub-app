import { describe, expect, it, vi } from 'vitest';

/**
 * What signing out has to take with it.
 *
 * The cache, the outbox and the pull cursor all belong to the session that wrote
 * them, and for a long time signing out removed the tokens and left every one of
 * them. The next person to sign in on that browser was shown the previous one's
 * spaces, folders and note titles while the server answered `items: []` — the two
 * halves of the app disagreeing, and the half a person could see belonged to
 * somebody else.
 *
 * These tests are about the *contract* between signing out and the store, so they
 * stub the store and assert what was asked of it. What a store does when it is
 * told to delete is its own tests' business.
 */

const store = {
  reset: vi.fn(async () => undefined),
  clearCache: vi.fn(async () => undefined),
};

vi.mock('../src/lib/offline/local-store', () => ({
  getLocalStoreReady: async () => store,
}));

describe('forgetEverything', () => {
  it('empties the outbox and the cache', async () => {
    const { forgetEverything } = await import('../src/lib/auth/forget-everything');

    await forgetEverything();

    expect(store.reset).toHaveBeenCalledTimes(1);
    expect(store.clearCache).toHaveBeenCalledTimes(1);
  });

  it('still finishes when the store cannot be reached', async () => {
    // Signing out has to work. Failing to delete local rows is a reason to carry
    // on, not a reason to leave somebody signed in.
    const failing = {
      reset: vi.fn(async () => {
        throw new Error('no store');
      }),
      clearCache: vi.fn(async () => {
        throw new Error('no store');
      }),
    };
    vi.doMock('../src/lib/offline/local-store', () => ({
      getLocalStoreReady: async () => failing,
    }));
    vi.resetModules();

    const { forgetEverything } = await import('../src/lib/auth/forget-everything');
    await expect(forgetEverything()).resolves.toBeUndefined();
  });
});
