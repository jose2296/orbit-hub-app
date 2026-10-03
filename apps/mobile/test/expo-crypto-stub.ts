/**
 * The bit of `expo-crypto` a Node test can actually have.
 *
 * The module cannot be loaded outside a device bundle, and the first thing that
 * fails is a global Metro defines:
 *
 *   ReferenceError: __DEV__ is not defined
 *   node_modules/expo-modules-core/src/sweet/setUpJsLogger.fx.ts:9:1
 *
 * `expo-crypto` reaches for `expo-modules-core` at import time, so a test that
 * touches a module that mints an id fails before a single assertion runs — and
 * the error says nothing about what was being tested. `react-native` is aliased
 * here for the same reason and with the same trade: the file cannot be read at
 * all, so it is replaced rather than mocked.
 *
 * **`randomUUID()` answers with the platform's own, on purpose.** Node has Web
 * Crypto, the app has the native one, and both give a fresh uuid. A stub that
 * returned a constant would be enough to load the module and useless to test:
 * "two boards never share a column" and "every column has an id of its own"
 * would pass against a `board.ts` that minted one id and handed it out again,
 * which is the bug those tests exist for.
 *
 * **This is partial and there is no more of it than there is here.**
 * `digestStringAsync`, `CryptoDigestAlgorithm` and `CryptoEncoding` are missing,
 * and `google-auth.ts:127-132` uses all three. No test imports that module today,
 * so nothing is broken; the first one that does gets a
 * `TypeError: ... is not a function` about a name in this file instead of the
 * `__DEV__` that explains why the real module cannot be loaded, and that sends
 * the search somewhere else. A test that needs them has to add them here, and the
 * comment above is the reason it was not done blind: a stub is here to answer the
 * platform's question, not to stand in for the module.
 */
export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}
