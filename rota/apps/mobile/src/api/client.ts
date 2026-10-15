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

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

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

async function refreshAuthTokens(): Promise<string | null> {
  const currentRefreshToken = await getRefreshToken();
  if (!currentRefreshToken) {
    await clearAuthTokens();
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

    return Promise.reject(error);
  }
);
