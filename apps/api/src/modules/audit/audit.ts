import type { AuditEvent } from '../../db/constants.js';
import { auditLogs } from '../../db/schema.js';
import { getDatabase } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

export interface AuditContext {
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditInput extends AuditContext {
  event: AuditEvent;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only security trail.
 *
 * Audit failures are logged but never propagated: losing a log line must not
 * turn a successful login into a 500.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const { db } = await getDatabase();
    await db.insert(auditLogs).values({
      userId: input.userId ?? null,
      event: input.event,
      ip: input.ip?.slice(0, 64) ?? null,
      userAgent: input.userAgent?.slice(0, 400) ?? null,
      metadata: input.metadata ?? null,
    });
  } catch (error) {
    logger.error({ err: error, event: input.event }, 'failed to write the audit log');
  }
}
