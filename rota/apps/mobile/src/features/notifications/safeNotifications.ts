/**
 * =============================================================================
 * Rota Mobile — Safe Notifications Wrapper
 * =============================================================================
 * AGENTS.md §2.1 (Android development build via EAS Build vs Expo Go fallback):
 * In Expo Go on Android (since SDK 53), remote push notifications and the native
 * module 'ExpoTopicSubscriptionModule' are removed from the Expo Go client.
 *
 * This wrapper:
 * 1. Detects Expo Go / missing native modules safely without crashing module load.
 * 2. Uses real expo-notifications native module in EAS Development Builds.
 * 3. Provides clean simulated fallbacks when running in Expo Go or simulators.
 * =============================================================================
 */

import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

export const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  // @ts-ignore
  Constants.appOwnership === 'expo';

export interface SafeNotificationsType {
  isAvailable: boolean;
  setNotificationHandler: (handler: any) => void;
  getPermissionsAsync: () => Promise<{ status: string }>;
  requestPermissionsAsync: () => Promise<{ status: string }>;
  getExpoPushTokenAsync: () => Promise<{ data: string }>;
  getLastNotificationResponseAsync: () => Promise<any>;
  addNotificationResponseReceivedListener: (
    listener: (response: any) => void
  ) => { remove: () => void };
  AndroidNotificationPriority: {
    HIGH: number;
    DEFAULT: number;
    LOW: number;
    MIN: number;
    MAX: number;
  };
}

let nativeNotifications: any = null;
let nativeAvailable = false;

// Do not attempt to load native expo-notifications on Android when running in Expo Go,
// as Expo Go removed ExpoTopicSubscriptionModule and remote push since SDK 53.
if (!(Platform.OS === 'android' && isExpoGo)) {
  try {
    nativeNotifications = require('expo-notifications');
    nativeAvailable = true;
  } catch (err) {
    console.warn(
      '[Notifications] Native expo-notifications module unavailable (running in Expo Go or simulator). Using fallback handler:',
      err
    );
    nativeNotifications = null;
    nativeAvailable = false;
  }
}

export const safeNotifications: SafeNotificationsType = {
  isAvailable: nativeAvailable,

  setNotificationHandler: (handler: any) => {
    if (nativeAvailable && nativeNotifications?.setNotificationHandler) {
      try {
        nativeNotifications.setNotificationHandler(handler);
      } catch (err) {
        console.warn('[Notifications] setNotificationHandler error:', err);
      }
    }
  },

  getPermissionsAsync: async () => {
    if (nativeAvailable && nativeNotifications?.getPermissionsAsync) {
      try {
        return await nativeNotifications.getPermissionsAsync();
      } catch (err) {
        console.warn('[Notifications] getPermissionsAsync error:', err);
      }
    }
    return { status: 'granted' };
  },

  requestPermissionsAsync: async () => {
    if (nativeAvailable && nativeNotifications?.requestPermissionsAsync) {
      try {
        return await nativeNotifications.requestPermissionsAsync();
      } catch (err) {
        console.warn('[Notifications] requestPermissionsAsync error:', err);
      }
    }
    return { status: 'granted' };
  },

  getExpoPushTokenAsync: async () => {
    if (nativeAvailable && nativeNotifications?.getExpoPushTokenAsync) {
      try {
        return await nativeNotifications.getExpoPushTokenAsync();
      } catch (err) {
        console.warn('[Notifications] getExpoPushTokenAsync error:', err);
      }
    }
    return { data: 'ExponentPushToken[expo-go-simulated-token]' };
  },

  getLastNotificationResponseAsync: async () => {
    if (nativeAvailable && nativeNotifications?.getLastNotificationResponseAsync) {
      try {
        return await nativeNotifications.getLastNotificationResponseAsync();
      } catch (err) {
        console.warn('[Notifications] getLastNotificationResponseAsync error:', err);
      }
    }
    return null;
  },

  addNotificationResponseReceivedListener: (listener: (response: any) => void) => {
    if (nativeAvailable && nativeNotifications?.addNotificationResponseReceivedListener) {
      try {
        return nativeNotifications.addNotificationResponseReceivedListener(listener);
      } catch (err) {
        console.warn(
          '[Notifications] addNotificationResponseReceivedListener error:',
          err
        );
      }
    }
    return { remove: () => {} };
  },

  AndroidNotificationPriority: {
    HIGH: 4,
    DEFAULT: 3,
    LOW: 2,
    MIN: 1,
    MAX: 5,
  },
};
