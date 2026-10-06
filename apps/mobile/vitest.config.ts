import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The app imports through `@/…`; without this a test cannot import any
    // module that reaches for a sibling through the alias.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // React Native's entry point is Flow, so a test that reaches for it cannot
      // even be parsed. The stub answers `Platform` and the handful of modules a
      // configuration file asks for; see the file for why.
      'react-native': fileURLToPath(new URL('./test/react-native-stub.ts', import.meta.url)),
      // Same reason, one module further down: `expo-crypto` reaches for
      // `expo-modules-core`, which reads a `__DEV__` global that only Metro
      // defines, so a test that touches anything that mints an id dies at import
      // with an error about a global. The stub answers with the platform's own
      // uuid rather than with a constant.
      'expo-crypto': fileURLToPath(new URL('./test/expo-crypto-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: true,
  },
});
