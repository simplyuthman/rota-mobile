/**
 * =============================================================================
 * Rota Mobile — User Settings Query & Mutation Hooks
 * =============================================================================
 * AGENTS.md §2.1 (TanStack Query for server state), §3.4 (P-07, P-08).
 * - Detects device IANA timezone on launch (never default to UTC)
 * - Optimistic updates with rollback on network/server error
 * =============================================================================
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import type { UserSettingsDto, UpdateUserSettingsRequest } from '@rota/contracts';

export const SETTINGS_KEYS = {
  user: ['settings', 'me'] as const,
};

export function getDeviceTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === 'string') return tz;
  } catch {
    // Fallback if resolvedOptions fails
  }
  return 'Europe/London';
}

export function useSettings() {
  const deviceTimezone = getDeviceTimezone();

  return useQuery<UserSettingsDto>({
    queryKey: SETTINGS_KEYS.user,
    queryFn: async () => {
      const response = await apiClient.get<UserSettingsDto>(
        `/me/settings?timezone=${encodeURIComponent(deviceTimezone)}`
      );
      return response.data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation<UserSettingsDto, Error, UpdateUserSettingsRequest, { previousSettings?: UserSettingsDto }>({
    mutationFn: async (patch) => {
      const response = await apiClient.patch<UserSettingsDto>('/me/settings', patch);
      return response.data;
    },
    onMutate: async (newPatch) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: SETTINGS_KEYS.user });

      // Snapshot previous settings
      const previousSettings = queryClient.getQueryData<UserSettingsDto>(SETTINGS_KEYS.user);

      // Optimistically update
      if (previousSettings) {
        queryClient.setQueryData<UserSettingsDto>(SETTINGS_KEYS.user, {
          ...previousSettings,
          ...newPatch,
          notificationPreferences: {
            ...previousSettings.notificationPreferences,
            ...(newPatch.notificationPreferences ?? {}),
          },
          version: previousSettings.version + 1,
        });
      }

      return { previousSettings };
    },
    onError: (_err, _newPatch, context) => {
      // Rollback on error
      if (context?.previousSettings) {
        queryClient.setQueryData(SETTINGS_KEYS.user, context.previousSettings);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEYS.user });
    },
  });
}
