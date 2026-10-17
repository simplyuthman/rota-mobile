/**
 * =============================================================================
 * Rota API — Team Cache Version Invalidation Manager
 * =============================================================================
 * AGENTS.md §3.5 (D-03, D-04):
 * - D-03: Cache only published note-free calendar, roster, and feed first page.
 * - D-04: Bump the team cache version in the request, right after commit.
 *   The outbox event repeats it as a backup.
 * =============================================================================
 */

import { redisCache } from './redis.js';

/**
 * Returns the current cache version for a team (defaults to '1').
 */
export async function getTeamCacheVersion(teamId: string): Promise<string> {
  try {
    const v = await redisCache.get(`team:${teamId}:version`);
    return v || '1';
  } catch {
    return '1';
  }
}

/**
 * Bumps the team cache version counter in Redis.
 * Calling this invalidates all versioned cache keys for this team:
 *   - team:{teamId}:roster:v{n}
 *   - team:{teamId}:cal:pub:{start}:{end}:v{n}
 *   - team:{teamId}:feed:first:v{n}
 */
export async function bumpTeamCacheVersion(teamId: string): Promise<number> {
  try {
    const next = await redisCache.incr(`team:${teamId}:version`);
    // Sync legacy feed key
    await redisCache.set(`team:${teamId}:feed:version`, next.toString()).catch(() => {});
    return next;
  } catch {
    return 1;
  }
}
