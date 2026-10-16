import React from 'react';
import { useRouter } from 'expo-router';
import { SplashScreenFlow } from '../src/features/onboarding/SplashScreenFlow';
import { getAccessToken } from '../src/storage/secureStore';

export default function WelcomeSplashScreen() {
  const router = useRouter();

  const handleFinish = async () => {
    const token = await getAccessToken();
    if (token) {
      router.replace('/(tabs)' as never);
    } else {
      router.replace('/(auth)/sign-in' as never);
    }
  };

  return <SplashScreenFlow onFinish={handleFinish} />;
}

