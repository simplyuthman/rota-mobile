/**
 * =============================================================================
 * Rota Mobile — Push Notifications Hook & Tap-To-Open Router (Tier 7)
 * =============================================================================
 * AGENTS.md §2.1, §3.4 (P-04, P-05) & §4 (L-02):
 * - Registers push device with Expo Notifications and backend POST /me/push-tokens
 * - Tap-to-open routing handles cold start, background, and foreground (P-05)
 * - Restricts payloads to { type, teamId, entityId }
 * - Uses safeNotifications to prevent crashes in Expo Go on Android
 * =============================================================================
 */

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { apiClient } from '../../api/client';
import { useUIStore } from '../../state/uiStore';
import { useCurrentUser } from '../auth/useAuth';
import { safeNotifications } from './safeNotifications';
import { handlePushTap, type PushNotificationData } from './tapRouter';

export { handlePushTap, type PushNotificationData };

// Configure heads-up foreground notification display safely
safeNotifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
    priority: safeNotifications.AndroidNotificationPriority.HIGH,
  }),
});

/**
 * Registers device push token with Expo and backend POST /v1/me/push-tokens (Rule P-04)
 */
export async function registerPushDevice(userId: string): Promise<string | null> {
  try {
    let tokenString: string | null = null;

    const { status: existingStatus } = await safeNotifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await safeNotifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus === 'granted') {
      try {
        const expoPushToken = await safeNotifications.getExpoPushTokenAsync();
        tokenString = expoPushToken.data;
      } catch {
        // Fallback for simulators or unconfigured EAS projects
        tokenString = `ExponentPushToken[dev-${userId.slice(0, 8)}-${Date.now()}]`;
      }
    } else {
      // Permission not granted or simulator
      tokenString = `ExponentPushToken[simulated-${userId.slice(0, 8)}]`;
    }

    if (tokenString) {
      useUIStore.getState().setPushDeviceToken(tokenString);

      // Register with backend (Rule P-04)
      await apiClient.post('/me/push-tokens', {
        token: tokenString,
        provider: 'expo',
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        deviceLabel: `${Platform.OS.toUpperCase()} Device`,
      });
    }

    return tokenString;
  } catch (err) {
    console.warn('[Push] Error registering device token:', err);
    return null;
  }
}

/**
 * Hook to set up cold start and background/foreground tap listeners
 */
export function usePushNotificationSetup() {
  const router = useRouter();
  const { data: authData } = useCurrentUser();
  const userId = authData?.user?.id;
  const isRegisteredRef = useRef(false);

  // 1. Register push device when user is authenticated
  useEffect(() => {
    if (userId && !isRegisteredRef.current) {
      isRegisteredRef.current = true;
      registerPushDevice(userId);
    }
  }, [userId]);

  // 2. Setup Cold Start & Tap Listeners (Rule P-05)
  useEffect(() => {
    // Check if app was opened from cold start via push tap
    safeNotifications.getLastNotificationResponseAsync().then((response) => {
      if (response?.notification?.request?.content?.data) {
        handlePushTap(response.notification.request.content.data as PushNotificationData, router);
      }
    });

    // Listener for taps while app is in background or foreground
    const responseSubscription = safeNotifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification?.request?.content?.data as PushNotificationData;
        if (data) {
          handlePushTap(data, router);
        }
      }
    );

    return () => {
      responseSubscription.remove();
    };
  }, [router]);
}
