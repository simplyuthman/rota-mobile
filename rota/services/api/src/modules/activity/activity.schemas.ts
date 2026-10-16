/**
 * =============================================================================
 * Rota API — Activity Module Schemas & Cursor Helpers
 * =============================================================================
 * AGENTS.md Rule D-01:
 * Cursor is base64url of {createdAt: created_at::text, id}.
 * NEVER passes through a JavaScript Date (preserves microsecond precision).
 */

import { z } from 'zod';
import { ActivityFeedQuerySchema, ActivityFeedResponseSchema } from '@rota/contracts';

export { ActivityFeedQuerySchema, ActivityFeedResponseSchema };

export interface FeedCursor {
  createdAt: string; // created_at::text with full microsecond precision
  id: string; // event uuid
}

export function encodeCursor(cursor: FeedCursor): string {
  const json = JSON.stringify({ createdAt: cursor.createdAt, id: cursor.id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(encoded: string): FeedCursor | null {
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (
      typeof parsed?.createdAt === 'string' &&
      parsed.createdAt.length > 0 &&
      typeof parsed?.id === 'string' &&
      parsed.id.length > 0
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}
