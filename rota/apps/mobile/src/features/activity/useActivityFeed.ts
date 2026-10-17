/**
 * =============================================================================
 * Rota Mobile — Activity Feed Hook
 * =============================================================================
 * AGENTS.md §2.1 (TanStack Query for server data) & Rule D-01 (Cursor pagination).
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import type { ActivityFeedResponse } from '@rota/contracts';
import { useCurrentUser } from '../auth/useAuth';
import { useUIStore } from '../../state/uiStore';

export const ACTIVITY_KEYS = {
  feed: (teamId: string) => ['activity', 'feed', teamId] as const,
};

export function useActivityFeed() {
  const { data: currentUser } = useCurrentUser();
  const { selectedTeamId } = useUIStore();
  const teams = currentUser?.teams ?? [];
  const activeTeam = teams.find((t) => t.id === selectedTeamId) ?? teams[0];
  const teamId = activeTeam?.id;

  return useInfiniteQuery<ActivityFeedResponse, Error>({
    queryKey: ACTIVITY_KEYS.feed(teamId ?? ''),
    queryFn: async ({ pageParam }) => {
      if (!teamId) {
        return { items: [], nextCursor: null };
      }
      const response = await apiClient.get<ActivityFeedResponse>(
        `/teams/${teamId}/activity`,
        {
          params: {
            cursor: pageParam || undefined,
            limit: 20,
          },
        }
      );
      return response.data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!teamId,
  });
}
