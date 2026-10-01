import { Router } from 'express';
import { z } from 'zod';

import {
  followPersonResponseSchema,
  listPeopleResponseSchema,
  searchPeopleQuerySchema,
  searchPeopleResponseSchema,
  uuidSchema,
} from '@orbit-hub/contracts';

import { sendData } from './respond.js';
import { HttpError } from '../lib/http-error.js';
import { requireAuth } from '../middleware/require-auth.js';
import { peopleService } from '../modules/people/people-service.js';

/**
 * The people directory, over HTTP.
 *
 * At the top level and not under `/workspaces`, for the same reason `/shares` is:
 * what is being asked is not "who is in this space" but "who do I know", and the
 * answer spans every space and every share this account has ever had.
 *
 * And not under `/sync`, for the same reason `/shares` is not: knowing who you
 * know is a read of other people, not content the person is editing offline.
 */
export const peopleRouter = Router();

/** Everything here is about who the caller is and who they already know. */
peopleRouter.use(requireAuth);

const idParams = z.object({ personId: uuidSchema });

/**
 * Everybody you have already had a transaction with, plus whoever you follow.
 *
 * One endpoint and not a search endpoint, on purpose: the answer cannot be "anyone
 * in the app". See the service comment — the sameness of the 404s on the share
 * route is what stops account enumeration, and a directory wide enough to search
 * is the thing that undoes it.
 */
peopleRouter.get('/', async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) throw HttpError.unauthorized();

  const items = await peopleService.directory(userId);

  // Parsed through the contract even though the service just built it, so a field
  // added to `personSchema` and not filled in here fails here instead of arriving
  // at a picker with an `undefined` in it.
  const body = listPeopleResponseSchema.parse({ items });

  // Sorted here as well as in the service: the order is part of what the endpoint
  // means, not a detail of how one caller happened to want it.
  sendData(res, 200, {
    ...body,
    items: [...body.items].sort((one, two) =>
      two.lastInteractionAt.localeCompare(one.lastInteractionAt),
    ),
  });
});

/**
 * Find somebody you already know of, to follow them.
 *
 * **The only endpoint in the app that reads the accounts table**, and the reason it
 * is allowed is that it is aimed and not a listing: three characters minimum, ten
 * results maximum, nothing when there is no match.
 *
 * It is here, and not folded into `GET /people`, so that the difference between
 * "show me my directory" and "look somebody up in the accounts" stays visible in the
 * routes. They answer different questions and only one of them is a listing.
 */
peopleRouter.get('/search', async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) throw HttpError.unauthorized();

  const parsed = searchPeopleQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    // A validation error and not an empty list, because "you typed two letters" and
    // "nobody matched" are different answers and the app draws them differently.
    throw HttpError.validation(
      'Escribe al menos tres letras para buscar a alguien',
    );
  }

  const items = await peopleService.search(userId, parsed.data.q, parsed.data.limit);
  sendData(res, 200, searchPeopleResponseSchema.parse({ items }));
});

/** Follow, which is also the way into the directory. */
peopleRouter.post('/:personId/follow', async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) throw HttpError.unauthorized();

  const { personId } = idParams.parse(req.params);
  const following = await peopleService.follow(userId, personId);

  // 200 and not 201: following twice is a no-op that still answers "yes", and a
  // second press on a button should not look like something went wrong.
  sendData(res, 200, followPersonResponseSchema.parse({ following }));
});

/** Stop following. */
peopleRouter.delete('/:personId/follow', async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) throw HttpError.unauthorized();

  const { personId } = idParams.parse(req.params);
  const following = await peopleService.unfollow(userId, personId);

  sendData(res, 200, followPersonResponseSchema.parse({ following }));
});