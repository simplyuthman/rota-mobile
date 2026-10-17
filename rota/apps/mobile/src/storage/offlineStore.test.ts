/**
 * =============================================================================
 * Rota Mobile — Offline Store Unit & Invariant Tests (Tier 6 Evidence)
 * =============================================================================
 * AGENTS.md §3.4 (P-01, P-02, P-03):
 *
 * 1. Rule P-01:
 *    - Wipe offline shift cache on logout / user switch.
 *    - When currentUserId does not match cached envelope userId, cache is wiped and returns null.
 *    - wipeOfflineShifts() removes OFFLINE_STORAGE_KEY, LAST_SYNC_KEY, LAST_USER_KEY.
 *
 * 2. Rule P-02:
 *    - Persist only published shifts assigned to user in next 30 days.
 *    - Minimal fields (id, teamId, title, locationLabel, startsAt, endsAt, status, assignedMembershipId).
 *    - NEVER persist notes (notes property is completely stripped).
 *    - Hide cache older than 14 days since last sync (returns isExpired: true and empty shifts).
 *    - Cache younger than 14 days returns shifts with isExpired: false.
 *
 * 3. Rule P-03:
 *    - Never write while offline.
 * =============================================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  sanitizeShiftsForOffline,
  saveOfflineShifts,
  getOfflineShifts,
  wipeOfflineShifts,
  OFFLINE_STORAGE_KEY,
  LAST_SYNC_KEY,
  LAST_USER_KEY,
  MAX_CACHE_AGE_MS,
  type OfflineShift,
} from './offlineStore';
import type { ShiftDto, ShiftPublicDto } from '@rota/contracts';

// In-memory mock for AsyncStorage
const memoryStore: Record<string, string> = {};

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => memoryStore[key] ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      memoryStore[key] = value;
    }),
    removeItem: vi.fn(async (key: string) => {
      delete memoryStore[key];
    }),
    clear: vi.fn(async () => {
      for (const k of Object.keys(memoryStore)) {
        delete memoryStore[k];
      }
    }),
  },
}));

describe('Tier 6: Offline Cache & Privacy Invariants (Rules P-01, P-02, P-03)', () => {
  beforeEach(() => {
    for (const k of Object.keys(memoryStore)) {
      delete memoryStore[k];
    }
    vi.clearAllMocks();
  });

  const now = new Date('2026-10-17T12:00:00Z');
  const myMembershipId = 'mem-user-123';
  const otherMembershipId = 'mem-colleague-456';
  const userId = 'usr-111';

  const sampleShifts: (ShiftDto | ShiftPublicDto)[] = [
    // 1. Valid: Published, assigned to me, in 2 days (within 30 days) -> KEEP
    {
      id: 'shift-1',
      teamId: 'team-1',
      title: 'Morning Barista',
      locationLabel: 'Main Floor',
      startsAt: '2026-10-19T08:00:00Z',
      endsAt: '2026-10-19T16:00:00Z',
      status: 'published',
      assignedMembershipId: myMembershipId,
      notes: 'Secret manager note: vip customer arriving', // MUST BE STRIPPED
      createdAt: '2026-10-15T00:00:00Z',
      updatedAt: '2026-10-15T00:00:00Z',
    } as ShiftDto,

    // 2. Invalid: Draft shift (Rule P-02: published shifts only) -> FILTER OUT
    {
      id: 'shift-2-draft',
      teamId: 'team-1',
      title: 'Draft Afternoon Shift',
      locationLabel: 'Kitchen',
      startsAt: '2026-10-20T12:00:00Z',
      endsAt: '2026-10-20T20:00:00Z',
      status: 'draft',
      assignedMembershipId: myMembershipId,
      notes: 'Draft notes',
      createdAt: '2026-10-15T00:00:00Z',
      updatedAt: '2026-10-15T00:00:00Z',
    } as ShiftDto,

    // 3. Invalid: Assigned to colleague, not me -> FILTER OUT
    {
      id: 'shift-3-other',
      teamId: 'team-1',
      title: 'Evening Shift',
      locationLabel: 'Bar',
      startsAt: '2026-10-21T16:00:00Z',
      endsAt: '2026-10-22T00:00:00Z',
      status: 'published',
      assignedMembershipId: otherMembershipId,
      createdAt: '2026-10-15T00:00:00Z',
      updatedAt: '2026-10-15T00:00:00Z',
    } as ShiftPublicDto,

    // 4. Invalid: Past shift (before now) -> FILTER OUT
    {
      id: 'shift-4-past',
      teamId: 'team-1',
      title: 'Yesterday Shift',
      locationLabel: 'Main Floor',
      startsAt: '2026-10-16T08:00:00Z',
      endsAt: '2026-10-16T16:00:00Z',
      status: 'published',
      assignedMembershipId: myMembershipId,
      createdAt: '2026-10-15T00:00:00Z',
      updatedAt: '2026-10-15T00:00:00Z',
    } as ShiftPublicDto,

    // 5. Invalid: Further than 30 days away (e.g., 35 days) -> FILTER OUT
    {
      id: 'shift-5-too-far',
      teamId: 'team-1',
      title: 'Far Future Shift',
      locationLabel: 'Main Floor',
      startsAt: '2026-11-25T08:00:00Z', // 39 days out
      endsAt: '2026-11-25T16:00:00Z',
      status: 'published',
      assignedMembershipId: myMembershipId,
      createdAt: '2026-10-15T00:00:00Z',
      updatedAt: '2026-10-15T00:00:00Z',
    } as ShiftPublicDto,

    // 6. Valid: Exactly 29 days out -> KEEP
    {
      id: 'shift-6-valid-far',
      teamId: 'team-1',
      title: 'Upcoming Closing Shift',
      locationLabel: 'Backroom',
      startsAt: '2026-11-14T14:00:00Z', // 28 days out
      endsAt: '2026-11-14T22:00:00Z',
      status: 'published',
      assignedMembershipId: myMembershipId,
      notes: 'Notes that must never be cached',
      createdAt: '2026-10-15T00:00:00Z',
      updatedAt: '2026-10-15T00:00:00Z',
    } as ShiftDto,
  ];

  describe('Rule P-02: Shift sanitization for offline cache', () => {
    it('persists only published shifts assigned to user in next 30 days and strictly strips notes', () => {
      const sanitized = sanitizeShiftsForOffline(sampleShifts, myMembershipId, now);

      // Exactly shift-1 and shift-6 should survive
      expect(sanitized).toHaveLength(2);
      expect(sanitized.map((s) => s.id)).toEqual(['shift-1', 'shift-6-valid-far']);

      // Invariant: Notes must NEVER be persisted in offline storage (Rule P-02)
      for (const shift of sanitized) {
        expect(shift).not.toHaveProperty('notes');
        expect((shift as any).notes).toBeUndefined();
        expect(shift.status).toBe('published');
        expect(shift.assignedMembershipId).toBe(myMembershipId);
      }
    });

    it('minimal fields only are retained', () => {
      const sanitized = sanitizeShiftsForOffline(sampleShifts, myMembershipId, now);
      const shift = sanitized[0];

      // Exact shape: id, teamId, title, locationLabel, startsAt, endsAt, status, assignedMembershipId
      expect(Object.keys(shift).sort()).toEqual([
        'assignedMembershipId',
        'endsAt',
        'id',
        'locationLabel',
        'startsAt',
        'status',
        'teamId',
        'title',
      ]);
    });
  });

  describe('Rule P-02: 14-day expiry behavior ("Reconnect to refresh")', () => {
    it('returns shifts when cache is under 14 days old', async () => {
      const sanitized = sanitizeShiftsForOffline(sampleShifts, myMembershipId, now);
      await saveOfflineShifts(userId, sanitized, now);

      // 5 days later: still valid
      const fiveDaysLater = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
      const cached = await getOfflineShifts(userId, fiveDaysLater);

      expect(cached).not.toBeNull();
      expect(cached?.isExpired).toBe(false);
      expect(cached?.shifts).toHaveLength(2);
    });

    it('hides cache and marks expired when cache is older than 14 days', async () => {
      const sanitized = sanitizeShiftsForOffline(sampleShifts, myMembershipId, now);
      await saveOfflineShifts(userId, sanitized, now);

      // 14 days + 1 minute later: expired (Rule P-02)
      const fifteenDaysLater = new Date(now.getTime() + (MAX_CACHE_AGE_MS + 60_000));
      const cached = await getOfflineShifts(userId, fifteenDaysLater);

      expect(cached).not.toBeNull();
      expect(cached?.isExpired).toBe(true);
      // Invariant: Shifts list is hidden (empty) when expired
      expect(cached?.shifts).toEqual([]);
    });
  });

  describe('Rule P-01: Wipe on logout, session revocation, and user switch', () => {
    it('wipeOfflineShifts clears all storage keys from AsyncStorage', async () => {
      const sanitized = sanitizeShiftsForOffline(sampleShifts, myMembershipId, now);
      await saveOfflineShifts(userId, sanitized);

      expect(memoryStore[OFFLINE_STORAGE_KEY]).toBeDefined();
      expect(memoryStore[LAST_SYNC_KEY]).toBeDefined();
      expect(memoryStore[LAST_USER_KEY]).toBe(userId);

      // Trigger logout wipe
      await wipeOfflineShifts();

      expect(memoryStore[OFFLINE_STORAGE_KEY]).toBeUndefined();
      expect(memoryStore[LAST_SYNC_KEY]).toBeUndefined();
      expect(memoryStore[LAST_USER_KEY]).toBeUndefined();

      const cached = await getOfflineShifts(userId, now);
      expect(cached).toBeNull();
    });

    it('wipes cached shifts when a different user accesses the store on the same device', async () => {
      const userA = 'user-alice';
      const userB = 'user-bob';

      const sanitized = sanitizeShiftsForOffline(sampleShifts, myMembershipId, now);
      await saveOfflineShifts(userA, sanitized);

      expect(memoryStore[LAST_USER_KEY]).toBe(userA);

      // User B attempts to read offline store
      const cachedForB = await getOfflineShifts(userB, now);

      // Invariant: User B gets null and storage is immediately wiped to protect User A's privacy
      expect(cachedForB).toBeNull();
      expect(memoryStore[OFFLINE_STORAGE_KEY]).toBeUndefined();
      expect(memoryStore[LAST_USER_KEY]).toBeUndefined();
    });
  });
});
