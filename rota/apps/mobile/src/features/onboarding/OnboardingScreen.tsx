/**
 * =============================================================================
 * Rota Mobile — Rearchitected Onboarding Welcome Screen
 * =============================================================================
 * AGENTS.md §2.1, §4, §5 & DESIGN-SYSTEM.md:
 * Clean, high-converting onboarding screen for first-time or unauthenticated users:
 *   - Clear value propositions (Conflict-free scheduling, peer swaps, quiet hours)
 *   - High-contrast, accessible 48pt touch targets
 *   - Direct routing to Sign Up, Sign In, and Enter Invite Code
 *   - Strict design token enforcement (zero raw literals)
 * =============================================================================
 */

import React, { useMemo } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  CalendarDays,
  ArrowLeftRight,
  Moon,
  Sparkles,
  Lock,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../theme';
import { Text } from '../../components/Text';
import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { PrimaryButton } from '../../components/PrimaryButton';

export function OnboardingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const features = [
    {
      icon: <CalendarDays size={20} color={theme.colors.primary} />,
      title: 'Smart Conflict-Free Rosters',
      description:
        'Build schedules in minutes with automated overlap prevention and instant team-wide visibility.',
    },
    {
      icon: <ArrowLeftRight size={20} color={theme.colors.primary} />,
      title: '1-Tap Colleague Swaps',
      description:
        'Direct peer handoffs requiring mutual colleague consent before manager sign-off.',
    },
    {
      icon: <Moon size={20} color={theme.colors.primary} />,
      title: 'Rest & Offline Protection',
      description:
        'Server-enforced quiet hours in each user’s local time zone and instant 30-day offline shift access.',
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Header Bar */}
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <View style={styles.miniLogo}>
              <CalendarDays size={18} color={theme.colors.onPrimary} />
            </View>
            <Text role="titleMedium" color="primary" style={styles.brandName}>
              ROTA
            </Text>
          </View>
          <Badge label="MVP READY" variant="neutral" size="small" />
        </View>

        {/* Hero Section */}
        <View style={styles.heroSection}>
          <View style={styles.heroEyebrow}>
            <Sparkles size={14} color={theme.colors.primary} />
            <Text role="labelSmall" color="primary" style={styles.eyebrowText}>
              MODERN SHIFT SCHEDULING
            </Text>
          </View>
          <Text role="headlineLarge" color="onSurface" style={styles.heroTitle}>
            Schedules that just work.
          </Text>
          <Text role="bodyLarge" color="onSurfaceVariant" style={styles.heroSubtitle}>
            Built specifically for restaurants, cafés, and small teams. Keep shifts
            organized, trades seamless, and your staff in sync.
          </Text>
        </View>

        {/* Feature Highlights Grid */}
        <View style={styles.featuresList}>
          {features.map((item, index) => (
            <Card key={index} variant="outlined" style={styles.featureCard}>
              <View style={styles.featureIconContainer}>{item.icon}</View>
              <View style={styles.featureTextContainer}>
                <Text role="titleSmall" color="onSurface" style={styles.featureTitle}>
                  {item.title}
                </Text>
                <Text role="bodySmall" color="onSurfaceVariant" style={styles.featureDesc}>
                  {item.description}
                </Text>
              </View>
            </Card>
          ))}
        </View>

        {/* Action CTAs */}
        <View style={styles.actionContainer}>
          <PrimaryButton
            label="Create a Team"
            variant="primary"
            leadingIcon={<Sparkles size={18} color={theme.colors.onPrimary} />}
            onPress={() => router.push('/(auth)/sign-up' as never)}
            style={styles.ctaButton}
          />

          <PrimaryButton
            label="Sign In"
            variant="secondary"
            leadingIcon={<Lock size={18} color={theme.colors.primary} />}
            onPress={() => router.push('/(auth)/sign-in' as never)}
            style={styles.ctaButton}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Join team with invite code"
            style={styles.inviteCodeLink}
            onPress={() => router.push('/(auth)/enter-invite-code' as never)}
          >
            <Text role="bodyMedium" color="primary" style={styles.inviteLinkText}>
              Have an invitation code? Join Team
            </Text>
            <ArrowRight size={16} color={theme.colors.primary} />
          </Pressable>
        </View>

        {/* Trust & Compliance Badge */}
        <View style={styles.trustFooter}>
          <ShieldCheck size={14} color={theme.colors.onSurfaceVariant} />
          <Text role="labelSmall" color="onSurfaceVariant">
            End-to-End Tenant Isolation • Argon2id Encrypted
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.colors.surface,
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: t.spacing.large,
      paddingVertical: t.spacing.medium,
      justifyContent: 'space-between',
    },
    topBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: t.spacing.large,
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
    },
    miniLogo: {
      width: 32,
      height: 32,
      borderRadius: t.radius.controlSmall,
      backgroundColor: t.colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    brandName: {
      fontWeight: '800',
      letterSpacing: 2,
    },
    heroSection: {
      marginBottom: t.spacing.large,
      gap: t.spacing.small,
    },
    heroEyebrow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
    },
    eyebrowText: {
      fontWeight: '700',
      letterSpacing: 1.5,
    },
    heroTitle: {
      fontWeight: '800',
      lineHeight: 38,
    },
    heroSubtitle: {
      lineHeight: 24,
    },
    featuresList: {
      gap: t.spacing.medium,
      marginBottom: t.spacing.large,
    },
    featureCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      padding: t.spacing.base,
      gap: t.spacing.medium,
      backgroundColor: t.colors.surface,
    },
    featureIconContainer: {
      width: 44,
      height: 44,
      borderRadius: t.radius.control,
      backgroundColor: t.colors.primaryContainer,
      justifyContent: 'center',
      alignItems: 'center',
    },
    featureTextContainer: {
      flex: 1,
      gap: t.spacing.extraSmall,
    },
    featureTitle: {
      fontWeight: '700',
    },
    featureDesc: {
      lineHeight: 18,
    },
    actionContainer: {
      gap: t.spacing.medium,
      marginBottom: t.spacing.large,
    },
    ctaButton: {
      width: '100%',
    },
    inviteCodeLink: {
      minHeight: t.touchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.spacing.extraSmall,
      paddingVertical: t.spacing.small,
    },
    inviteLinkText: {
      fontWeight: '600',
    },
    trustFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.spacing.extraSmall,
      paddingBottom: t.spacing.small,
      opacity: 0.8,
    },
  });
