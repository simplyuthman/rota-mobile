/**
 * =============================================================================
 * Rota Mobile — Activity Feed List Item
 * =============================================================================
 * AGENTS.md §4 (L-11 tokens only), §5 (Accessibility & contrast).
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Calendar, UserCheck, ArrowLeftRight, CreditCard, Sparkles } from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../theme';
import type { ActivityEventDto } from '@rota/contracts';

interface ActivityItemProps {
  item: ActivityEventDto;
}

function formatRelativeTime(dateStr: string): string {
  try {
    const then = new Date(dateStr).getTime();
    const now = Date.now();
    const diffSeconds = Math.max(0, Math.floor((now - then) / 1000));

    if (diffSeconds < 60) return 'Just now';
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function getEventDescription(eventType: string, params: Record<string, unknown>): {
  title: string;
  subtitle: string;
  icon: typeof Calendar;
} {
  switch (eventType) {
    case 'shift.published':
      return {
        title: 'Shift published',
        subtitle: typeof params.shiftTitle === 'string' ? params.shiftTitle : 'New shift on the schedule',
        icon: Calendar,
      };
    case 'shift.assigned':
      return {
        title: 'Shift assigned',
        subtitle: typeof params.shiftTitle === 'string' ? params.shiftTitle : 'Member assigned to shift',
        icon: UserCheck,
      };
    case 'swap.requested':
      return {
        title: 'Shift swap requested',
        subtitle: 'A colleague requested a direct swap',
        icon: ArrowLeftRight,
      };
    case 'swap.accepted':
      return {
        title: 'Shift swap accepted',
        subtitle: 'Colleague accepted the swap; awaiting manager review',
        icon: ArrowLeftRight,
      };
    case 'swap.approved':
      return {
        title: 'Shift swap approved',
        subtitle: 'Manager approved the shift swap',
        icon: ArrowLeftRight,
      };
    case 'billing.payment_succeeded':
    case 'billing.subscription_renewed':
      return {
        title: 'Subscription renewed',
        subtitle: 'Monthly team subscription payment confirmed',
        icon: CreditCard,
      };
    default:
      return {
        title: eventType.replace(/[._]/g, ' '),
        subtitle: 'Team activity update',
        icon: Sparkles,
      };
  }
}

export function ActivityItem({ item }: ActivityItemProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { title, subtitle, icon: IconComponent } = useMemo(
    () => getEventDescription(item.eventType, item.params as Record<string, unknown>),
    [item.eventType, item.params]
  );

  const relativeTime = useMemo(() => formatRelativeTime(item.createdAt), [item.createdAt]);

  return (
    <View
      style={styles.container}
      accessibilityRole="text"
      accessibilityLabel={`${title}, ${subtitle}, ${relativeTime}`}
    >
      <View style={styles.iconContainer}>
        <IconComponent size={20} color={theme.colors.primary} />
      </View>

      <View style={styles.contentContainer}>
        <View style={styles.headerRow}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.time} numberOfLines={1}>
            {relativeTime}
          </Text>
        </View>

        <Text style={styles.subtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

const createStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: t.spacing.medium,
      paddingHorizontal: t.spacing.large,
      backgroundColor: t.colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.colors.surfaceContainerHigh,
      gap: t.spacing.medium,
    },
    iconContainer: {
      width: 40,
      height: 40,
      borderRadius: t.radius.control,
      backgroundColor: t.colors.surfaceContainer,
      justifyContent: 'center',
      alignItems: 'center',
    },
    contentContainer: {
      flex: 1,
      gap: 2,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    title: {
      ...t.textStyles.labelLarge,
      color: t.colors.onSurface,
      fontWeight: '600',
      flex: 1,
      marginRight: t.spacing.small,
    },
    time: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
    },
    subtitle: {
      ...t.textStyles.bodyMedium,
      color: t.colors.onSurfaceVariant,
    },
  });
