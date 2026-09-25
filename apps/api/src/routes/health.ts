import { healthResponseSchema } from '@orbit-hub/contracts';
import { Router } from 'express';

import { env } from '../config/env.js';
import { isDatabaseConfigured, pingDatabase } from '../db/pool.js';

export const healthRouter = Router();

/**
 * Liveness + readiness in one endpoint: the mobile app uses it to decide
 * whether the API is reachable, so it must answer even without a database.
 * Mounted at `/health`, hence the root path of this router.
 */
healthRouter.get('/', async (_req, res) => {
  const database = isDatabaseConfigured() ? await pingDatabase() : null;
  const status = database === null || database.ok ? 'ok' : 'degraded';

  const payload = healthResponseSchema.parse({
    status,
    service: 'orbit-hub-api',
    version: process.env['npm_package_version'] ?? '0.1.0',
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    checks: {
      database: {
        status: database === null ? 'ok' : database.ok ? 'ok' : 'down',
        latencyMs: database?.latencyMs ?? null,
      },
    },
    timestamp: new Date().toISOString(),
  });

  res.status(status === 'ok' ? 200 : 503).json(payload);
});
