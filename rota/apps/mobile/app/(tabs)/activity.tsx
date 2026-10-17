/**
 * =============================================================================
 * Rota Mobile — Activity Feed Tab Screen
 * =============================================================================
 * AGENTS.md §2.1 (FlashList), §3.5 (D-01 Cursor pagination, no duplicate IDs)
 * & rota-activity-feed SKILL.md.
 */

import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Sparkles, AlertCircle, RefreshCw, CheckCircle2 } from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../src/theme';
import { useActivityFeed } from '../../src/features/activity/useActivityFeed';
import { ActivityItem } from '../../src/features/activity/ActivityItem';
import type { ActivityEventDto } from '@rota/contracts';

export default function ActivityScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useActivityFeed();

  // Rule D-01: Flatten and strictly deduplicate events across pages by ID
  const events = useMemo(() => {
    if (!data?.pages) return [];
    const seen = new Set<string>();
    const unique: ActivityEventDto[] = [];

    for (const page of data.pages) {
      for (const item of page.items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          unique.push(item);
        }
      }
    }
    return unique;
  }, [data]);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // List Footer Component
  const renderFooter = useCallback(() => {
    if (isFetchingNextPage) {
      return (
        <View style={styles.footerLoader} accessibilityRole="progressbar">
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <Text style={styles.footerText}>Loading more activity...</Text>
        </View>
      );
    }

    if (events.length > 0 && !hasNextPage) {
      return (
        <View style={styles.endOfListContainer}>
          <CheckCircle2 size={16} color={theme.colors.onSurfaceVariant} />
          <Text style={styles.endOfListText}>You're all caught up</Text>
        </View>
      );
    }

    return null;
  }, [isFetchingNextPage, events.length, hasNextPage, theme, styles]);

  // Render individual item
  const renderItem = useCallback(
    ({ item }: { item: ActivityEventDto }) => <ActivityItem item={item} />,
    []
  );

  const keyExtractor = useCallback((item: ActivityEventDto) => item.id, []);

  // 1. Initial Loading State
  if (isLoading && !isRefetching) {
    return (
      <View style={styles.centerContainer} accessibilityRole="progressbar">
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.loadingText}>Loading activity feed...</Text>
      </View>
    );
  }

  // 2. Retryable Error State
  if (isError && events.length === 0) {
    return (
      <View style={styles.centerContainer} accessibilityRole="alert">
        <AlertCircle size={40} color={theme.colors.error} />
        <Text style={styles.errorTitle}>Unable to load activity</Text>
        <Text style={styles.errorSubtitle}>
          {error?.message || 'A network error occurred. Please try again.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading activity feed"
          style={styles.retryButton}
          onPress={() => refetch()}
        >
          <RefreshCw size={16} color={theme.colors.onPrimary} />
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  // 3. Empty State
  if (events.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <View style={styles.emptyIconCircle}>
          <Sparkles size={32} color={theme.colors.primary} />
        </View>
        <Text style={styles.emptyTitle}>No activity yet</Text>
        <Text style={styles.emptySubtitle}>
          Published shifts, swap requests, and team updates will appear here in chronological order.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh activity feed"
          style={styles.refreshButton}
          onPress={() => refetch()}
        >
          <RefreshCw size={16} color={theme.colors.primary} />
          <Text style={styles.refreshButtonText}>Refresh</Text>
        </Pressable>
      </View>
    );
  }

  // 4. Main FlashList Feed
  return (
    <View style={styles.container}>
      <FlashList
        data={events}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        refreshing={isRefetching}
        onRefresh={refetch}
        ListFooterComponent={renderFooter}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const createStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.colors.surface,
    },
    listContent: {
      paddingBottom: t.spacing.extraLarge,
    },
    centerContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: t.spacing.large,
      backgroundColor: t.colors.surface,
      gap: t.spacing.small,
    },
    loadingText: {
      ...t.textStyles.bodyMedium,
      color: t.colors.onSurfaceVariant,
      marginTop: t.spacing.small,
    },
    errorTitle: {
      ...t.textStyles.headlineSmall,
      color: t.colors.onSurface,
      fontWeight: '700',
      marginTop: t.spacing.small,
    },
    errorSubtitle: {
      ...t.textStyles.bodyMedium,
      color: t.colors.onSurfaceVariant,
      textAlign: 'center',
      maxWidth: 300,
    },
    retryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
      backgroundColor: t.colors.primary,
      paddingHorizontal: t.spacing.large,
      minHeight: t.touchTarget - 4,
      borderRadius: t.radius.control,
      marginTop: t.spacing.medium,
    },
    retryButtonText: {
      ...t.textStyles.labelLarge,
      color: t.colors.onPrimary,
      fontWeight: '600',
    },
    emptyIconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: t.colors.surfaceContainer,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: t.spacing.small,
    },
    emptyTitle: {
      ...t.textStyles.headlineSmall,
      color: t.colors.onSurface,
      fontWeight: '700',
    },
    emptySubtitle: {
      ...t.textStyles.bodyMedium,
      color: t.colors.onSurfaceVariant,
      textAlign: 'center',
      maxWidth: 320,
    },
    refreshButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
      backgroundColor: t.colors.surfaceContainer,
      paddingHorizontal: t.spacing.large,
      minHeight: t.touchTarget - 8,
      borderRadius: t.radius.control,
      marginTop: t.spacing.medium,
    },
    refreshButtonText: {
      ...t.textStyles.labelMedium,
      color: t.colors.primary,
      fontWeight: '600',
    },
    footerLoader: {
      paddingVertical: t.spacing.large,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: t.spacing.small,
    },
    footerText: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
    },
    endOfListContainer: {
      paddingVertical: t.spacing.extraLarge,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
    },
    endOfListText: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
    },
  });
