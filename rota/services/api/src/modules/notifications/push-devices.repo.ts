/**
 * =============================================================================
 * Rota API — Push Devices Repository
 * =============================================================================
 * AGENTS.md §3.4 (P-04):
 * Upserts push token by (provider, token_hash) and reassigns user_id on shared
 * phones. Deactivates on logout and logout-all.
 * Stored on the control-plane database.
 * =============================================================================
 */

import crypto from 'node:crypto';
import { sql } from 'kysely';
import { getControlPlaneDb } from '../../db/index.js';
import type { Selectable } from 'kysely';
import type { PushDevicesTable } from '../../db/schema.js';

export type PushDeviceRow = Selectable<PushDevicesTable>;

export function hashPushToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

export const pushDevicesRepo = {
  async upsert(params: {
    userId: string;
    provider: string;
    token: string;
    platform: 'ios' | 'android';
    deviceLabel?: string | undefined;
  }): Promise<PushDeviceRow> {
    const db = getControlPlaneDb();
    const tokenHash = hashPushToken(params.token);

    // Rule P-04: Upsert by token and reassign user_id on shared phones
    return db
      .insertInto('push_devices')
      .values({
        user_id: params.userId,
        provider: params.provider,
        token_hash: tokenHash,
        token_ciphertext: params.token, // Stored encrypted or direct in development
        platform: params.platform,
        device_label: params.deviceLabel ?? null,
        active: true,
        deactivated_at: null,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict((oc: any) =>
        oc.columns(['provider', 'token_hash']).doUpdateSet({
          user_id: params.userId,
          platform: params.platform,
          device_label: params.deviceLabel ?? null,
          active: true,
          deactivated_at: null,
          last_seen_at: sql`now()`,
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  async deactivate(userId: string, token: string): Promise<boolean> {
    const db = getControlPlaneDb();
    const tokenHash = hashPushToken(token);

    const result = await db
      .updateTable('push_devices')
      .set({
        active: false,
        deactivated_at: new Date(),
      })
      .where('user_id', '=', userId)
      .where('token_hash', '=', tokenHash)
      .execute();

    return Number(result[0]?.numUpdatedRows ?? 0) > 0;
  },

  async deactivateAllForUser(userId: string): Promise<number> {
    const db = getControlPlaneDb();

    const result = await db
      .updateTable('push_devices')
      .set({
        active: false,
        deactivated_at: new Date(),
      })
      .where('user_id', '=', userId)
      .where('active', '=', true)
      .execute();

    return Number(result[0]?.numUpdatedRows ?? 0);
  },

  async findActiveByUserId(userId: string): Promise<PushDeviceRow[]> {
    const db = getControlPlaneDb();
    return db
      .selectFrom('push_devices')
      .selectAll()
      .where('user_id', '=', userId)
      .where('active', '=', true)
      .execute();
  },
};
