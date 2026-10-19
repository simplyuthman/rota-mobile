/**
 * =============================================================================
 * Rota Mobile — Offline Status Banner
 * =============================================================================
 * AGENTS.md §3.4 (P-02) & §5:
 * - Displays "Offline · Last updated <time>"
 * - If last sync is > 14 days ago: displays "Reconnect to refresh" warning
 * - Completely styled with design tokens from useTheme()
 * =============================================================================
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { WifiOff, AlertTriangle, RefreshCw, Zap } from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../theme';
import { useNetworkStore } from '../state/networkStore';

export interface OfflineBannerProps {
  lastSyncTime?: Date | null;
  isExpired?: boolean;
  onRefresh?: () => void;
}

export function OfflineBanner({
  lastSyncTime,
  isExpired = false,
  onRefresh,
}: OfflineBannerProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { isSimulatedOffline, toggleSimulatedOffline } = useNetworkStore();

  const formattedTime = useMemo(() => {
    if (!lastSyncTime) return 'Recently';
    return lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [lastSyncTime]);

  return (
    <View style={[styles.container, isExpired && styles.containerExpired]}>
      <View style={styles.leftContent}>
        {isExpired ? (
          <AlertTriangle size={18} color={theme.colors.onErrorContainer} />
        ) : (
          <WifiOff size={18} color={theme.colors.onSecondaryContainer} />
        )}

        <View style={styles.textColumn}>
          <Text style={[styles.title, isExpired && styles.titleExpired]}>
            {isExpired ? 'Reconnect to refresh' : `Offline • Last updated ${formattedTime}`}
          </Text>
          <Text style={[styles.subtitle, isExpired && styles.subtitleExpired]}>
            {isExpired
              ? 'Offline shifts older than 14 days are hidden for security (Rule P-02).'
              : 'Viewing cached upcoming shifts. Edits are disabled while offline (Rule P-03).'}
          </Text>
        </View>
      </View>

      <View style={styles.actionRow}>
        {onRefresh && !isExpired && (
          <Pressable
            onPress={onRefresh}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Refresh connection"
          >
            <RefreshCw size={14} color={theme.colors.onSecondaryContainer} />
          </Pressable>
        )}

        {/* Demo Mode Toggle Button — dev builds only */}
        {__DEV__ && isSimulatedOffline && (
          <Pressable
            onPress={toggleSimulatedOffline}
            style={styles.resumeButton}
            accessibilityRole="button"
            accessibilityLabel="Go back online"
          >
            <Zap size={12} color={theme.colors.onPrimary} />
            <Text style={styles.resumeButtonText}>Go Online</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const createStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.colors.secondaryContainer,
      borderRadius: t.radius.card,
      paddingHorizontal: t.spacing.base,
      paddingVertical: t.spacing.small,
      marginHorizontal: t.spacing.base,
      marginTop: t.spacing.small,
      marginBottom: t.spacing.extraSmall,
      borderWidth: 1,
      borderColor: t.colors.surfaceVariant,
      gap: t.spacing.small,
    },
    containerExpired: {
      backgroundColor: t.colors.errorContainer,
      borderColor: t.colors.error,
    },
    leftContent: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      gap: t.spacing.small,
    },
    textColumn: {
      flex: 1,
      gap: t.spacing.extraSmall / 2,
    },
    title: {
      ...t.textStyles.labelMedium,
      color: t.colors.onSecondaryContainer,
      fontWeight: '700',
    },
    titleExpired: {
      color: t.colors.onErrorContainer,
    },
    subtitle: {
      ...t.textStyles.labelSmall,
      color: t.colors.onSecondaryContainer,
    },
    subtitleExpired: {
      color: t.colors.onErrorContainer,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
    },
    iconButton: {
      width: t.touchTarget - t.spacing.base,
      height: t.touchTarget - t.spacing.base,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    resumeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
      backgroundColor: t.colors.primary,
      paddingHorizontal: t.spacing.small,
      paddingVertical: t.spacing.extraSmall,
      borderRadius: t.radius.control,
    },
    resumeButtonText: {
      ...t.textStyles.labelSmall,
      color: t.colors.onPrimary,
      fontWeight: '600',
    },
  });
