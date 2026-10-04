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
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'e2e/**/*.test.ts'],
    globals: true,
  },
});
