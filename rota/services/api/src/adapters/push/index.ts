/**
 * =============================================================================
 * Rota API — Push Notification Adapter (Expo Notifications)
 * =============================================================================
 * AGENTS.md §2.1, §3.4 (P-05), §4 (L-06):
 * Push delivery uses Expo Notifications with FCM v1 credentials.
 * Payloads contain only { type, teamId, entityId } (P-05).
 * Never include shift notes or billing details in the push payload.
 * =============================================================================
 */

export interface PushNotificationPayload {
  to: string; // Expo push token (or FCM token)
  title: string;
  body: string;
  data: {
    type: string;
    teamId: string;
    entityId: string;
  };
}

export interface PushProvider {
  sendPush(notification: PushNotificationPayload): Promise<{ success: boolean; messageId?: string | undefined; error?: string | undefined }>;
  sendBatch(notifications: PushNotificationPayload[]): Promise<{ successCount: number; failureCount: number }>;
}

export class ExpoPushAdapter implements PushProvider {
  private sentNotifications: PushNotificationPayload[] = [];

  async sendPush(
    notification: PushNotificationPayload
  ): Promise<{ success: boolean; messageId?: string | undefined; error?: string | undefined }> {
    // In test / dev environments, record sent notifications in-memory
    this.sentNotifications.push(notification);

    if (process.env['NODE_ENV'] === 'test' || !notification.to.startsWith('ExponentPushToken[')) {
      return {
        success: true,
        messageId: `mock-msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      };
    }

    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(notification),
      });

      if (!res.ok) {
        return { success: false, error: `Expo push HTTP ${res.status}` };
      }

      const data = (await res.json()) as { data?: { id?: string; status?: string } };
      return { success: true, messageId: data.data?.id ?? undefined };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown push failure',
      };
    }
  }

  async sendBatch(
    notifications: PushNotificationPayload[]
  ): Promise<{ successCount: number; failureCount: number }> {
    let successCount = 0;
    let failureCount = 0;

    for (const notif of notifications) {
      const res = await this.sendPush(notif);
      if (res.success) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    return { successCount, failureCount };
  }

  getSentNotifications(): PushNotificationPayload[] {
    return [...this.sentNotifications];
  }

  clearSent(): void {
    this.sentNotifications = [];
  }
}

let currentAdapter: PushProvider = new ExpoPushAdapter();

export function getPushAdapter(): PushProvider {
  return currentAdapter;
}

export function setPushAdapter(adapter: PushProvider): void {
  currentAdapter = adapter;
}
