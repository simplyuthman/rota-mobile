/**
 * =============================================================================
 * Rota API — User Settings Repository
 * =============================================================================
 * AGENTS.md §3.4 (P-07, P-08) & §4 (L-05):
 * All SQL for user_settings on the control plane database:
 *   - Find settings by user_id
 *   - Initialize settings on first launch (no UTC default)
 *   - Atomic PATCH of changed fields only, stamping field_updated_at
 * =============================================================================
 */

import { sql } from 'kysely';
import { getControlPlaneDb } from '../../db/index.js';
import type { Selectable } from 'kysely';
import type { UserSettingsTable } from '../../db/schema.js';

export type UserSettingsRow = Selectable<UserSettingsTable>;

export const settingsRepo = {
  async findByUserId(userId: string): Promise<UserSettingsRow | undefined> {
    const db = getControlPlaneDb();
    return db
      .selectFrom('user_settings')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst();
  },

  async createInitial(params: {
    userId: string;
    timezone: string;
    language?: string | undefined;
    theme?: 'light' | 'dark' | 'system' | undefined;
    quietHoursEnabled?: boolean | undefined;
    quietHoursStart?: string | null | undefined;
    quietHoursEnd?: string | null | undefined;
    notificationPreferences?: Record<string, boolean> | undefined;
  }): Promise<UserSettingsRow> {
    const db = getControlPlaneDb();
    const nowIso = new Date().toISOString();

    const initialFieldUpdatedAt: Record<string, string> = {
      timezone: nowIso,
      theme: nowIso,
      language: nowIso,
    };

    const initialPrefs = params.notificationPreferences ?? {
      shift_changes: true,
      swaps: true,
      billing: true,
      activity: true,
      security: true,
    };

    return db
      .insertInto('user_settings')
      .values({
        user_id: params.userId,
        timezone: params.timezone,
        quiet_hours_enabled: params.quietHoursEnabled ?? false,
        quiet_hours_start: params.quietHoursStart ?? '22:00',
        quiet_hours_end: params.quietHoursEnd ?? '07:00',
        notification_preferences: initialPrefs,
        language: params.language ?? 'en',
        theme: params.theme ?? 'system',
        field_updated_at: initialFieldUpdatedAt,
        version: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  async patch(params: {
    userId: string;
    fields: Partial<{
      timezone: string;
      quiet_hours_enabled: boolean;
      quiet_hours_start: string | null;
      quiet_hours_end: string | null;
      notification_preferences: unknown;
      language: string;
      theme: 'light' | 'dark' | 'system';
    }>;
    fieldUpdatedAtStamps: Record<string, string>;
  }): Promise<UserSettingsRow> {
    const db = getControlPlaneDb();

    // Build update object
    const updateValues: Record<string, unknown> = {
      ...params.fields,
      updated_at: new Date(),
      version: sql`version + 1`,
      // Merge new timestamps into existing field_updated_at jsonb
      field_updated_at: sql`coalesce(field_updated_at, '{}'::jsonb) || ${JSON.stringify(
        params.fieldUpdatedAtStamps
      )}::jsonb`,
    };

    return db
      .updateTable('user_settings')
      .set(updateValues)
      .where('user_id', '=', params.userId)
      .returningAll()
      .executeTakeFirstOrThrow();
  },
};
