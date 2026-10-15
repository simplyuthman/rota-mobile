import React from 'react';
import { useRouter } from 'expo-router';
import { SplashScreenFlow } from '../src/features/onboarding/SplashScreenFlow';

export default function WelcomeSplashScreen() {
  const router = useRouter();

  const handleFinish = () => {
    router.replace('/(tabs)');
  };

  return <SplashScreenFlow onFinish={handleFinish} />;
}
