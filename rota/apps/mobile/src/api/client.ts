/**
 * =============================================================================
 * Rota Mobile — API Client & Shared Refresh Promise
 * =============================================================================
 * AGENTS.md §3.3 (S-05):
 * Mobile client refreshes tokens through ONE shared in-flight promise.
 * Parallel 401s must never trigger multiple concurrent refresh requests.
 */

import axios, { type AxiosRequestConfig, type AxiosError } from 'axios';
import { getAccessToken, getRefreshToken, setAccessToken, setRefreshToken, clearAuthTokens } from '../storage/secureStore';

let rawUrl = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').trim();
if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
  rawUrl = `http://${rawUrl}`;
}
const API_BASE_URL = rawUrl.endsWith('/v1') ? rawUrl : `${rawUrl.replace(/\/$/, '')}/v1`;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach access token to outgoing requests
apiClient.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Shared in-flight refresh promise (Rule S-05)
let refreshPromise: Promise<string | null> | null = null;

import { wipeOfflineShifts } from '../storage/offlineStore';

async function refreshAuthTokens(): Promise<string | null> {
  const currentRefreshToken = await getRefreshToken();
  if (!currentRefreshToken) {
    await clearAuthTokens();
    await wipeOfflineShifts(); // Rule P-01: wipe persisted shift cache on session revocation
    return null;
  }

  try {
    const response = await axios.post<{ accessToken: string; refreshToken: string }>(
      `${API_BASE_URL}/auth/refresh`,
      { refreshToken: currentRefreshToken }
    );

    const { accessToken, refreshToken: newRefreshToken } = response.data;
    await setAccessToken(accessToken);
    await setRefreshToken(newRefreshToken);
    return accessToken;
  } catch {
    await clearAuthTokens();
    await wipeOfflineShifts(); // Rule P-01: wipe on refresh failure
    return null;
  } finally {
    refreshPromise = null;
  }
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;

      if (!refreshPromise) {
        refreshPromise = refreshAuthTokens();
      }

      const newAccessToken = await refreshPromise;
      if (newAccessToken && originalRequest.headers) {
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return apiClient(originalRequest);
      }
    }

    // Enhance error message for user visibility
    const errorData = error.response?.data as { error?: { message?: string } } | undefined;
    if (errorData?.error?.message) {
      error.message = errorData.error.message;
    } else if (error.code === 'ERR_NETWORK' || !error.response) {
      error.message = `Network error: Cannot reach ${API_BASE_URL}. Verify IP address, Wi-Fi connection, and firewall settings.`;
    }

    return Promise.reject(error);
  }
);
