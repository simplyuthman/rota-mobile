/**
 * =============================================================================
 * Rota API — User Settings Service
 * =============================================================================
 * AGENTS.md §3.4 (P-06, P-07, P-08):
 * - Enforce IANA timezone validation (never default to UTC)
 * - Update only changed fields and stamp each in field_updated_at
 * - Security notifications cannot be disabled
 * =============================================================================
 */

import { settingsRepo, type UserSettingsRow } from './settings.repo.js';
import type {
  UserSettingsDto,
  UpdateUserSettingsRequest,
  NotificationPreferences,
} from '@rota/contracts';

export class SettingsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'SettingsError';
  }
}

export function isValidIanaTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const settingsService = {
  toDto(row: UserSettingsRow): UserSettingsDto {
    const rawPrefs = (row.notification_preferences as Record<string, boolean>) || {};
    const prefs: NotificationPreferences = {
      shiftChanges: rawPrefs['shift_changes'] ?? rawPrefs['shiftChanges'] ?? true,
      swaps: rawPrefs['swaps'] ?? true,
      billing: rawPrefs['billing'] ?? true,
      activity: rawPrefs['activity'] ?? true,
      security: true, // Non-disableable
    };

    return {
      userId: row.user_id,
      timezone: row.timezone,
      quietHoursEnabled: row.quiet_hours_enabled,
      quietHoursStart: row.quiet_hours_start ? row.quiet_hours_start.slice(0, 5) : null,
      quietHoursEnd: row.quiet_hours_end ? row.quiet_hours_end.slice(0, 5) : null,
      notificationPreferences: prefs,
      language: row.language,
      theme: row.theme,
      fieldUpdatedAt: (row.field_updated_at as Record<string, string>) || {},
      version: row.version,
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : new Date(row.updated_at).toISOString(),
    };
  },

  async getSettings(userId: string, deviceTimezone?: string): Promise<UserSettingsDto> {
    let row = await settingsRepo.findByUserId(userId);

    if (!row) {
      // Auto-initialize if device timezone is provided and valid IANA
      const tzToUse = deviceTimezone?.trim();
      if (tzToUse && isValidIanaTimezone(tzToUse)) {
        row = await settingsRepo.createInitial({
          userId,
          timezone: tzToUse,
        });
      } else {
        throw new SettingsError(
          'SETTINGS_NOT_INITIALIZED',
          'User settings have not been initialized. Please provide a device IANA timezone.',
          404
        );
      }
    }

    return this.toDto(row);
  },

  async patchSettings(
    userId: string,
    input: UpdateUserSettingsRequest
  ): Promise<UserSettingsDto> {
    let existing = await settingsRepo.findByUserId(userId);

    // If settings do not exist yet, we must initialize them
    if (!existing) {
      const tz = input.timezone?.trim();
      if (!tz || !isValidIanaTimezone(tz)) {
        throw new SettingsError(
          'INVALID_TIMEZONE',
          'A valid IANA timezone name is required to initialize settings (Rule P-07).',
          400
        );
      }

      existing = await settingsRepo.createInitial({
        userId,
        timezone: tz,
        theme: input.theme,
        language: input.language,
        quietHoursEnabled: input.quietHoursEnabled,
        quietHoursStart: input.quietHoursStart,
        quietHoursEnd: input.quietHoursEnd,
      });

      return this.toDto(existing);
    }

    const changedFields: Record<string, unknown> = {};
    const fieldUpdatedAtStamps: Record<string, string> = {};
    const nowIso = new Date().toISOString();

    // 1. Timezone (P-07: Validate IANA name, never default to UTC)
    if (input.timezone !== undefined) {
      const tz = input.timezone.trim();
      if (!isValidIanaTimezone(tz)) {
        throw new SettingsError(
          'INVALID_TIMEZONE',
          `"${input.timezone}" is not a valid IANA timezone identifier (Rule P-07).`,
          400
        );
      }
      if (tz !== existing.timezone) {
        changedFields['timezone'] = tz;
        fieldUpdatedAtStamps['timezone'] = nowIso;
      }
    }

    // 2. Quiet Hours (P-06)
    if (input.quietHoursEnabled !== undefined && input.quietHoursEnabled !== existing.quiet_hours_enabled) {
      changedFields['quiet_hours_enabled'] = input.quietHoursEnabled;
      fieldUpdatedAtStamps['quietHoursEnabled'] = nowIso;
    }

    if (input.quietHoursStart !== undefined && input.quietHoursStart !== existing.quiet_hours_start) {
      changedFields['quiet_hours_start'] = input.quietHoursStart;
      fieldUpdatedAtStamps['quietHoursStart'] = nowIso;
    }

    if (input.quietHoursEnd !== undefined && input.quietHoursEnd !== existing.quiet_hours_end) {
      changedFields['quiet_hours_end'] = input.quietHoursEnd;
      fieldUpdatedAtStamps['quietHoursEnd'] = nowIso;
    }

    // Enforce consistency: if quiet hours enabled, start and end must exist
    const willBeEnabled =
      input.quietHoursEnabled !== undefined
        ? input.quietHoursEnabled
        : existing.quiet_hours_enabled;
    const finalStart =
      input.quietHoursStart !== undefined
        ? input.quietHoursStart
        : existing.quiet_hours_start;
    const finalEnd =
      input.quietHoursEnd !== undefined ? input.quietHoursEnd : existing.quiet_hours_end;

    if (willBeEnabled && (!finalStart || !finalEnd)) {
      throw new SettingsError(
        'INVALID_QUIET_HOURS',
        'Quiet hours start and end times are required when quiet hours are enabled.',
        400
      );
    }

    // 3. Notification Preferences
    if (input.notificationPreferences !== undefined) {
      const currentPrefs = (existing.notification_preferences as Record<string, boolean>) || {};
      const newPrefs = {
        shift_changes:
          input.notificationPreferences.shiftChanges ??
          currentPrefs['shift_changes'] ??
          true,
        swaps: input.notificationPreferences.swaps ?? currentPrefs['swaps'] ?? true,
        billing: input.notificationPreferences.billing ?? currentPrefs['billing'] ?? true,
        activity: input.notificationPreferences.activity ?? currentPrefs['activity'] ?? true,
        security: true, // Non-disableable (Rule P-06)
      };

      changedFields['notification_preferences'] = newPrefs;
      fieldUpdatedAtStamps['notificationPreferences'] = nowIso;
    }

    // 4. Theme
    if (input.theme !== undefined && input.theme !== existing.theme) {
      changedFields['theme'] = input.theme;
      fieldUpdatedAtStamps['theme'] = nowIso;
    }

    // 5. Language
    if (input.language !== undefined && input.language !== existing.language) {
      changedFields['language'] = input.language;
      fieldUpdatedAtStamps['language'] = nowIso;
    }

    // If no fields actually changed, return existing
    if (Object.keys(changedFields).length === 0) {
      return this.toDto(existing);
    }

    const updatedRow = await settingsRepo.patch({
      userId,
      fields: changedFields,
      fieldUpdatedAtStamps,
    });

    return this.toDto(updatedRow);
  },
};
