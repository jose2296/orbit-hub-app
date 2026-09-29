/**
 * Everything a session wrote, gone.
 *
 * The cache, the outbox and the pull cursor belong to the session that wrote them.
 * `signOut` removed the tokens and left all three, so the next person to sign in
 * on that browser was shown the previous one's spaces, folders and note titles
 * while the server answered `items: []` — the two halves of the app disagreeing,
 * and the half a person could see belonged to somebody else.
 *
 * It is its own module and not a line inside `auth-client` because the local store
 * is not the auth client's business: that module talks to the server and holds
 * tokens, and reaching into the outbox from there would make the two impossible to
 * change apart — or to test, since importing the store into the auth client drags
 * SQLite into every test that touches a token.
 */
export async function forgetEverything(): Promise<void> {
  try {
    const { getLocalStoreReady } = await import('@/lib/offline/local-store');
    const store = await getLocalStoreReady();
    // `reset` for the outbox and the conflicts, `clearCache` for the rows and the
    // app state. Both, and not one: the outbox is what would push the previous
    // person's unsent writes under the *new* session's token.
    await store.reset();
    await store.clearCache();
  } catch {
    // Signing out has to work. The tokens are already gone by the time this runs,
    // and that is the part that is a security matter; rows left behind are a mess
    // the next sign-in can clean up.
  }
}
