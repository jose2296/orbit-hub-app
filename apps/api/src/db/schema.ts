/**
 * Composition point for Drizzle.
 *
 * The tables are split by domain (`auth-schema`, `content-schema`) so the
 * migration and the services have a clear owner for each area, while drizzle()
 * and drizzle-kit keep seeing a single schema.
 */
export * from './auth-schema';
export * from './content-schema';

import { auditLogs, authIdentities, emailTokens, sessions, users } from './auth-schema';
import {
  dashboardLayouts,
  folders,
  memberships,
  syncConflicts,
  syncCursors,
  syncOperations,
  workspaces,
} from './content-schema';

export const schema = {
  // auth
  users,
  authIdentities,
  sessions,
  emailTokens,
  auditLogs,
  // content
  workspaces,
  memberships,
  folders,
  dashboardLayouts,
  // sync
  syncOperations,
  syncConflicts,
  syncCursors,
};
