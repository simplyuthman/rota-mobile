/**
 * =============================================================================
 * Rota Mobile — Teams & Memberships Query & Mutation Hooks
 * =============================================================================
 * AGENTS.md §2.1 (TanStack Query for all server data), §3.2 (A-02, A-04, A-05).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { AUTH_KEYS } from '../auth/useAuth';
import type {
  TeamDto,
  TeamMembershipDto,
  CreateTeamRequest,
  CreateInvitationRequest,
  InvitationDto,
  Role,
} from '@rota/contracts';

export const TEAM_KEYS = {
  detail: (teamId: string) => ['teams', teamId, 'detail'] as const,
  members: (teamId: string) => ['teams', teamId, 'members'] as const,
};

export function useTeamDetails(teamId?: string) {
  return useQuery<TeamDto>({
    queryKey: TEAM_KEYS.detail(teamId ?? ''),
    queryFn: async () => {
      if (!teamId) throw new Error('No team specified');
      const response = await apiClient.get<{ team: TeamDto }>(`/teams/${teamId}`);
      return response.data.team;
    },
    enabled: !!teamId,
  });
}

export function useTeamMembers(teamId?: string) {
  return useQuery<TeamMembershipDto[]>({
    queryKey: TEAM_KEYS.members(teamId ?? ''),
    queryFn: async () => {
      if (!teamId) return [];
      const response = await apiClient.get<{ members: TeamMembershipDto[] }>(
        `/teams/${teamId}/members`
      );
      return response.data.members;
    },
    enabled: !!teamId,
  });
}

export function useCreateTeam() {
  const queryClient = useQueryClient();

  return useMutation<TeamDto, Error, CreateTeamRequest>({
    mutationFn: async (payload) => {
      const response = await apiClient.post<{ team: TeamDto }>('/teams', payload);
      return response.data.team;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: AUTH_KEYS.me });
    },
  });
}

export function useCreateInvitation(teamId?: string) {
  return useMutation<InvitationDto, Error, CreateInvitationRequest>({
    mutationFn: async (payload) => {
      if (!teamId) throw new Error('No team selected');
      const response = await apiClient.post<{ invitation: InvitationDto }>(
        `/teams/${teamId}/invitations`,
        payload
      );
      return response.data.invitation;
    },
  });
}

export function useUpdateMemberRoleOrStatus(teamId?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    TeamMembershipDto,
    Error,
    { memberId: string; data: { role?: Role; status?: 'active' | 'suspended' | 'removed' } }
  >({
    mutationFn: async ({ memberId, data }) => {
      if (!teamId) throw new Error('No team selected');
      const response = await apiClient.patch<{ member: TeamMembershipDto }>(
        `/teams/${teamId}/members/${memberId}`,
        data
      );
      return response.data.member;
    },
    onSuccess: () => {
      if (teamId) {
        queryClient.invalidateQueries({ queryKey: TEAM_KEYS.members(teamId) });
      }
    },
  });
}
