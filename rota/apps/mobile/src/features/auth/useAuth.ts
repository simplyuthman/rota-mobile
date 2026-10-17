/**
 * =============================================================================
 * Rota Mobile — Authentication Hooks & API Queries
 * =============================================================================
 * AGENTS.md §2.1 (TanStack Query for server data, SecureStore for tokens).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { setAccessToken, setRefreshToken, clearAuthTokens, getAccessToken } from '../../storage/secureStore';
import type {
  SignInPasswordRequest,
  SignUpRequest,
  AuthResponse,
  MeResponse,
  AcceptInvitationRequest,
} from '@rota/contracts';

import { wipeOfflineShifts } from '../../storage/offlineStore';

export const AUTH_KEYS = {
  me: ['auth', 'me'] as const,
  invite: (token: string) => ['auth', 'invite', token] as const,
};

export function useCurrentUser() {
  return useQuery<MeResponse | null>({
    queryKey: AUTH_KEYS.me,
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) return null;

      try {
        const response = await apiClient.get<MeResponse>('/me');
        return response.data;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSignIn() {
  const queryClient = useQueryClient();

  return useMutation<AuthResponse, Error, SignInPasswordRequest>({
    mutationFn: async (credentials) => {
      const response = await apiClient.post<AuthResponse>('/auth/login', credentials);
      return response.data;
    },
    onSuccess: async (data) => {
      await wipeOfflineShifts(); // Rule P-01: clear previous user cache on sign-in
      await setAccessToken(data.session.accessToken);
      await setRefreshToken(data.session.refreshToken);
      await queryClient.invalidateQueries({ queryKey: AUTH_KEYS.me });
    },
  });
}

export function useSignUp() {
  const queryClient = useQueryClient();

  return useMutation<AuthResponse, Error, SignUpRequest>({
    mutationFn: async (credentials) => {
      const response = await apiClient.post<AuthResponse>('/auth/signup', credentials);
      return response.data;
    },
    onSuccess: async (data) => {
      await wipeOfflineShifts(); // Rule P-01
      await setAccessToken(data.session.accessToken);
      await setRefreshToken(data.session.refreshToken);
      await queryClient.invalidateQueries({ queryKey: AUTH_KEYS.me });
    },
  });
}

export function useRequestMagicLink() {
  return useMutation<{ message: string }, Error, { email: string }>({
    mutationFn: async ({ email }) => {
      const response = await apiClient.post<{ message: string }>('/auth/magic-link', { email });
      return response.data;
    },
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, void>({
    mutationFn: async () => {
      try {
        await apiClient.post('/auth/logout');
      } catch {
        // Continue clearing client storage regardless of network error
      } finally {
        await clearAuthTokens();
        await wipeOfflineShifts(); // Rule P-01: wipe persisted shift cache on logout
        queryClient.removeQueries();
      }
    },
  });
}

export function useInviteDetails(token: string) {
  return useQuery({
    queryKey: AUTH_KEYS.invite(token),
    queryFn: async () => {
      if (!token) return null;
      const response = await apiClient.get<{
        invitation: {
          teamId: string;
          teamName: string;
          role: 'manager' | 'staff';
          email: string | null;
          expiresAt: string;
        };
      }>(`/invitations/${encodeURIComponent(token)}`);
      return response.data.invitation;
    },
    enabled: !!token && token.includes('.'),
  });
}

export function useAcceptInvitation() {
  const queryClient = useQueryClient();

  return useMutation<{ membership: unknown; teamId: string }, Error, AcceptInvitationRequest>({
    mutationFn: async (payload) => {
      const response = await apiClient.post<{ membership: unknown; teamId: string }>(
        '/invitations/accept',
        payload
      );
      return response.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: AUTH_KEYS.me });
    },
  });
}
