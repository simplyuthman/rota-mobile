/**
 * =============================================================================
 * Rota API — Push Notification Adapter Stub (Expo Notifications)
 * =============================================================================
 * AGENTS.md §2.1 & §4 (L-06):
 * Push delivery uses Expo Notifications with FCM v1 credentials.
 * Payloads contain only { type, teamId, entityId } (P-05).
 */

export interface PushNotificationPayload {
  to: string; // Expo push token
  title: string;
  body: string;
  data: {
    type: string;
    teamId: string;
    entityId: string;
  };
}

export interface PushProvider {
  sendPush(notification: PushNotificationPayload): Promise<{ success: boolean; error?: string }>;
  sendBatch(notifications: PushNotificationPayload[]): Promise<{ successCount: number }>;
}

export class ExpoPushAdapter implements PushProvider {
  async sendPush(_notification: PushNotificationPayload): Promise<{ success: boolean; error?: string }> {
    throw new Error('ExpoPushAdapter not yet implemented — Phase 6 scope');
  }

  async sendBatch(_notifications: PushNotificationPayload[]): Promise<{ successCount: number }> {
    throw new Error('ExpoPushAdapter not yet implemented — Phase 6 scope');
  }
}
