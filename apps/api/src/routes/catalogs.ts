import type { Request } from 'express';

import {
  catalogDetailsQuerySchema,
  catalogKindsForListSchema,
  catalogProvidersQuerySchema,
  catalogSearchQuerySchema,
} from '@orbit-hub/contracts';
import { Router } from 'express';

import { HttpError } from '../lib/http-error.js';
import { requireAuth } from '../middleware/require-auth.js';
import { logger } from '../lib/logger.js';
import {
  CatalogError,
  catalogKindsFor,
  fetchCatalogDetails,
  fetchCatalogProviders,
  isCatalogConfigured,
  searchCatalog,
} from '../modules/catalogs/catalog-service.js';

import { sendData } from './respond.js';

export const catalogRouter = Router();

catalogRouter.use(requireAuth);

/**
 * Search an external catalog.
 *
 * Requires a session: the provider key stays on the server, so an anonymous
 * request would be an open proxy to someone else's quota. Rate limited per
 * account because every call costs the project's own quota.
 */
catalogRouter.get('/search', async (req, res) => {
  const { kind, q } = catalogSearchQuerySchema.parse(req.query);
  const userId = req.auth?.userId;
  if (!userId) throw HttpError.unauthorized();

  if (!isCatalogConfigured(kind)) {
    // Not an error: the app shows the field as unavailable instead of a
    // failure, which is the difference between "not set up" and "broken".
    sendData(res, 200, { items: [], kind, configured: false });
    return;
  }

  try {
    const items = await searchCatalog(kind, q);
    sendData(res, 200, { items, kind, configured: true });
  } catch (error) {
    if (error instanceof CatalogError) {
      logger.warn({ kind, reason: error.reason, userId }, 'catalog search failed');
      if (error.reason === 'bad_query') {
        throw HttpError.validation('The request payload is invalid', { q: error.message });
      }
      throw HttpError.badRequest('The catalog provider is unavailable right now');
    }
    throw error;
  }
});

/**
 * One record in full, for the detail screen.
 *
 * Fetched on open rather than stored with the item: a detail is large, changes
 * with the provider, and a list only needs enough to recognise a title offline.
 */
catalogRouter.get('/details', async (req, res) => {
  const { kind, externalId } = catalogDetailsQuerySchema.parse(req.query);
  const userId = req.auth?.userId;
  if (!userId) throw HttpError.unauthorized();

  if (!isCatalogConfigured(kind)) {
    throw HttpError.notImplemented('This catalog is not configured on this server');
  }

  try {
    sendData(res, 200, await fetchCatalogDetails(kind, externalId));
  } catch (error) {
    if (error instanceof CatalogError) {
      logger.warn({ kind, externalId, reason: error.reason, userId }, 'catalog details failed');
      if (error.reason === 'bad_query') {
        throw HttpError.validation('The request payload is invalid', {
          externalId: error.message,
        });
      }
      throw HttpError.badRequest('The catalog provider is unavailable right now');
    }
    throw error;
  }
});

/**
 * Where a title can be watched, bought or rented, for one country.
 *
 * The country is asked for and not remembered: what is on Netflix in Spain is not
 * what is on it in Mexico, and answering for the wrong one without saying so is
 * how somebody ends up paying for a service that does not have it.
 */
/**
 * The country to answer for when nobody asked.
 *
 * Taken from the language the request says it wants, because that is the one thing
 * about a person this request knows, and because it is better than a hardcoded
 * country: someone reading the app in English is not in Spain, whatever the
 * server is deployed in.
 */
function defaultRegion(req: Request): string {
  const accept = String(req.headers['accept-language'] ?? '');
  const primero = accept.split(',')[0] ?? '';
  const region = primero.trim().split('-')[1];
  return (region && /^[A-Za-z]{2}$/.test(region) ? region : 'es').toUpperCase();
}

catalogRouter.get('/providers', async (req, res) => {
  const { kind, externalId, region } = catalogProvidersQuerySchema.parse(req.query);
  const userId = req.auth?.userId;
  if (!userId) throw HttpError.unauthorized();

  if (!isCatalogConfigured(kind)) {
    throw HttpError.notImplemented('This catalog is not configured on this server');
  }

  try {
    // Without a region, the language the app is in is the best guess anybody has,
    // and it is echoed back in the answer so the sheet can say which one.
    sendData(
      res,
      200,
      await fetchCatalogProviders(kind, externalId, region ?? defaultRegion(req)),
    );
  } catch (error) {
    if (error instanceof CatalogError) {
      logger.warn({ kind, externalId, reason: error.reason, userId }, 'catalog providers failed');
      throw HttpError.badRequest('The catalog provider is unavailable right now');
    }
    throw error;
  }
});

/** Which catalogs can fill this kind of list, for the list creation screen. */
catalogRouter.get('/kinds', (req, res) => {
  const { listKind } = catalogKindsForListSchema.parse(req.query);
  const kinds = catalogKindsFor(listKind).map((kind) => ({
    kind,
    configured: isCatalogConfigured(kind),
  }));
  sendData(res, 200, { items: kinds });
});
