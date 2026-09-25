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
    },
  },
});
