/**
 * =============================================================================
 * Rota Mobile — Minimalistic Splash Screens Flow
 * =============================================================================
 * Three elegant, minimalist onboarding splash slides introducing Rota:
 *   1. Smart team scheduling & conflict-free planning
 *   2. Frictionless shift swaps & peer handoffs
 *   3. Real-time notifications & quiet hours protection
 *
 * Fully themed (Light/Dark), token-driven, accessible touch targets (>=44pt).
 */

import React, { useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  useWindowDimensions,
  Pressable,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CalendarDays,
  Clock,
  User,
  ArrowLeftRight,
  CheckCircle2,
  Bell,
  Moon,
  Check,
  ArrowRight,
  Sparkles,
} from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../theme';
import { PrimaryButton } from '../../components/PrimaryButton';

export interface SplashScreenFlowProps {
  onFinish: () => void;
}

interface SlideData {
  id: string;
  badge: string;
  title: string;
  description: string;
  visualType: 'schedule' | 'swap' | 'notifications';
}

const SLIDES: SlideData[] = [
  {
    id: 'schedule',
    badge: '01 / 03  ·  SCHEDULING',
    title: 'Schedules that just make sense.',
    description:
      'Plan shifts in minutes with built-in conflict prevention, transparent hours, and instant team-wide visibility.',
    visualType: 'schedule',
  },
  {
    id: 'swap',
    badge: '02 / 03  ·  SWAPS',
    title: 'Hassle-free shift trades.',
    description:
      'Direct handoffs between colleagues with one-tap manager approvals. No confusion, no frantic group chats.',
    visualType: 'swap',
  },
  {
    id: 'notifications',
    badge: '03 / 03  ·  PEACE OF MIND',
    title: 'Always in sync, respecting your time.',
    description:
      'Instant push updates when shifts change, automated quiet hours to protect your rest, and offline shift access.',
    visualType: 'notifications',
  },
];

