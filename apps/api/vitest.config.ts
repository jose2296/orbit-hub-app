import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
    env: {
      NODE_ENV: 'test',
      // Captures emails in memory so tests can read the verification links.
      EMAIL_TRANSPORT: 'noop',
      LOG_LEVEL: 'silent',
      // The suite runs from a single IP; throttling is unit tested separately.
      AUTH_RATE_LIMIT_MAX: '100000',
      AUTH_ACCOUNT_RATE_LIMIT_MAX: '100000',
      /**
       * Files go to a throwaway directory, not to the developer's.
       *
       * The default is `.data/attachments` beside the API, which is where a real
       * upload belongs. A test that wrote there would leave its own files in the
       * working copy — a test suite that needs a second `git clean` is a test
       * suite nobody runs twice.
       */
      STORAGE_LOCAL_DIR: fileURLToPath(
        new URL(join(tmpdir(), 'orbithub-test-attachments'), import.meta.url),
      ),
    },
  },
});
