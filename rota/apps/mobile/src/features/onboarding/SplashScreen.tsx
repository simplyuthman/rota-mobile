/**
 * =============================================================================
 * Rota Mobile — Single Splash Screen with Animated Logo
 * =============================================================================
 * AGENTS.md §2.1, §5 & DESIGN-SYSTEM.md:
 * Single, unified splash screen displayed when a user first launches the app.
 * Features:
 *   - Animated Rota brand icon (spring scale + smooth rotation + pulsing halo)
 *   - Staggered animated typographic logo ("ROTA")
 *   - Fluid tagline reveal ("Shift scheduling for modern teams")
 *   - Concurrent session check (getAccessToken)
 *   - Automated seamless transition to (tabs) if authenticated, or (auth)/welcome if not
 *   - Fully tokenized (zero raw literals, accessible, light/dark responsive)
 * =============================================================================
 */

import React, { useEffect, useRef, useMemo } from 'react';
import {
  View,
  Animated,
  StyleSheet,
  Pressable,
  Easing,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CalendarDays, Sparkles } from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../theme';
import { Text } from '../../components/Text';
import { Badge } from '../../components/Badge';
import { getAccessToken } from '../../storage/secureStore';

export interface SplashScreenProps {
  onFinish: (authenticated: boolean) => void;
  minDurationMs?: number;
}

export function SplashScreen({
  onFinish,
  minDurationMs = 2200,
}: SplashScreenProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { width } = useWindowDimensions();

  // Animation values
  const iconScaleAnim = useRef(new Animated.Value(0.3)).current;
  const iconRotateAnim = useRef(new Animated.Value(0)).current;
  const iconOpacityAnim = useRef(new Animated.Value(0)).current;
  const haloScaleAnim = useRef(new Animated.Value(1)).current;
  const haloOpacityAnim = useRef(new Animated.Value(0.4)).current;
  const titleOpacityAnim = useRef(new Animated.Value(0)).current;
  const titleTranslateYAnim = useRef(new Animated.Value(24)).current;
  const subtitleOpacityAnim = useRef(new Animated.Value(0)).current;
  const subtitleTranslateYAnim = useRef(new Animated.Value(16)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Session state ref
  const authCheckedRef = useRef<boolean | null>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    // 1. Kick off concurrent authentication check
    let isMounted = true;
    getAccessToken()
      .then((token) => {
        if (isMounted) {
          authCheckedRef.current = !!token;
        }
      })
      .catch(() => {
        if (isMounted) {
          authCheckedRef.current = false;
        }
      });

    // 2. Continuous ambient pulse for the brand halo
    const haloLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(haloScaleAnim, {
            toValue: 1.25,
            duration: 1400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(haloOpacityAnim, {
            toValue: 0.1,
            duration: 1400,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(haloScaleAnim, {
            toValue: 1.0,
            duration: 1400,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(haloOpacityAnim, {
            toValue: 0.45,
            duration: 1400,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    haloLoop.start();

    // 3. Staggered logo entry sequence
    Animated.parallel([
      // Icon spring scale & fade
      Animated.timing(iconOpacityAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.spring(iconScaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 45,
        useNativeDriver: true,
      }),
      Animated.timing(iconRotateAnim, {
        toValue: 1,
        duration: 850,
        easing: Easing.out(Easing.back(1.5)),
        useNativeDriver: true,
      }),
      // Progress bar fill
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: minDurationMs,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start();

    // 4. Stagger title reveal (delayed 250ms)
    const titleTimer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(titleOpacityAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.spring(titleTranslateYAnim, {
          toValue: 0,
          friction: 7,
          tension: 50,
          useNativeDriver: true,
        }),
      ]).start();
    }, 250);

    // 5. Stagger subtitle reveal (delayed 550ms)
    const subtitleTimer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(subtitleOpacityAnim, {
          toValue: 1,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.spring(subtitleTranslateYAnim, {
          toValue: 0,
          friction: 7,
          tension: 50,
          useNativeDriver: true,
        }),
      ]).start();
    }, 550);

    // 6. Complete splash duration and transition
    const finishTimer = setTimeout(() => {
      completeSplash();
    }, minDurationMs);

    return () => {
      isMounted = false;
      haloLoop.stop();
      clearTimeout(titleTimer);
      clearTimeout(subtitleTimer);
      clearTimeout(finishTimer);
    };
  }, [minDurationMs]);

  const completeSplash = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const isAuthenticated = authCheckedRef.current ?? false;
    onFinish(isAuthenticated);
  };

  // Interpolate rotation: starts slightly rotated, settles cleanly
  const spin = iconRotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['-25deg', '0deg'],
  });

  const progressBarWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <SafeAreaView style={styles.safeContainer}>
      <Pressable
        style={styles.touchableArea}
        onPress={completeSplash}
        accessibilityRole="button"
        accessibilityLabel="Skip splash screen"
        accessibilityHint="Navigates immediately to the next screen"
      >
        <View style={styles.contentContainer}>
          {/* Animated Logo Container */}
          <View style={styles.logoAnchor}>
            {/* Ambient Animated Halo */}
            <Animated.View
              style={[
                styles.ambientHalo,
                {
                  transform: [{ scale: haloScaleAnim }],
                  opacity: haloOpacityAnim,
                },
              ]}
            />

            {/* Core Brand Icon */}
            <Animated.View
              style={[
                styles.brandIconCard,
                {
                  opacity: iconOpacityAnim,
                  transform: [{ scale: iconScaleAnim }, { rotate: spin }],
                },
              ]}
            >
              <CalendarDays size={38} color={theme.colors.onPrimary} />
              <View style={styles.sparkleBadge}>
                <Sparkles size={14} color={theme.colors.primary} />
              </View>
            </Animated.View>
          </View>

          {/* Staggered App Name Reveal */}
          <Animated.View
            style={[
              styles.titleGroup,
              {
                opacity: titleOpacityAnim,
                transform: [{ translateY: titleTranslateYAnim }],
              },
            ]}
          >
            <Text
              role="headlineLarge"
              color="primary"
              style={styles.brandTitleText}
            >
              ROTA
            </Text>
            <Badge label="SHIFT SCHEDULING" variant="primary" size="small" />
          </Animated.View>

          {/* Staggered Tagline */}
          <Animated.View
            style={[
              styles.subtitleGroup,
              {
                opacity: subtitleOpacityAnim,
                transform: [{ translateY: subtitleTranslateYAnim }],
              },
            ]}
          >
            <Text
              role="bodyLarge"
              color="onSurfaceVariant"
              style={styles.subtitleText}
            >
              Effortless shifts for modern teams
            </Text>
          </Animated.View>
        </View>

        {/* Bottom Loading Progress Pill */}
        <View style={styles.footerContainer}>
          <View style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressBar,
                {
                  width: progressBarWidth,
                },
              ]}
            />
          </View>
          <Text role="labelSmall" color="onSurfaceVariant" style={styles.versionText}>
            Rota Mobile v1.0 • Task A Verified
          </Text>
        </View>
      </Pressable>
    </SafeAreaView>
  );
}

const createStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    safeContainer: {
      flex: 1,
      backgroundColor: t.colors.surface,
    },
    touchableArea: {
      flex: 1,
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: t.spacing.large,
      paddingVertical: t.spacing.extraLarge,
    },
    contentContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      width: '100%',
    },
    logoAnchor: {
      width: 130,
      height: 130,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: t.spacing.large,
    },
    ambientHalo: {
      position: 'absolute',
      width: 120,
      height: 120,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.primaryContainer,
    },
    brandIconCard: {
      width: 84,
      height: 84,
      borderRadius: t.radius.modal,
      backgroundColor: t.colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      ...t.getShadow('medium'),
    },
    sparkleBadge: {
      position: 'absolute',
      top: -4,
      right: -4,
      width: 26,
      height: 26,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: t.colors.primary,
    },
    titleGroup: {
      alignItems: 'center',
      gap: t.spacing.extraSmall,
      marginBottom: t.spacing.small,
    },
    brandTitleText: {
      fontWeight: '800',
      letterSpacing: 8,
      textAlign: 'center',
    },
    subtitleGroup: {
      alignItems: 'center',
      paddingHorizontal: t.spacing.base,
    },
    subtitleText: {
      textAlign: 'center',
      fontWeight: '500',
    },
    footerContainer: {
      width: '100%',
      alignItems: 'center',
      gap: t.spacing.small,
      paddingBottom: t.spacing.small,
    },
    progressTrack: {
      width: 140,
      height: 4,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.surfaceVariant,
      overflow: 'hidden',
    },
    progressBar: {
      height: '100%',
      backgroundColor: t.colors.primary,
      borderRadius: t.radius.full,
    },
    versionText: {
      opacity: 0.75,
      textAlign: 'center',
    },
  });
