import React from 'react';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { ThemeProvider } from '../src/theme';
import { asyncStoragePersister, MAX_CACHE_AGE_MS } from '../src/storage/offlineStore';
import { usePushNotificationSetup } from '../src/features/notifications/usePushNotifications';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
      retry: 2,
    },
  },
});

// Rule P-01, P-02: Persist ONE query (upcoming shifts) over AsyncStorage with 14-day maxAge
persistQueryClient({
  queryClient,
  persister: asyncStoragePersister,
  maxAge: MAX_CACHE_AGE_MS,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => {
      return (
        query.queryKey[0] === 'shifts' &&
        query.queryKey[1] === 'upcoming' &&
        query.state.status === 'success'
      );
    },
  },
});

function PushNotificationSetup() {
  usePushNotificationSetup();
  return null;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PushNotificationSetup />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
