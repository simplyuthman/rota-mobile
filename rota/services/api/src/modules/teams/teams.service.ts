/**
 * =============================================================================
 * Rota API — Teams Service
 * =============================================================================
 * AGENTS.md §2.2, §3.2 & Rule P-07:
 * Business rules for team creation, timezone validation, and trial initialization.
 */

import crypto from 'node:crypto';
import { teamsRepo } from './teams.repo.js';
import type { CreateTeamRequest, TeamDto } from '@rota/contracts';

export class TeamError extends Error {
  constructor(
    public code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'FORBIDDEN',
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'TeamError';
  }
}

export const teamsService = {
  isValidIanaTimezone(tz: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },

  async createTeam(userId: string, input: CreateTeamRequest): Promise<TeamDto> {
    const trimmedTimezone = input.timezone.trim();

    // Rule P-07: Validated as IANA name
    if (!this.isValidIanaTimezone(trimmedTimezone)) {
      throw new TeamError('VALIDATION_ERROR', `Invalid IANA timezone: ${trimmedTimezone}`, 400);
    }

    const teamId = crypto.randomUUID();

    const { team, membership } = await teamsRepo.createTeam({
      id: teamId,
      name: input.name.trim(),
      timezone: trimmedTimezone,
      userId,
    });

    return {
      id: team.id,
      name: team.name,
      timezone: team.timezone,
      role: membership.role as 'owner',
      status: team.status as 'active',
      createdAt: team.created_at.toISOString(),
    };
  },

  async getTeamById(teamId: string, userRole: 'owner' | 'manager' | 'staff'): Promise<TeamDto> {
    const team = await teamsRepo.findTeamById(teamId);
    if (!team) {
      throw new TeamError('NOT_FOUND', 'Team not found', 404);
    }

    return {
      id: team.id,
      name: team.name,
      timezone: team.timezone,
      role: userRole,
      status: team.status as 'active',
      createdAt: team.created_at.toISOString(),
    };
  },
};
