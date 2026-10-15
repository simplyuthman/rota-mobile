/**
 * =============================================================================
 * Rota Mobile — Secure Token Storage
 * =============================================================================
 * AGENTS.md §2.1 & S-02:
 * Token storage uses Expo SecureStore only. Never AsyncStorage.
 * Never logs tokens or sensitive data.
 */

import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'rota_access_token';
const REFRESH_TOKEN_KEY = 'rota_refresh_token';

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function setAccessToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, token);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function setRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
}

export async function clearAuthTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}
