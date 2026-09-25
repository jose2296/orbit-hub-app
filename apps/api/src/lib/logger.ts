import pino from 'pino';

import { env, isProduction } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'orbit-hub-api', env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      '*.refreshToken',
      '*.accessToken',
      'googleClientSecret',
    ],
    censor: '[redacted]',
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino/file',
          options: { destination: 1 },
        },
      }),
});

export type Logger = typeof logger;
