import { syncPullRequestSchema, syncPushEnvelopeSchema } from '@orbit-hub/contracts';
import { Router } from 'express';

import { HttpError } from '../lib/http-error.js';
import { requireAuth } from '../middleware/require-auth.js';
import { syncService } from '../modules/sync/sync-service.js';

import { sendData } from './respond.js';

export const syncRouter = Router();

syncRouter.use(requireAuth);

/**
 * Push drains the local outbox. Operations are idempotent, so the client can
 * retry the whole batch after a network failure without duplicating anything.
 */
syncRouter.post('/push', async (req, res) => {
  const auth = req.auth;
  if (!auth) throw HttpError.unauthorized();

  // Only the envelope is checked here. The operations are validated one at a
  // time by the service, so one that cannot be read comes back rejected while
  // the rest of a week's work is applied: the alternative is an outbox that can
  // never drain, which is what a whole batch rejection causes.
  const envelope = syncPushEnvelopeSchema.parse(req.body);

  sendData(
    res,
    200,
    await syncService.push(
      { deviceId: envelope.deviceId, lastPulledAt: envelope.lastPulledAt },
      auth.userId,
      envelope.operations,
    ),
  );
});

/**
 * Pull returns everything changed since the cursor, including tombstones. The
 * device id defaults to the session id, which is stable per signed-in device.
 */
syncRouter.post('/pull', async (req, res) => {
  const auth = req.auth;
  if (!auth) throw HttpError.unauthorized();

  const input = syncPullRequestSchema.parse(req.body);
  const deviceId = input.deviceId ?? auth.sessionId;

  sendData(res, 200, await syncService.pull(input, auth.userId, deviceId));
});

/** Conflicts are never resolved silently: the user decides. */
syncRouter.get('/conflicts', async (req, res) => {
  const auth = req.auth;
  if (!auth) throw HttpError.unauthorized();

  sendData(res, 200, await syncService.listConflicts(auth.userId));
});
