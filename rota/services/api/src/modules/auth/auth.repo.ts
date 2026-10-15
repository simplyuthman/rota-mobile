/**
 * =============================================================================
 * Rota API — Auth Repository
 * =============================================================================
 * AGENTS.md §4 (L-05) & Decision 001:
 * All SQL for auth entities is located here.
 * Operates on the control-plane Kysely instance.
 */

import { controlPlane } from '../../db/index.js';
import type {
  UsersTable,
  AuthSessionsTable,
  AuthTokensTable,
  UserTeamIndexTable,
  UserSettingsTable,
} from '../../db/schema.js';
import type { Selectable, Insertable, Updateable } from 'kysely';

export type UserRow = Selectable<UsersTable>;
export type NewUserRow = Insertable<UsersTable>;
export type SessionRow = Selectable<AuthSessionsTable>;
export type NewSessionRow = Insertable<AuthSessionsTable>;
export type TokenRow = Selectable<AuthTokensTable>;
export type NewTokenRow = Insertable<AuthTokensTable>;
export type UserTeamRow = Selectable<UserTeamIndexTable>;
export type UserSettingsRow = Selectable<UserSettingsTable>;

export const authRepo = {
  async createUser(data: {
    email: string;
    email_normalized: string;
    password_hash: string | null;
    display_name: string;
    email_verified_at?: Date | null;
    status?: 'active' | 'suspended' | 'pending_deletion';
  }): Promise<UserRow> {
    return await controlPlane
      .insertInto('users')
      .values({
        email: data.email,
        email_normalized: data.email_normalized,
        password_hash: data.password_hash,
        display_name: data.display_name,
        email_verified_at: data.email_verified_at ?? null,
        status: data.status ?? 'active',
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  async findUserByNormalizedEmail(emailNormalized: string): Promise<UserRow | undefined> {
    return await controlPlane
      .selectFrom('users')
      .selectAll()
      .where('email_normalized', '=', emailNormalized)
      .executeTakeFirst();
  },

  async findUserById(id: string): Promise<UserRow | undefined> {
    return await controlPlane
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  },

  async markEmailVerified(userId: string): Promise<void> {
    await controlPlane
      .updateTable('users')
      .set({ email_verified_at: new Date(), updated_at: new Date() })
      .where('id', '=', userId)
      .execute();
  },

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await controlPlane
      .updateTable('users')
      .set({ password_hash: passwordHash, updated_at: new Date() })
      .where('id', '=', userId)
      .execute();
  },

  async createSession(data: {
    user_id: string;
    refresh_token_hash: string;
    token_family_id: string;
    expires_at: Date;
    device_label?: string | null;
    ip_hash?: string | null;
    user_agent_summary?: string | null;
  }): Promise<SessionRow> {
    return await controlPlane
      .insertInto('auth_sessions')
      .values({
        user_id: data.user_id,
        refresh_token_hash: data.refresh_token_hash,
        token_family_id: data.token_family_id,
        expires_at: data.expires_at,
        device_label: data.device_label ?? null,
        ip_hash: data.ip_hash ?? null,
        user_agent_summary: data.user_agent_summary ?? null,
        consumed_at: null,
        revoked_at: null,
        replaced_by_session_id: null,
        last_used_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  async findSessionByRefreshTokenHash(tokenHash: string): Promise<SessionRow | undefined> {
    return await controlPlane
      .selectFrom('auth_sessions')
      .selectAll()
      .where('refresh_token_hash', '=', tokenHash)
      .executeTakeFirst();
  },

  async rotateSession(
    consumedSessionId: string,
    newSessionData: {
      user_id: string;
      refresh_token_hash: string;
      token_family_id: string;
      expires_at: Date;
      device_label?: string | null;
      ip_hash?: string | null;
      user_agent_summary?: string | null;
    }
  ): Promise<SessionRow> {
    return await controlPlane.transaction().execute(async (trx) => {
      const newSession = await trx
        .insertInto('auth_sessions')
        .values({
          user_id: newSessionData.user_id,
          refresh_token_hash: newSessionData.refresh_token_hash,
          token_family_id: newSessionData.token_family_id,
          expires_at: newSessionData.expires_at,
          device_label: newSessionData.device_label ?? null,
          ip_hash: newSessionData.ip_hash ?? null,
          user_agent_summary: newSessionData.user_agent_summary ?? null,
          consumed_at: null,
          revoked_at: null,
          replaced_by_session_id: null,
          last_used_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('auth_sessions')
        .set({
          consumed_at: new Date(),
          replaced_by_session_id: newSession.id,
        })
        .where('id', '=', consumedSessionId)
        .execute();

      return newSession;
    });
  },

  async revokeSessionFamily(tokenFamilyId: string): Promise<void> {
    await controlPlane
      .updateTable('auth_sessions')
      .set({ revoked_at: new Date() })
      .where('token_family_id', '=', tokenFamilyId)
      .where('revoked_at', 'is', null)
      .execute();
  },

  async revokeAllUserSessions(userId: string): Promise<string[]> {
    // Get all active family IDs for this user to invalidate in Redis
    const activeSessions = await controlPlane
      .selectFrom('auth_sessions')
      .select('token_family_id')
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();

    const familyIds = [...new Set(activeSessions.map((s) => s.token_family_id))];

    await controlPlane
      .updateTable('auth_sessions')
      .set({ revoked_at: new Date() })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();

    return familyIds;
  },

  async createAuthToken(data: {
    kind: 'password_reset' | 'magic_link' | 'email_verify_code';
    token_hash: string;
    user_id?: string | null;
    email?: string | null;
    expires_at: Date;
  }): Promise<TokenRow> {
    return await controlPlane
      .insertInto('auth_tokens')
      .values({
        kind: data.kind,
        token_hash: data.token_hash,
        user_id: data.user_id ?? null,
        email: data.email ?? null,
        attempts: 0,
        expires_at: data.expires_at,
        consumed_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  async findAuthTokenByHash(
    tokenHash: string,
    kind: 'password_reset' | 'magic_link' | 'email_verify_code'
  ): Promise<TokenRow | undefined> {
    return await controlPlane
      .selectFrom('auth_tokens')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .where('kind', '=', kind)
      .executeTakeFirst();
  },

  async consumeAuthToken(id: string): Promise<void> {
    await controlPlane
      .updateTable('auth_tokens')
      .set({ consumed_at: new Date() })
      .where('id', '=', id)
      .execute();
  },

  async incrementTokenAttempts(id: string): Promise<number> {
    const updated = await controlPlane
      .updateTable('auth_tokens')
      .set((eb) => ({ attempts: eb('attempts', '+', 1) }))
      .where('id', '=', id)
      .returning('attempts')
      .executeTakeFirstOrThrow();

    return updated.attempts;
  },

  async getUserTeams(userId: string): Promise<UserTeamRow[]> {
    return await controlPlane
      .selectFrom('user_team_index')
      .selectAll()
      .where('user_id', '=', userId)
      .execute();
  },

  async findUserSettings(userId: string): Promise<UserSettingsRow | undefined> {
    return await controlPlane
      .selectFrom('user_settings')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst();
  },

  async upsertUserSettings(data: {
    user_id: string;
    timezone: string;
    theme?: 'light' | 'dark' | 'system';
  }): Promise<void> {
    await controlPlane
      .insertInto('user_settings')
      .values({
        user_id: data.user_id,
        timezone: data.timezone,
        theme: data.theme ?? 'system',
        quiet_hours_enabled: false,
        quiet_hours_start: null,
        quiet_hours_end: null,
        notification_preferences: {},
        language: 'en',
        field_updated_at: {},
        version: 1,
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column('user_id').doUpdateSet({
          timezone: data.timezone,
          theme: data.theme ?? 'system',
          updated_at: new Date(),
        })
      )
      .execute();
  },
};