export function SplashScreenFlow({ onFinish }: SplashScreenFlowProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList<SlideData>>(null);

  const styles = useMemo(() => createStyles(theme), [theme]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / width);
    if (index !== currentIndex && index >= 0 && index < SLIDES.length) {
      setCurrentIndex(index);
    }
  };

  const handleNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      const nextIndex = currentIndex + 1;
      flatListRef.current?.scrollToIndex({ index: nextIndex, animated: true });
      setCurrentIndex(nextIndex);
    } else {
      onFinish();
    }
  };

  const renderVisual = (type: SlideData['visualType']) => {
    if (type === 'schedule') {
      return (
        <View style={styles.heroCard}>
          {/* Calendar Header Representation */}
          <View style={styles.calendarHeaderRow}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => (
              <View key={i} style={[styles.dayColumn, i === 3 && styles.dayColumnActive]}>
                <Text style={[styles.dayText, i === 3 && styles.dayTextActive]}>{day}</Text>
                <View style={[styles.dayDot, i === 3 && styles.dayDotActive]} />
              </View>
            ))}
          </View>

          {/* Shift Blocks */}
          <View style={styles.shiftCardPrimary}>
            <View style={styles.shiftPillRow}>
              <Clock size={15} color={theme.colors.primary} strokeWidth={2.4} />
              <Text style={styles.shiftTitlePrimary}>Morning Floor Shift</Text>
            </View>
            <View style={styles.shiftDetailsRow}>
              <Text style={styles.shiftTimePrimary}>08:00 AM – 04:00 PM</Text>
              <View style={styles.shiftUserPill}>
                <User size={12} color={theme.colors.onPrimaryContainer} strokeWidth={2.2} />
                <Text style={styles.shiftUserNamePrimary}>Sarah K.</Text>
              </View>
            </View>
          </View>

          <View style={styles.shiftCardSecondary}>
            <View style={styles.shiftPillRow}>
              <Clock size={15} color={theme.colors.secondary} strokeWidth={2.4} />
              <Text style={styles.shiftTitleSecondary}>Evening Bar & Service</Text>
            </View>
            <View style={styles.shiftDetailsRow}>
              <Text style={styles.shiftTimeSecondary}>04:00 PM – 11:30 PM</Text>
              <View style={styles.shiftUserPillSecondary}>
                <User size={12} color={theme.colors.onSurfaceVariant} strokeWidth={2.2} />
                <Text style={styles.shiftUserNameSecondary}>Liam D.</Text>
              </View>
            </View>
          </View>
        </View>
      );
    }

    if (type === 'swap') {
      return (
        <View style={styles.heroCard}>
          {/* Swap Handshake Cards */}
          <View style={styles.swapCard}>
            <Text style={styles.swapBadgeText}>GIVING SHIFT</Text>
            <Text style={styles.swapCardTitle}>Friday Evening (17:00 – 23:00)</Text>
            <View style={styles.swapUserRow}>
              <User size={12} color={theme.colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={styles.swapCardSub}>Assigned to Alex R.</Text>
            </View>
          </View>

          <View style={styles.swapDividerRow}>
            <View style={styles.swapLine} />
            <View style={styles.swapIconCircle}>
              <ArrowLeftRight size={15} color={theme.colors.onSecondaryContainer} strokeWidth={2.4} />
            </View>
            <View style={styles.swapLine} />
          </View>

          <View style={styles.swapCard}>
            <Text style={styles.swapBadgeText}>RECEIVING SHIFT</Text>
            <Text style={styles.swapCardTitle}>Sunday Brunch (09:00 – 16:00)</Text>
            <View style={styles.swapUserRow}>
              <User size={12} color={theme.colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={styles.swapCardSub}>Requested from Emma T.</Text>
            </View>
          </View>

          {/* Status Chip */}
          <View style={styles.statusPill}>
            <CheckCircle2 size={14} color={theme.colors.secondary} strokeWidth={2.4} />
            <Text style={styles.statusText}>Colleague Accepted  ·  Awaiting Manager</Text>
          </View>
        </View>
      );
    }

    // Notifications visual
    return (
      <View style={styles.heroCard}>
        {/* Notification Preview */}
        <View style={styles.notifCard}>
          <View style={styles.notifHeader}>
            <Bell size={14} color={theme.colors.tertiary} strokeWidth={2.4} />
            <Text style={styles.notifAppName}>ROTA  ·  JUST NOW</Text>
          </View>
          <Text style={styles.notifTitle}>Schedule Published</Text>
          <Text style={styles.notifBody}>Next week's roster is ready. You have 4 shifts assigned.</Text>
        </View>

        {/* Quiet Hours Feature Badge */}
        <View style={styles.quietHoursCard}>
          <View style={styles.quietHoursIconBox}>
            <Moon size={18} color={theme.colors.onTertiaryContainer} strokeWidth={2.2} />
          </View>
          <View style={styles.quietHoursTextBox}>
            <Text style={styles.quietHoursTitle}>Quiet Hours Enabled</Text>
            <Text style={styles.quietHoursSub}>Non-urgent alerts held until 08:00 AM</Text>
          </View>
        </View>

        {/* Offline Cache Indicator */}
        <View style={styles.offlineChip}>
          <Check size={14} color={theme.colors.onSurfaceVariant} strokeWidth={2.5} />
          <Text style={styles.offlineChipText}>Offline access enabled for next 30 days</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Header Bar */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <View style={styles.brandIconContainer}>
            <CalendarDays size={16} color={theme.colors.onPrimary} strokeWidth={2.4} />
          </View>
          <Text style={styles.brandText}>ROTA</Text>
        </View>

        {currentIndex < SLIDES.length - 1 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip intro walkthrough"
            hitSlop={12}
            onPress={onFinish}
            style={styles.skipButton}
          >
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        ) : (
          <View style={styles.skipPlaceholder} />
        )}
      </View>

      {/* Paged Carousel */}
      <FlatList<SlideData>
        ref={flatListRef}
        data={SLIDES}
        keyExtractor={(item: SlideData) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        renderItem={({ item }: { item: SlideData }) => (
          <View style={[styles.slideContainer, { width }]}>
            {/* Visual Hero Container */}
            <View style={styles.visualContainer}>{renderVisual(item.visualType)}</View>

            {/* Content Text Block */}
            <View style={styles.textContainer}>
              <Text style={styles.badgeText}>{item.badge}</Text>
              <Text style={styles.headlineText}>{item.title}</Text>
              <Text style={styles.descriptionText}>{item.description}</Text>
            </View>
          </View>
        )}
      />

      {/* Bottom Navigation & Controls */}
      <View style={styles.bottomBar}>
        {/* Paginator Dots */}
        <View style={styles.paginatorRow}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === currentIndex ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>

        {/* Action Button */}
        <PrimaryButton
          label={currentIndex === SLIDES.length - 1 ? 'Get Started' : 'Next'}
          trailingIcon={
            currentIndex === SLIDES.length - 1 ? (
              <Sparkles size={18} color={theme.colors.onPrimary} strokeWidth={2.2} />
            ) : (
              <ArrowRight size={18} color={theme.colors.onPrimary} strokeWidth={2.2} />
            )
          }
          onPress={handleNext}
          accessibilityHint={
            currentIndex === SLIDES.length - 1
              ? 'Enters the application'
              : 'Navigates to the next slide'
          }
        />
      </View>
    </SafeAreaView>
  );
}

const createStyles = (t: ThemeContextValue) => {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: t.colors.surface,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.spacing.large,
      paddingVertical: t.spacing.small,
      minHeight: t.touchTarget,
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    brandIconContainer: {
      width: 28,
      height: 28,
      borderRadius: t.radius.controlSmall,
      backgroundColor: t.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: t.spacing.small,
    },
    brandText: {
      ...t.textStyles.titleMedium,
      color: t.colors.onSurface,
      letterSpacing: 1.5,
      fontWeight: '700',
    },
    skipButton: {
      minHeight: t.touchTarget,
      justifyContent: 'center',
      paddingHorizontal: t.spacing.small,
    },
    skipText: {
      ...t.textStyles.labelLarge,
      color: t.colors.onSurfaceVariant,
    },
    skipPlaceholder: {
      width: 48,
      height: t.touchTarget,
    },
    slideContainer: {
      flex: 1,
      paddingHorizontal: t.spacing.large,
      justifyContent: 'space-between',
    },
    visualContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: t.spacing.base,
    },
    heroCard: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: t.colors.surfaceContainerLowest,
      borderRadius: t.radius.modal,
      padding: t.spacing.large,
      borderWidth: 1,
      borderColor: t.colors.surfaceVariant,
      ...t.getShadow('soft'),
    },
    // --- Slide 1 visuals ---
    calendarHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: t.spacing.base,
      paddingBottom: t.spacing.small,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.surfaceVariant,
    },
    dayColumn: {
      alignItems: 'center',
      paddingVertical: t.spacing.extraSmall,
      paddingHorizontal: t.spacing.extraSmall,
      borderRadius: t.radius.controlSmall,
    },
    dayColumnActive: {
      backgroundColor: t.colors.primaryContainer,
    },
    dayText: {
      ...t.textStyles.labelSmall,
      color: t.colors.onSurfaceVariant,
    },
    dayTextActive: {
      color: t.colors.onPrimaryContainer,
      fontWeight: '700',
    },
    dayDot: {
      width: 4,
      height: 4,
      borderRadius: t.radius.full,
      backgroundColor: 'transparent',
      marginTop: 4,
    },
    dayDotActive: {
      backgroundColor: t.colors.primary,
    },
    shiftCardPrimary: {
      backgroundColor: t.colors.primaryContainer,
      borderRadius: t.radius.control,
      padding: t.spacing.medium,
      marginBottom: t.spacing.small,
    },
    shiftPillRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
      marginBottom: t.spacing.extraSmall,
    },
    shiftTitlePrimary: {
      ...t.textStyles.titleSmall,
      color: t.colors.onPrimaryContainer,
      fontWeight: '600',
    },
    shiftDetailsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 2,
    },
    shiftTimePrimary: {
      ...t.textStyles.bodySmall,
      color: t.colors.onPrimaryContainer,
      opacity: 0.85,
    },
    shiftUserPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(0, 78, 212, 0.08)',
      paddingHorizontal: t.spacing.small,
      paddingVertical: 2,
      borderRadius: t.radius.full,
    },
    shiftUserNamePrimary: {
      ...t.textStyles.labelSmall,
      color: t.colors.onPrimaryContainer,
      fontWeight: '600',
    },
    shiftCardSecondary: {
      backgroundColor: t.colors.surfaceContainer,
      borderRadius: t.radius.control,
      padding: t.spacing.medium,
    },
    shiftTitleSecondary: {
      ...t.textStyles.titleSmall,
      color: t.colors.onSurface,
      fontWeight: '600',
    },
    shiftTimeSecondary: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
    },
    shiftUserPillSecondary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: t.colors.surfaceContainerHigh,
      paddingHorizontal: t.spacing.small,
      paddingVertical: 2,
      borderRadius: t.radius.full,
    },
    shiftUserNameSecondary: {
      ...t.textStyles.labelSmall,
      color: t.colors.onSurfaceVariant,
      fontWeight: '600',
    },

    // --- Slide 2 visuals ---
    swapCard: {
      backgroundColor: t.colors.surfaceContainer,
      borderRadius: t.radius.control,
      padding: t.spacing.medium,
    },
    swapBadgeText: {
      ...t.textStyles.labelSmall,
      color: t.colors.secondary,
      fontWeight: '700',
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    swapCardTitle: {
      ...t.textStyles.titleSmall,
      color: t.colors.onSurface,
      fontWeight: '600',
    },
    swapUserRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 2,
    },
    swapCardSub: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
    },
    swapDividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: t.spacing.small,
    },
    swapLine: {
      flex: 1,
      height: 1,
      backgroundColor: t.colors.surfaceVariant,
    },
    swapIconCircle: {
      width: 32,
      height: 32,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.secondaryContainer,
      alignItems: 'center',
      justifyContent: 'center',
      marginHorizontal: t.spacing.small,
    },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
      backgroundColor: t.colors.surfaceContainerHigh,
      borderRadius: t.radius.full,
      paddingHorizontal: t.spacing.medium,
      paddingVertical: t.spacing.extraSmall,
      marginTop: t.spacing.medium,
      alignSelf: 'center',
    },
    statusText: {
      ...t.textStyles.labelSmall,
      color: t.colors.onSurfaceVariant,
    },

    // --- Slide 3 visuals ---
    notifCard: {
      backgroundColor: t.colors.surfaceContainer,
      borderRadius: t.radius.control,
      padding: t.spacing.medium,
      marginBottom: t.spacing.medium,
      borderLeftWidth: 3,
      borderLeftColor: t.colors.tertiary,
    },
    notifHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 4,
    },
    notifAppName: {
      ...t.textStyles.labelSmall,
      color: t.colors.onSurfaceVariant,
      letterSpacing: 0.5,
    },
    notifTitle: {
      ...t.textStyles.titleSmall,
      color: t.colors.onSurface,
      fontWeight: '600',
    },
    notifBody: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
      marginTop: 2,
    },
    quietHoursCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.colors.tertiaryContainer,
      borderRadius: t.radius.control,
      padding: t.spacing.medium,
      marginBottom: t.spacing.medium,
    },
    quietHoursIconBox: {
      width: 36,
      height: 36,
      borderRadius: t.radius.controlSmall,
      backgroundColor: t.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: t.spacing.medium,
    },
    quietHoursTextBox: {
      flex: 1,
    },
    quietHoursTitle: {
      ...t.textStyles.titleSmall,
      color: t.colors.onTertiaryContainer,
      fontWeight: '600',
    },
    quietHoursSub: {
      ...t.textStyles.bodySmall,
      color: t.colors.onTertiaryContainer,
      opacity: 0.85,
    },
    offlineChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
      alignSelf: 'center',
      paddingHorizontal: t.spacing.medium,
      paddingVertical: t.spacing.extraSmall,
      backgroundColor: t.colors.surfaceContainerHigh,
      borderRadius: t.radius.full,
    },
    offlineChipText: {
      ...t.textStyles.labelSmall,
      color: t.colors.onSurfaceVariant,
    },

    // --- Content Text Section ---
    textContainer: {
      paddingBottom: t.spacing.large,
    },
    badgeText: {
      ...t.textStyles.labelMedium,
      color: t.colors.primary,
      fontWeight: '700',
      letterSpacing: 1,
      marginBottom: t.spacing.small,
    },
    headlineText: {
      ...t.textStyles.headlineSmall,
      color: t.colors.onSurface,
      fontWeight: '700',
      marginBottom: t.spacing.small,
    },
    descriptionText: {
      ...t.textStyles.bodyMedium,
      color: t.colors.onSurfaceVariant,
      lineHeight: 22,
    },

    // --- Bottom Navigation Section ---
    bottomBar: {
      paddingHorizontal: t.spacing.large,
      paddingBottom: t.spacing.large,
      paddingTop: t.spacing.small,
    },
    paginatorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: t.spacing.large,
    },
    dot: {
      height: 6,
      borderRadius: t.radius.full,
      marginHorizontal: 4,
    },
    dotActive: {
      width: 24,
      backgroundColor: t.colors.primary,
    },
    dotInactive: {
      width: 6,
      backgroundColor: t.colors.surfaceVariant,
    },
  });
};
