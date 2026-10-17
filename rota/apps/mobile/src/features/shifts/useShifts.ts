/**
 * =============================================================================
 * Rota Mobile — Shifts Query & Mutation Hooks
 * =============================================================================
 * AGENTS.md §2.1 (TanStack Query for all server data).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import type { ShiftDto, ShiftPublicDto, CreateShiftRequest } from '@rota/contracts';
import { ACTIVITY_KEYS } from '../activity/useActivityFeed';

import {
  saveOfflineShifts,
  getOfflineShifts,
  sanitizeShiftsForOffline,
  type OfflineShift,
} from '../../storage/offlineStore';
import { useNetworkStore } from '../../state/networkStore';

export const SHIFT_KEYS = {
  list: (teamId: string) => ['shifts', 'list', teamId] as const,
  detail: (teamId: string, shiftId: string) => ['shifts', 'detail', teamId, shiftId] as const,
  upcoming: (teamId: string, membershipId: string) =>
    ['shifts', 'upcoming', teamId, membershipId] as const,
};

export function useShifts(teamId?: string) {
  return useQuery<(ShiftDto | ShiftPublicDto)[]>({
    queryKey: SHIFT_KEYS.list(teamId ?? ''),
    queryFn: async () => {
      if (!teamId) return [];
      const response = await apiClient.get<{ shifts: (ShiftDto | ShiftPublicDto)[] }>(
        `/teams/${teamId}/shifts`
      );
      return response.data.shifts;
    },
    enabled: !!teamId,
  });
}

/**
 * Rule P-02: Persist published shifts assigned to user in the next 30 days.
 * Strips notes. Falls back to AsyncStorage cache when offline.
 */
export function useUpcomingShifts(
  teamId?: string,
  membershipId?: string,
  userId?: string
) {
  const isOnline = useNetworkStore((s) => s.effectiveIsOnline());
  const setLastSyncTime = useNetworkStore((s) => s.setLastSyncTime);

  return useQuery<{
    shifts: OfflineShift[];
    isOffline: boolean;
    syncedAt?: Date;
    isExpired: boolean;
  }>({
    queryKey: SHIFT_KEYS.upcoming(teamId ?? '', membershipId ?? ''),
    queryFn: async () => {
      if (!teamId || !membershipId || !userId) {
        return { shifts: [], isOffline: false, isExpired: false };
      }

      // If simulated offline or disconnected, read from offline store immediately
      if (!isOnline) {
        const cached = await getOfflineShifts(userId);
        return {
          shifts: cached?.shifts ?? [],
          isOffline: true,
          syncedAt: cached?.syncedAt,
          isExpired: cached?.isExpired ?? false,
        };
      }

      try {
        const response = await apiClient.get<{ shifts: (ShiftDto | ShiftPublicDto)[] }>(
          `/teams/${teamId}/shifts`
        );
        const allShifts = response.data.shifts;

        // Sanitize and filter: next 30 days, assigned to user, published, no notes (Rule P-02)
        const sanitized = sanitizeShiftsForOffline(allShifts, membershipId);

        // Persist to offline store
        await saveOfflineShifts(userId, sanitized);
        setLastSyncTime(new Date().toISOString());

        return {
          shifts: sanitized,
          isOffline: false,
          syncedAt: new Date(),
          isExpired: false,
        };
      } catch (err) {
        // Fallback to offline store on network error
        const cached = await getOfflineShifts(userId);
        return {
          shifts: cached?.shifts ?? [],
          isOffline: true,
          syncedAt: cached?.syncedAt,
          isExpired: cached?.isExpired ?? false,
        };
      }
    },
    enabled: !!teamId && !!membershipId && !!userId,
  });
}

export function useCreateShift(teamId?: string) {
  const queryClient = useQueryClient();

  return useMutation<ShiftDto, Error, CreateShiftRequest>({
    mutationFn: async (payload) => {
      if (!teamId) throw new Error('No team selected');
      const response = await apiClient.post<{ shift: ShiftDto }>(
        `/teams/${teamId}/shifts`,
        payload
      );
      return response.data.shift;
    },
    onSuccess: () => {
      if (teamId) {
        queryClient.invalidateQueries({ queryKey: SHIFT_KEYS.list(teamId) });
      }
    },
  });
}

export function usePublishShift(teamId?: string) {
  const queryClient = useQueryClient();

  return useMutation<ShiftDto, Error, { shiftId: string; assignMembershipId?: string }>({
    mutationFn: async ({ shiftId, assignMembershipId }) => {
      if (!teamId) throw new Error('No team selected');
      const response = await apiClient.post<{ shift: ShiftDto }>(
        `/teams/${teamId}/shifts/${shiftId}/publish`,
        { assignMembershipId }
      );
      return response.data.shift;
    },
    onSuccess: () => {
      if (teamId) {
        queryClient.invalidateQueries({ queryKey: SHIFT_KEYS.list(teamId) });
        queryClient.invalidateQueries({ queryKey: ACTIVITY_KEYS.feed(teamId) });
      }
    },
  });
}

export function useCancelShift(teamId?: string) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { shiftId: string }>({
    mutationFn: async ({ shiftId }) => {
      if (!teamId) throw new Error('No team selected');
      await apiClient.delete(`/teams/${teamId}/shifts/${shiftId}`);
    },
    onSuccess: () => {
      if (teamId) {
        queryClient.invalidateQueries({ queryKey: SHIFT_KEYS.list(teamId) });
        queryClient.invalidateQueries({ queryKey: ACTIVITY_KEYS.feed(teamId) });
      }
    },
  });
}
