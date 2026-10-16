/**
 * =============================================================================
 * Rota API — Activity Feed Service
 * =============================================================================
 * AGENTS.md §3.2 (A-08), §3.5 (D-01, D-03, D-04, D-05):
 * Cursor pagination, Redis first-page caching, in-code viewer filtering,
 * and transactional event creation.
 */

import { activityRepo, type ActivityEventRow } from './activity.repo.js';
import { encodeCursor, decodeCursor } from './activity.schemas.js';
import { redisCache } from '../../db/redis.js';
import type { ActivityEventDto, ActivityFeedResponse } from '@rota/contracts';
import type { ShardTransaction } from '../../db/index.js';

const CACHE_TTL_SECONDS = 30; // Rule D-03: 30-second TTL

export class ActivityService {
  /**
   * Translates a database row to the shared DTO.
   * Keeps created_at_text to preserve microsecond precision (Rule D-01).
   */
  private toDto(row: ActivityEventRow): ActivityEventDto {
    return {
      id: row.id,
      teamId: row.team_id,
      actorMembershipId: row.actor_membership_id,
      eventType: row.event_type,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      params: (row.params as Record<string, unknown>) ?? {},
      visibility: row.visibility,
      participantMembershipIds: row.participant_membership_ids ?? [],
      createdAt: row.created_at_text,
    };
  }

  /**
   * Filters raw events in-memory per viewer role and membership ID (Rule D-03).
   */
  private filterForViewer(
    rows: ActivityEventRow[],
    role: 'owner' | 'manager' | 'staff',
    membershipId: string
  ): ActivityEventRow[] {
    return rows.filter((row) => {
      if (row.visibility === 'team') return true;
      if (row.visibility === 'managers') return role === 'owner' || role === 'manager';
      if (row.visibility === 'owner') return role === 'owner';
      if (row.visibility === 'participants') {
        return (
          role === 'owner' ||
          role === 'manager' ||
          (row.participant_membership_ids && row.participant_membership_ids.includes(membershipId))
        );
      }
      return false;
    });
  }

  /**
   * Gets the current feed cache version for the team (Rule D-04).
   */
  private async getCacheVersion(teamId: string): Promise<string> {
    try {
      const v = await redisCache.get(`team:${teamId}:feed:version`);
      return v || '1';
    } catch {
      return '1';
    }
  }

  /**
   * Bumps the feed cache version in the request, right after commit (Rule D-04).
   */
  async bumpCacheVersion(teamId: string): Promise<void> {
    try {
      await redisCache.incr(`team:${teamId}:feed:version`);
    } catch {
      // Non-fatal if Redis is transiently unreachable; DB remains source of truth
    }
  }

  /**
   * Retrieves paginated activity feed for the authenticated viewer (Rules D-01, D-03, A-08).
   */
  async getFeed(
    teamId: string,
    viewerRole: 'owner' | 'manager' | 'staff',
    viewerMembershipId: string,
    options: { cursor?: string | undefined; limit?: number | undefined }
  ): Promise<ActivityFeedResponse> {
    const limit = options.limit ?? 20;
    const isFirstPage = !options.cursor;

    // Rule D-03: First-page caching check (newest 50 raw events per team, 30s)
    if (isFirstPage) {
      try {
        const v = await this.getCacheVersion(teamId);
        const cacheKey = `team:${teamId}:feed:first:v${v}`;
        let rawEvents: ActivityEventRow[] | null = null;

        const cached = await redisCache.get(cacheKey);
        if (cached) {
          rawEvents = JSON.parse(cached) as ActivityEventRow[];
        } else {
          rawEvents = await activityRepo.getRawFirstPage(teamId, 50);
          await redisCache.set(cacheKey, JSON.stringify(rawEvents), 'EX', CACHE_TTL_SECONDS);
        }

        if (rawEvents) {
          const visibleRows = this.filterForViewer(rawEvents, viewerRole, viewerMembershipId);

          // If filtering leaves at least `limit` rows OR the team has fewer than 50 total raw events,
          // we can serve from the cache!
          if (visibleRows.length >= limit || rawEvents.length < 50) {
            const hasMore = visibleRows.length > limit;
            const pageRows = visibleRows.slice(0, limit);
            const dtos = pageRows.map((r) => this.toDto(r));

            let nextCursor: string | null = null;
            if (hasMore && pageRows.length > 0) {
              const last = pageRows[pageRows.length - 1]!;
              nextCursor = encodeCursor({ createdAt: last.created_at_text, id: last.id });
            }

            return {
              items: dtos,
              nextCursor,
            };
          }
          // If filtering left fewer than page size, fallback to database (Rule D-03)
        }
      } catch {
        // Fallback to database on cache error
      }
    }

    // Database query path (for paginated pages or cache misses / fallbacks)
    let cursorCreatedAt: string | null = null;
    let cursorId: string | null = null;

    if (options.cursor) {
      const decoded = decodeCursor(options.cursor);
      if (decoded) {
        cursorCreatedAt = decoded.createdAt;
        cursorId = decoded.id;
      }
    }

    const rows = await activityRepo.getFeedPage(teamId, {
      viewerRole,
      viewerMembershipId,
      cursorCreatedAt,
      cursorId,
      limit,
    });

    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const dtos = pageRows.map((r) => this.toDto(r));

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1]!;
      nextCursor = encodeCursor({ createdAt: last.created_at_text, id: last.id });
    }

    return {
      items: dtos,
      nextCursor,
    };
  }

  /**
   * Records an activity event in the database (Rules D-05, A-08) and bumps cache (Rule D-04).
   */
  async recordEvent(
    teamId: string,
    event: {
      actorMembershipId?: string | null;
      eventType: string;
      subjectType?: string | null;
      subjectId?: string | null;
      params?: Record<string, unknown>;
      visibility: 'team' | 'managers' | 'owner' | 'participants';
      participantMembershipIds?: string[];
    },
    trx?: ShardTransaction
  ): Promise<ActivityEventDto> {
    const row = await activityRepo.insertEvent(teamId, event, trx);

    // Bump cache version right after insert/commit if outside a transaction
    if (!trx) {
      await this.bumpCacheVersion(teamId);
    }

    return this.toDto(row);
  }
}

export const activityService = new ActivityService();
