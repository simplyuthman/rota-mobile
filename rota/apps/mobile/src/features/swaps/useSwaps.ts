/**
 * =============================================================================
 * Rota Mobile — Swaps Query & Mutation Hooks
 * =============================================================================
 * AGENTS.md §2.1 (TanStack Query for all server data) & Rule A-10.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import type {
  SwapRequestDto,
  CreateSwapRequest,
  RespondSwapRequest,
  ReviewSwapRequest,
} from '@rota/contracts';
import { SHIFT_KEYS } from '../shifts/useShifts';
import { ACTIVITY_KEYS } from '../activity/useActivityFeed';

export const SWAP_KEYS = {
  list: (teamId: string) => ['swaps', 'list', teamId] as const,
};

export function useSwaps(teamId?: string) {
  return useQuery<SwapRequestDto[]>({
    queryKey: SWAP_KEYS.list(teamId ?? ''),
    queryFn: async () => {
      if (!teamId) return [];
      const response = await apiClient.get<{ swaps: SwapRequestDto[] }>(
        `/teams/${teamId}/swaps`
      );
      return response.data.swaps;
    },
    enabled: !!teamId,
  });
}

export function useCreateSwap(teamId?: string) {
  const queryClient = useQueryClient();

  return useMutation<SwapRequestDto, Error, { shiftId: string; payload: CreateSwapRequest }>({
    mutationFn: async ({ shiftId, payload }) => {
      if (!teamId) throw new Error('No team selected');
      const response = await apiClient.post<{ swap: SwapRequestDto }>(
        `/teams/${teamId}/shifts/${shiftId}/swaps`,
        payload
      );
      return response.data.swap;
    },
    onSuccess: () => {
      if (teamId) {
        queryClient.invalidateQueries({ queryKey: SWAP_KEYS.list(teamId) });
        queryClient.invalidateQueries({ queryKey: SHIFT_KEYS.list(teamId) });
        queryClient.invalidateQueries({ queryKey: ACTIVITY_KEYS.feed(teamId) });
      }
    },
  });
}

export function useRespondSwap(teamId?: string) {
  const queryClient = useQueryClient();

  return useMutation<SwapRequestDto, Error, { swapId: string; payload: RespondSwapRequest }>({
    mutationFn: async ({ swapId, payload }) => {
      if (!teamId) throw new Error('No team selected');
      const response = await apiClient.post<{ swap: SwapRequestDto }>(
        `/teams/${teamId}/swaps/${swapId}/respond`,
        payload
      );
      return response.data.swap;
    },
    onSuccess: () => {
      if (teamId) {
        queryClient.invalidateQueries({ queryKey: SWAP_KEYS.list(teamId) });
        queryClient.invalidateQueries({ queryKey: ACTIVITY_KEYS.feed(teamId) });
      }
    },
  });
}

export function useReviewSwap(teamId?: string) {
  const queryClient = useQueryClient();

  return useMutation<SwapRequestDto, Error, { swapId: string; payload: ReviewSwapRequest }>({
    mutationFn: async ({ swapId, payload }) => {
      if (!teamId) throw new Error('No team selected');
      const response = await apiClient.post<{ swap: SwapRequestDto }>(
        `/teams/${teamId}/swaps/${swapId}/review`,
        payload
      );
      return response.data.swap;
    },
    onSuccess: () => {
      if (teamId) {
        queryClient.invalidateQueries({ queryKey: SWAP_KEYS.list(teamId) });
        queryClient.invalidateQueries({ queryKey: SHIFT_KEYS.list(teamId) });
        queryClient.invalidateQueries({ queryKey: ACTIVITY_KEYS.feed(teamId) });
      }
    },
  });
}
