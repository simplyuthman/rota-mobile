/**
 * =============================================================================
 * Rota Mobile — Offline Shift Cache & AsyncStorage Persister
 * =============================================================================
 * AGENTS.md §2.1, §3.4 (P-01, P-02, P-03):
 * - Persists ONE query: published shifts assigned to user in next 30 days
 * - Stores minimal fields: time, title, location, status (NEVER notes)
 * - Cache older than 14 days since last sync is hidden ("Reconnect to refresh")
 * - Wiped on logout, session revocation, refresh failure, and user change
 * - No offline writes permitted
 * =============================================================================
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Persister, PersistedClient } from '@tanstack/react-query-persist-client';
import type { ShiftDto, ShiftPublicDto } from '@rota/contracts';

export const OFFLINE_STORAGE_KEY = 'rota_offline_upcoming_shifts';
export const LAST_SYNC_KEY = 'rota_last_sync_timestamp';
export const LAST_USER_KEY = 'rota_cached_user_id';

// 14 days in milliseconds (Rule P-02)
export const MAX_CACHE_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface OfflineShift {
  id: string;
  teamId: string;
  title: string;
  locationLabel: string | null;
  startsAt: string;
  endsAt: string;
  status: 'published';
  assignedMembershipId: string | null;
}

export interface OfflineCacheEnvelope {
  userId: string;
  syncedAt: string; // ISO-8601
  shifts: OfflineShift[];
}

/**
 * Filter and sanitize shifts for offline storage:
 * - Next 30 days only
 * - Published status only
 * - Assigned to user only
 * - Strip notes (Rule P-02)
 */
export function sanitizeShiftsForOffline(
  shifts: (ShiftDto | ShiftPublicDto)[],
  userMembershipId: string,
  now: Date = new Date()
): OfflineShift[] {
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return shifts
    .filter((s) => {
      if (s.status !== 'published') return false;
      if (s.assignedMembershipId !== userMembershipId) return false;
      const start = new Date(s.startsAt);
      return start >= now && start <= thirtyDaysLater;
    })
    .map((s) => ({
      id: s.id,
      teamId: s.teamId,
      title: s.title,
      locationLabel: s.locationLabel ?? null,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      status: 'published',
      assignedMembershipId: s.assignedMembershipId ?? null,
      // Note: 'notes' field is strictly omitted per Rule P-02
    }));
}

/**
 * Save sanitized offline shifts to AsyncStorage
 */
export async function saveOfflineShifts(
  userId: string,
  shifts: OfflineShift[],
  syncedAtTime?: Date
): Promise<void> {
  const envelope: OfflineCacheEnvelope = {
    userId,
    syncedAt: (syncedAtTime ?? new Date()).toISOString(),
    shifts,
  };
  await Promise.all([
    AsyncStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(envelope)),
    AsyncStorage.setItem(LAST_SYNC_KEY, envelope.syncedAt),
    AsyncStorage.setItem(LAST_USER_KEY, userId),
  ]);
}

/**
 * Read cached shifts from AsyncStorage with 14-day expiry check (Rule P-02)
 * and user-switch invalidation (Rule P-01).
 */
export async function getOfflineShifts(
  currentUserId: string,
  now: Date = new Date()
): Promise<{
  shifts: OfflineShift[];
  syncedAt: Date;
  isExpired: boolean;
} | null> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_STORAGE_KEY);
    if (!raw) return null;

    const envelope: OfflineCacheEnvelope = JSON.parse(raw);

    // Rule P-01: Wipe if signed-in user changed
    if (envelope.userId !== currentUserId) {
      await wipeOfflineShifts();
      return null;
    }

    const syncedAt = new Date(envelope.syncedAt);
    const ageMs = now.getTime() - syncedAt.getTime();
    const isExpired = ageMs > MAX_CACHE_AGE_MS;

    return {
      shifts: isExpired ? [] : envelope.shifts,
      syncedAt,
      isExpired,
    };
  } catch {
    return null;
  }
}

/**
 * Rule P-01: Wipe offline shift cache on logout, session revocation,
 * refresh failure, and user change.
 */
export async function wipeOfflineShifts(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(OFFLINE_STORAGE_KEY),
    AsyncStorage.removeItem(LAST_SYNC_KEY),
    AsyncStorage.removeItem(LAST_USER_KEY),
  ]);
}

/**
 * TanStack Query Persister over AsyncStorage (AGENTS.md §2.1)
 */
export const asyncStoragePersister: Persister = {
  persistClient: async (client: PersistedClient) => {
    try {
      await AsyncStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(client));
    } catch {
      // Storage quota or error
    }
  },
  restoreClient: async () => {
    try {
      const data = await AsyncStorage.getItem(OFFLINE_STORAGE_KEY);
      if (!data) return undefined;
      return JSON.parse(data) as PersistedClient;
    } catch {
      return undefined;
    }
  },
  removeClient: async () => {
    try {
      await AsyncStorage.removeItem(OFFLINE_STORAGE_KEY);
    } catch {
      // ignore
    }
  },
};
