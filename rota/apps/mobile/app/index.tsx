import React from 'react';
import { useRouter } from 'expo-router';
import { SplashScreen } from '../src/features/onboarding/SplashScreen';

export default function AppEntrySplash() {
  const router = useRouter();

  const handleFinish = (authenticated: boolean) => {
    if (authenticated) {
      router.replace('/(tabs)' as never);
    } else {
      router.replace('/(auth)/welcome' as never);
    }
  };

  return <SplashScreen onFinish={handleFinish} />;
}

