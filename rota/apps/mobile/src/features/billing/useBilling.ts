/**
 * =============================================================================
 * Rota Mobile — Subscriptions & Billing Query & Mutation Hooks
 * =============================================================================
 * AGENTS.md §2.1 (TanStack Query for all server data).
 * AGENTS.md §3.1 (M-01 through M-15).
 * =============================================================================
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import type {
  SubscriptionDto,
  BillingQuoteDto,
  BillingQuoteRequest,
  CheckoutRequest,
  CheckoutResponse,
  BillingLedgerEntryDto,
} from '@rota/contracts';

export const BILLING_KEYS = {
  subscription: (teamId: string) => ['billing', 'subscription', teamId] as const,
  plans: (teamId: string) => ['billing', 'plans', teamId] as const,
  ledger: (teamId: string) => ['billing', 'ledger', teamId] as const,
  rebuildCheck: (teamId: string) => ['billing', 'rebuildCheck', teamId] as const,
};

export function useSubscription(teamId?: string) {
  return useQuery<SubscriptionDto>({
    queryKey: BILLING_KEYS.subscription(teamId ?? ''),
    queryFn: async () => {
      if (!teamId) throw new Error('No team selected');
      const response = await apiClient.get<{ subscription: SubscriptionDto }>(
        `/teams/${teamId}/billing`
      );
      return response.data.subscription;
    },
    enabled: !!teamId,
  });
}

export function useBillingLedger(teamId?: string) {
  return useQuery<BillingLedgerEntryDto[]>({
    queryKey: BILLING_KEYS.ledger(teamId ?? ''),
    queryFn: async () => {
      if (!teamId) return [];
      const response = await apiClient.get<{ ledger: BillingLedgerEntryDto[] }>(
        `/teams/${teamId}/billing/ledger`
      );
      return response.data.ledger;
    },
    enabled: !!teamId,
  });
}

export function useCreateBillingQuote(teamId?: string) {
  return useMutation<BillingQuoteDto, Error, BillingQuoteRequest>({
    mutationFn: async (payload) => {
      if (!teamId) throw new Error('No team selected');
      const response = await apiClient.post<{ quote: BillingQuoteDto }>(
        `/teams/${teamId}/billing/quotes`,
        payload
      );
      return response.data.quote;
    },
  });
}

export function useCreateCheckout(teamId?: string) {
  const queryClient = useQueryClient();

  return useMutation<CheckoutResponse, Error, CheckoutRequest>({
    mutationFn: async (payload) => {
      if (!teamId) throw new Error('No team selected');
      const response = await apiClient.post<CheckoutResponse>(
        `/teams/${teamId}/billing/checkout`,
        payload
      );
      return response.data;
    },
    onSuccess: () => {
      if (teamId) {
        queryClient.invalidateQueries({ queryKey: BILLING_KEYS.subscription(teamId) });
        queryClient.invalidateQueries({ queryKey: BILLING_KEYS.ledger(teamId) });
      }
    },
  });
}

export function useRebuildCheck(teamId?: string) {
  return useQuery({
    queryKey: BILLING_KEYS.rebuildCheck(teamId ?? ''),
    queryFn: async () => {
      if (!teamId) return null;
      const response = await apiClient.get<{ rebuilt: { plan: string; purchasedSeats: number } }>(
        `/teams/${teamId}/billing/rebuild-check`
      );
      return response.data.rebuilt;
    },
    enabled: !!teamId,
  });
}
