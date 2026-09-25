import { API_PREFIX } from '@orbit-hub/config';
import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { corsOrigins, env, isProduction } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { requestContext } from './middleware/request-context.js';
import { apiRouter } from './routes/index.js';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContext);
  app.use(
    helmet({
      // The API serves JSON only; the web app is served from its own origin.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        // Native clients and curl send no Origin header.
        if (!origin || corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  app.get('/', (_req, res) => {
    res.json({ data: { name: 'OrbitHub API', version: API_PREFIX, docs: '/docs' } });
  });

  app.use(API_PREFIX, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  if (!isProduction) {
    app.locals['logger'] = logger;
  }

  return app;
}

export { env };
