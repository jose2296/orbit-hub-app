import { healthResponseSchema } from '@orbit-hub/contracts';
import { Router } from 'express';

import { env } from '../config/env.js';
import { pingDatabase } from '../db/client.js';

export const healthRouter = Router();

/**
 * Liveness + readiness in one endpoint: the mobile app uses it to decide
 * whether the API is reachable. Mounted at `/health`, hence the root path here.
 */
healthRouter.get('/', async (_req, res) => {
  const database = await pingDatabase();
  const status = database.ok ? 'ok' : 'degraded';

  const payload = healthResponseSchema.parse({
    status,
    service: 'orbit-hub-api',
    version: process.env['npm_package_version'] ?? '0.1.0',
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    checks: {
      database: {
        status: database.ok ? 'ok' : 'down',
        latencyMs: database.latencyMs,
      },
      // A process can be running with a different transport than the .env file
      // suggests, and "the emails never arrive" is otherwise invisible until
      // someone reads the logs.
      email: {
        transport: env.EMAIL_TRANSPORT,
        delivers: env.EMAIL_TRANSPORT === 'resend',
      },
    },
    timestamp: new Date().toISOString(),
  });

  res.status(status === 'ok' ? 200 : 503).json(payload);
});
