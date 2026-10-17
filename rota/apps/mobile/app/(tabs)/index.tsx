/**
 * =============================================================================
 * Rota Mobile — Schedule Screen (Client UI for Tiers 1–3)
 * =============================================================================
 * AGENTS.md §2.1 (TanStack Query for all server data), §3.2 (A-01, A-07, A-09, A-10),
 * §5 (Design tokens only, accessible touch targets, light/dark themes).
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import {
  Calendar,
  Plus,
  Clock,
  MapPin,
  User,
  ArrowRightLeft,
  FileText,
  Users,
  Building2,
  KeyRound,
  ChevronDown,
  Wifi,
  WifiOff,
  Bell,
  X,
} from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../src/theme';
import { Text } from '../../src/components/Text';
import { Badge } from '../../src/components/Badge';
import { Card } from '../../src/components/Card';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { useCurrentUser } from '../../src/features/auth/useAuth';
import { useUIStore } from '../../src/state/uiStore';
import { useNetworkStore } from '../../src/state/networkStore';
import {
  useShifts,
  usePublishShift,
  useCancelShift,
  useUpcomingShifts,
} from '../../src/features/shifts/useShifts';
import {
  useSwaps,
  useRespondSwap,
  useReviewSwap,
} from '../../src/features/swaps/useSwaps';
import { useTeamMembers } from '../../src/features/teams/useTeam';
import { CreateShiftModal } from '../../src/features/shifts/CreateShiftModal';
import { RequestSwapModal } from '../../src/features/swaps/RequestSwapModal';
import { CreateTeamModal } from '../../src/features/teams/CreateTeamModal';
import { JoinTeamModal } from '../../src/features/teams/JoinTeamModal';
import { getErrorMessage } from '../../src/utils/error';
import type { ShiftDto, ShiftPublicDto } from '@rota/contracts';

export default function ScheduleScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Network and Offline Connectivity Store (Rule P-02, P-03)
  const isOnline = useNetworkStore((s) => s.effectiveIsOnline());
  const isSimulatedOffline = useNetworkStore((s) => s.isSimulatedOffline);
  const toggleSimulatedOffline = useNetworkStore((s) => s.toggleSimulatedOffline);

  // Auth & Active Team Context
  const { data: authData, isLoading: authLoading, refetch: refetchAuth } = useCurrentUser();
  const {
    selectedTeamId,
    setSelectedTeamId,
    highlightedShiftId,
    highlightedSwapId,
    setHighlightedShiftId,
    setHighlightedSwapId,
  } = useUIStore();
  const teams = authData?.teams ?? [];
  const activeTeam = teams.find((t) => t.id === selectedTeamId) ?? teams[0];
  const teamId = activeTeam?.id;
  const userRole = activeTeam?.role;
  const isManagerOrOwner = userRole === 'owner' || userRole === 'manager';
  const currentUserId = authData?.user?.id;

  // Data Queries
  const {
    data: shifts = [],
    isLoading: shiftsLoading,
    isRefetching: shiftsRefetching,
    refetch: refetchShifts,
  } = useShifts(teamId);

  const { data: swaps = [], refetch: refetchSwaps } = useSwaps(teamId);

  const { data: members = [] } = useTeamMembers(teamId);

  // Current user's team membership ID
  const myMembership = useMemo(() => {
    if (!currentUserId || !members.length) return null;
    return members.find((m) => m.userId === currentUserId) ?? null;
  }, [members, currentUserId]);

  const myMembershipId = myMembership?.id;

  // Rule P-02: Offline upcoming shifts query (persisted via AsyncStorage)
  const upcomingQuery = useUpcomingShifts(teamId, myMembershipId ?? undefined, currentUserId);

  // Member lookup helper
  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      map.set(m.id, m.displayName || m.email || `Member ${m.id.slice(0, 6)}`);
    }
    return map;
  }, [members]);

  // Shift lookup helper for swaps
  const shiftMap = useMemo(() => {
    const map = new Map<string, ShiftDto | ShiftPublicDto>();
    for (const s of shifts) {
      map.set(s.id, s);
    }
    return map;
  }, [shifts]);

  // Mutations
  const publishShiftMutation = usePublishShift(teamId);
  const cancelShiftMutation = useCancelShift(teamId);
  const respondSwapMutation = useRespondSwap(teamId);
  const reviewSwapMutation = useReviewSwap(teamId);

  // Modals state
  const [createShiftModalOpen, setCreateShiftModalOpen] = useState(false);
  const [swapModalShift, setSwapModalShift] = useState<ShiftDto | ShiftPublicDto | null>(null);
  const [createTeamModalOpen, setCreateTeamModalOpen] = useState(false);
  const [joinTeamModalOpen, setJoinTeamModalOpen] = useState(false);
  const [teamSelectorOpen, setTeamSelectorOpen] = useState(false);

  // Shift Filter: 'all' | 'mine' | 'drafts'
  const [filter, setFilter] = useState<'all' | 'mine' | 'drafts'>('all');

  // Rule P-02: Fall back to sanitized offline shifts when disconnected
  const displayShifts = useMemo(() => {
    if (!isOnline || upcomingQuery.data?.isOffline) {
      return (upcomingQuery.data?.shifts ?? []) as (ShiftDto | ShiftPublicDto)[];
    }
    return shifts;
  }, [isOnline, upcomingQuery.data, shifts]);

  const filteredShifts = useMemo(() => {
    return displayShifts.filter((shift) => {
      if (filter === 'mine') {
        return shift.assignedMembershipId === myMembershipId;
      }
      if (filter === 'drafts') {
        return shift.status === 'draft';
      }
      return true;
    });
  }, [displayShifts, filter, myMembershipId]);

  // Swaps requiring attention
  const actionableSwaps = useMemo(() => {
    return swaps.filter((s) => {
      // 1. Target colleague can accept/decline pending swap
      if (s.status === 'pending' && s.targetMembershipId === myMembershipId) {
        return true;
      }
      // 2. Manager/Owner can approve/reject when target has accepted
      if (s.status === 'pending' && s.targetAcceptedAt && isManagerOrOwner) {
        return true;
      }
      // 3. Pending requests where current user is the requester
      if (s.status === 'pending' && s.requesterMembershipId === myMembershipId) {
        return true;
      }
      return false;
    });
  }, [swaps, myMembershipId, isManagerOrOwner]);

  const handleRefresh = useCallback(() => {
    refetchAuth();
    if (isOnline) {
      refetchShifts();
      refetchSwaps();
    }
    upcomingQuery.refetch();
  }, [refetchAuth, isOnline, refetchShifts, refetchSwaps, upcomingQuery]);

  const handlePublish = async (shift: ShiftDto | ShiftPublicDto) => {
    // Rule P-03: Never write while offline
    if (!isOnline) {
      Alert.alert('Offline Mode', 'Cannot publish shifts while offline (Rule P-03).');
      return;
    }
    try {
      await publishShiftMutation.mutateAsync({ shiftId: shift.id });
    } catch (err: unknown) {
      Alert.alert('Error', getErrorMessage(err, 'Could not publish shift'));
    }
  };

  const handleCancel = (shift: ShiftDto | ShiftPublicDto) => {
    // Rule P-03: Never write while offline
    if (!isOnline) {
      Alert.alert('Offline Mode', 'Cannot cancel shifts while offline (Rule P-03).');
      return;
    }
    Alert.alert(
      'Cancel Shift',
      `Are you sure you want to cancel "${shift.title}"? Any pending swaps will expire.`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Cancel Shift',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelShiftMutation.mutateAsync({ shiftId: shift.id });
            } catch (err: unknown) {
              Alert.alert('Error', getErrorMessage(err, 'Could not cancel shift'));
            }
          },
        },
      ]
    );
  };

  const handleSwapResponse = async (swapId: string, action: 'accept' | 'decline') => {
    // Rule P-03: Never write while offline
    if (!isOnline) {
      Alert.alert('Offline Mode', 'Cannot respond to swaps while offline (Rule P-03).');
      return;
    }
    try {
      await respondSwapMutation.mutateAsync({ swapId, payload: { action } });
    } catch (err: unknown) {
      Alert.alert('Error', getErrorMessage(err, 'Failed to respond to swap'));
    }
  };

  const handleSwapReview = async (swapId: string, action: 'approve' | 'reject') => {
    // Rule P-03: Never write while offline
    if (!isOnline) {
      Alert.alert('Offline Mode', 'Cannot review swaps while offline (Rule P-03).');
      return;
    }
    try {
      await reviewSwapMutation.mutateAsync({ swapId, payload: { action } });
    } catch (err: unknown) {
      Alert.alert('Error', getErrorMessage(err, 'Failed to review swap'));
    }
  };

  // 1. Loading State
  if (authLoading || (shiftsLoading && !shiftsRefetching)) {
    return (
      <View style={styles.centerContainer} accessibilityRole="progressbar">
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text role="bodyMedium" color="onSurfaceVariant" style={styles.loadingText}>
          Loading schedule...
        </Text>
      </View>
    );
  }

  // 2. No Active Team State
  if (!activeTeam) {
    return (
      <View style={styles.centerContainer}>
        <View style={styles.emptyIconCircle}>
          <Users size={32} color={theme.colors.primary} />
        </View>
        <Text role="headlineSmall" color="onSurface" style={styles.emptyTitle}>
          No Team Found
        </Text>
        <Text role="bodyMedium" color="onSurfaceVariant" style={styles.emptySubtitle}>
          You are not currently a member of any team. Create your team to begin scheduling shifts, or enter an invitation code from your manager.
        </Text>

        <View style={styles.emptyActionButtonsRow}>
          <PrimaryButton
            label="Create a Team"
            leadingIcon={<Plus size={18} color={theme.colors.onPrimary} />}
            onPress={() => setCreateTeamModalOpen(true)}
            style={styles.emptyActionBtn}
          />
          <PrimaryButton
            label="Join with Invite Code"
            variant="secondary"
            leadingIcon={<KeyRound size={18} color={theme.colors.primary} />}
            onPress={() => setJoinTeamModalOpen(true)}
            style={styles.emptyActionBtn}
          />
        </View>

        <CreateTeamModal
          visible={createTeamModalOpen}
          onClose={() => setCreateTeamModalOpen(false)}
          onSuccess={(newId) => setSelectedTeamId(newId)}
        />
        <JoinTeamModal
          visible={joinTeamModalOpen}
          onClose={() => setJoinTeamModalOpen(false)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Screen Header Bar */}
      <View style={styles.topHeader}>
        <View style={styles.teamInfo}>
          {teams.length > 1 ? (
            <Pressable
              onPress={() => setTeamSelectorOpen(!teamSelectorOpen)}
              style={styles.teamSelectorTrigger}
              accessibilityRole="button"
              accessibilityLabel="Switch active team"
            >
              <Text role="headlineSmall" color="onSurface" style={styles.teamName}>
                {activeTeam.name}
              </Text>
              <ChevronDown size={18} color={theme.colors.onSurface} />
            </Pressable>
          ) : (
            <Text role="headlineSmall" color="onSurface" style={styles.teamName}>
              {activeTeam.name}
            </Text>
          )}

          <View style={styles.roleRow}>
            <Badge
              label={userRole ? userRole.toUpperCase() : 'MEMBER'}
              variant="primary"
              size="small"
            />
            <Text role="bodySmall" color="onSurfaceVariant">
              {activeTeam.timezone}
            </Text>
          </View>
        </View>

        <View style={styles.headerRightActions}>
          {/* Offline Mode Simulator Toggle Button */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isSimulatedOffline
                ? 'Turn offline simulation off'
                : 'Simulate offline mode (Rule P-02 / P-03 demo)'
            }
            onPress={toggleSimulatedOffline}
            style={[styles.offlineToggleButton, !isOnline && styles.offlineToggleButtonActive]}
          >
            {isOnline ? (
              <Wifi size={18} color={theme.colors.onSurfaceVariant} />
            ) : (
              <WifiOff size={18} color={theme.colors.onError} />
            )}
          </Pressable>

          {isManagerOrOwner ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create new shift"
              onPress={() => {
                if (!isOnline) {
                  Alert.alert('Offline Mode', 'Cannot create shifts while offline (Rule P-03).');
                  return;
                }
                setCreateShiftModalOpen(true);
              }}
              style={styles.newShiftButton}
            >
              <Plus size={18} color={theme.colors.onPrimary} />
              <Text role="labelMedium" color="onPrimary" style={styles.newShiftButtonText}>
                Shift
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Team Selector Dropdown Drawer (if multi-team) */}
      {teamSelectorOpen && teams.length > 1 ? (
        <View style={styles.teamDropdown}>
          <Text role="labelSmall" color="onSurfaceVariant" style={styles.teamDropdownHeader}>
            SWITCH TEAM
          </Text>
          {teams.map((t) => {
            const isSelected = t.id === activeTeam.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => {
                  setSelectedTeamId(t.id);
                  setTeamSelectorOpen(false);
                }}
                style={[styles.teamDropdownItem, isSelected && styles.teamDropdownItemActive]}
                accessibilityRole="button"
                accessibilityLabel={`Select team ${t.name}`}
              >
                <View style={styles.teamDropdownItemLeft}>
                  <Building2 size={16} color={isSelected ? theme.colors.primary : theme.colors.onSurfaceVariant} />
                  <Text role="bodyMedium" color={isSelected ? 'primary' : 'onSurface'}>
                    {t.name}
                  </Text>
                </View>
                <Badge
                  label={t.role.toUpperCase()}
                  variant={isSelected ? 'primary' : 'neutral'}
                  size="small"
                />
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={shiftsRefetching || upcomingQuery.isRefetching}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* Offline Status Banner (Rule P-02) */}
        {!isOnline || upcomingQuery.data?.isOffline ? (
          <OfflineBanner
            lastSyncTime={upcomingQuery.data?.syncedAt}
            isExpired={upcomingQuery.data?.isExpired}
            onRefresh={handleRefresh}
          />
        ) : null}

        {/* Push Notification Tap Highlight Banner (Rule P-05: Tap-To-Open Router) */}
        {highlightedShiftId || highlightedSwapId ? (
          <View style={styles.notificationBanner}>
            <View style={styles.notificationBannerContent}>
              <Bell size={18} color={theme.colors.primary} />
              <View style={{ flex: 1, gap: theme.spacing.extraSmall / 2 }}>
                <Text role="labelMedium" color="primary">
                  Highlighting {highlightedShiftId ? 'Shift' : 'Swap'} from Notification
                </Text>
                <Text role="bodySmall" color="onSurfaceVariant">
                  Opened via tap-to-open push notification. Tap ✕ to clear highlight.
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear notification highlight"
              onPress={() => {
                setHighlightedShiftId(null);
                setHighlightedSwapId(null);
              }}
              style={styles.notificationBannerClose}
            >
              <X size={16} color={theme.colors.onSurfaceVariant} />
            </Pressable>
          </View>
        ) : null}

        {/* Expired Cache Notice (Rule P-02: Hidden after 14 days) */}
        {!isOnline && upcomingQuery.data?.isExpired ? (
          <Card variant="outlined" style={styles.expiredCard}>
            <Text role="labelLarge" color="error">
              Offline Cache Expired (Older than 14 days)
            </Text>
            <Text role="bodySmall" color="onErrorContainer">
              Offline shifts older than 14 days are hidden for security reasons (Rule P-02). Connect to the internet to refresh your schedule.
            </Text>
          </Card>
        ) : null}

        {/* Pending Swaps Section (Hidden when offline, Rule P-03) */}
        {isOnline && actionableSwaps.length > 0 ? (
          <View style={styles.swapsSection}>
            <View style={styles.sectionHeaderRow}>
              <ArrowRightLeft size={16} color={theme.colors.primary} />
              <Text role="labelLarge" color="onSurface" style={styles.sectionTitle}>
                Pending Swaps ({actionableSwaps.length})
              </Text>
            </View>

            {actionableSwaps.map((swap) => {
              const relatedShift = shiftMap.get(swap.shiftId);
              const requesterName = memberNameMap.get(swap.requesterMembershipId) || 'Colleague';
              const targetName = memberNameMap.get(swap.targetMembershipId) || 'Colleague';
              const isTarget = swap.targetMembershipId === myMembershipId;
              const needsManagerReview = !!swap.targetAcceptedAt && isManagerOrOwner;
              const isHighlighted = swap.id === highlightedSwapId;

              return (
                <Card
                  key={swap.id}
                  variant="elevated"
                  style={[styles.swapCard, isHighlighted && styles.highlightedCard]}
                >
                  <View style={styles.swapHeader}>
                    <View style={styles.swapHeaderLeft}>
                      <Badge
                        label={
                          needsManagerReview
                            ? 'Awaiting Approval'
                            : isTarget
                            ? 'Swap Offered to You'
                            : 'Pending Colleague'
                        }
                        variant={needsManagerReview ? 'tertiary' : isTarget ? 'primary' : 'neutral'}
                        size="small"
                      />
                      {isHighlighted ? (
                        <Badge label="From Push" variant="primary" size="small" />
                      ) : null}
                    </View>
                    <Text role="bodySmall" color="onSurfaceVariant">
                      {new Date(swap.createdAt).toLocaleDateString()}
                    </Text>
                  </View>

                  <Text role="bodyMedium" color="onSurface" style={styles.swapSummary}>
                    {requesterName} ➔ {targetName}
                  </Text>

                  {relatedShift ? (
                    <Text role="bodySmall" color="onSurfaceVariant">
                      Shift: {relatedShift.title} (
                      {new Date(relatedShift.startsAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      )
                    </Text>
                  ) : null}

                  {swap.message ? (
                    <Text role="bodySmall" color="onSurfaceVariant" style={styles.swapMessage}>
                      "{swap.message}"
                    </Text>
                  ) : null}

                  {/* Actions for Target Colleague */}
                  {isTarget && !swap.targetAcceptedAt ? (
                    <View style={styles.swapActionsRow}>
                      <PrimaryButton
                        label="Decline"
                        variant="secondary"
                        onPress={() => handleSwapResponse(swap.id, 'decline')}
                        loading={respondSwapMutation.isPending}
                        style={styles.swapActionButton}
                      />
                      <PrimaryButton
                        label="Accept Swap"
                        onPress={() => handleSwapResponse(swap.id, 'accept')}
                        loading={respondSwapMutation.isPending}
                        style={styles.swapActionButton}
                      />
                    </View>
                  ) : null}

                  {/* Actions for Manager Approval */}
                  {needsManagerReview ? (
                    <View style={styles.swapActionsRow}>
                      <PrimaryButton
                        label="Reject"
                        variant="secondary"
                        onPress={() => handleSwapReview(swap.id, 'reject')}
                        loading={reviewSwapMutation.isPending}
                        style={styles.swapActionButton}
                      />
                      <PrimaryButton
                        label="Approve Swap"
                        onPress={() => handleSwapReview(swap.id, 'approve')}
                        loading={reviewSwapMutation.isPending}
                        style={styles.swapActionButton}
                      />
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </View>
        ) : null}

        {/* Filter Segmented Controls */}
        <View style={styles.filterRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filter all shifts"
            onPress={() => setFilter('all')}
            style={[styles.filterChip, filter === 'all' && styles.filterChipActive]}
          >
            <Text role="labelSmall" color={filter === 'all' ? 'onPrimary' : 'onSurface'}>
              All Shifts ({shifts.length})
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filter my shifts"
            onPress={() => setFilter('mine')}
            style={[styles.filterChip, filter === 'mine' && styles.filterChipActive]}
          >
            <Text role="labelSmall" color={filter === 'mine' ? 'onPrimary' : 'onSurface'}>
              My Shifts
            </Text>
          </Pressable>

          {isManagerOrOwner ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Filter draft shifts"
              onPress={() => setFilter('drafts')}
              style={[styles.filterChip, filter === 'drafts' && styles.filterChipActive]}
            >
              <Text role="labelSmall" color={filter === 'drafts' ? 'onPrimary' : 'onSurface'}>
                Drafts
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Shifts List / Empty State */}
        {filteredShifts.length === 0 ? (
          <View style={styles.emptyShiftsCard}>
            <Calendar size={32} color={theme.colors.onSurfaceVariant} />
            <Text role="headlineSmall" color="onSurface" style={styles.emptyShiftsTitle}>
              No Shifts Scheduled
            </Text>
            <Text role="bodyMedium" color="onSurfaceVariant" style={styles.emptyShiftsSubtitle}>
              {filter === 'mine'
                ? 'You do not have any upcoming shifts assigned.'
                : filter === 'drafts'
                ? 'No draft shifts. Tap + Shift to create one.'
                : 'There are no shifts scheduled yet.'}
            </Text>
          </View>
        ) : (
          <View style={styles.shiftsList}>
            {filteredShifts.map((shift) => {
              const starts = new Date(shift.startsAt);
              const ends = new Date(shift.endsAt);
              const isAssignedToMe = shift.assignedMembershipId === myMembershipId;
              const assignedName = shift.assignedMembershipId
                ? isAssignedToMe
                  ? 'You'
                  : memberNameMap.get(shift.assignedMembershipId) || 'Assigned'
                : 'Unassigned';

              const isDraft = shift.status === 'draft';
              const isPublished = shift.status === 'published';
              const isCancelled = shift.status === 'cancelled';

              const dateString = starts.toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              });

              const timeString = `${starts.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              })} – ${ends.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              })}`;

              const isHighlighted = shift.id === highlightedShiftId;

              return (
                <Card
                  key={shift.id}
                  variant="outlined"
                  style={[styles.shiftCard, isHighlighted && styles.highlightedCard]}
                >
                  {/* Top Row: Date & Status Badge */}
                  <View style={styles.shiftCardHeader}>
                    <View style={styles.shiftCardHeaderLeft}>
                      <Text role="labelMedium" color="primary" style={styles.shiftDateText}>
                        {dateString}
                      </Text>
                      {isHighlighted ? (
                        <Badge label="From Push" variant="primary" size="small" />
                      ) : null}
                    </View>
                    <Badge
                      label={
                        isPublished
                          ? 'Published'
                          : isDraft
                          ? 'Draft'
                          : 'Cancelled'
                      }
                      variant={isPublished ? 'secondary' : isDraft ? 'tertiary' : 'error'}
                      size="small"
                    />
                  </View>

                  {/* Title & Time */}
                  <Text role="headlineSmall" color="onSurface" style={styles.shiftTitle}>
                    {shift.title}
                  </Text>

                  <View style={styles.shiftMetaRow}>
                    <Clock size={15} color={theme.colors.onSurfaceVariant} />
                    <Text role="bodyMedium" color="onSurface">
                      {timeString}
                    </Text>
                  </View>

                  {shift.locationLabel ? (
                    <View style={styles.shiftMetaRow}>
                      <MapPin size={15} color={theme.colors.onSurfaceVariant} />
                      <Text role="bodySmall" color="onSurfaceVariant">
                        {shift.locationLabel}
                      </Text>
                    </View>
                  ) : null}

                  {/* Assigned Person */}
                  <View style={styles.shiftMetaRow}>
                    <User size={15} color={theme.colors.onSurfaceVariant} />
                    <Text role="bodySmall" color={isAssignedToMe ? 'primary' : 'onSurface'}>
                      {assignedName}
                      {isAssignedToMe ? ' (You)' : ''}
                    </Text>
                  </View>

                  {/* Manager Notes (Rule A-07: visible to managers/owners only) */}
                  {'notes' in shift && shift.notes ? (
                    <View style={styles.notesBox}>
                      <FileText size={14} color={theme.colors.onSurfaceVariant} />
                      <Text role="bodySmall" color="onSurfaceVariant" style={styles.notesText}>
                        Note: {shift.notes}
                      </Text>
                    </View>
                  ) : null}

                  {/* Action Buttons */}
                  <View style={styles.shiftActionsContainer}>
                    {/* Draft Actions for Manager/Owner */}
                    {isDraft && isManagerOrOwner ? (
                      <View style={styles.actionsRow}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Cancel draft shift ${shift.title}`}
                          onPress={() => handleCancel(shift)}
                          style={styles.cancelTextButton}
                        >
                          <Text role="labelSmall" color="error">
                            Cancel
                          </Text>
                        </Pressable>
                        <PrimaryButton
                          label="Publish Shift"
                          onPress={() => handlePublish(shift)}
                          loading={publishShiftMutation.isPending}
                          style={styles.cardActionButton}
                        />
                      </View>
                    ) : null}

                    {/* Published Actions: Request Swap for Assigned Staff */}
                    {isPublished && isAssignedToMe ? (
                      <PrimaryButton
                        label="Request Swap"
                        variant="secondary"
                        leadingIcon={<ArrowRightLeft size={16} color={theme.colors.primary} />}
                        onPress={() => {
                          if (!isOnline) {
                            Alert.alert('Offline Mode', 'Cannot request swaps while offline (Rule P-03).');
                            return;
                          }
                          setSwapModalShift(shift);
                        }}
                        style={styles.cardFullButton}
                      />
                    ) : null}

                    {/* Cancel for Published Shifts (Manager/Owner only) */}
                    {isPublished && isManagerOrOwner && !isCancelled ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Cancel published shift ${shift.title}`}
                        onPress={() => handleCancel(shift)}
                        style={styles.cancelPublishedButton}
                      >
                        <Text role="labelSmall" color="error">
                          Cancel Shift
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Modals */}
      {teamId ? (
        <>
          <CreateShiftModal
            visible={createShiftModalOpen}
            onClose={() => setCreateShiftModalOpen(false)}
            teamId={teamId}
          />
          <RequestSwapModal
            visible={!!swapModalShift}
            onClose={() => setSwapModalShift(null)}
            teamId={teamId}
            shift={swapModalShift}
            currentUserId={currentUserId ?? ''}
          />
        </>
      ) : null}

      <CreateTeamModal
        visible={createTeamModalOpen}
        onClose={() => setCreateTeamModalOpen(false)}
        onSuccess={(newId) => setSelectedTeamId(newId)}
      />
      <JoinTeamModal
        visible={joinTeamModalOpen}
        onClose={() => setJoinTeamModalOpen(false)}
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
    centerContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: t.spacing.large,
      backgroundColor: t.colors.surface,
      gap: t.spacing.small,
    },
    emptyActionButtonsRow: {
      flexDirection: 'row',
      gap: t.spacing.medium,
      marginTop: t.spacing.large,
      width: '100%',
    },
    emptyActionBtn: {
      flex: 1,
    },
    loadingText: {
      marginTop: t.spacing.small,
    },
    topHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: t.spacing.base,
      paddingVertical: t.spacing.medium,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.surfaceVariant,
      backgroundColor: t.colors.surface,
    },
    teamInfo: {
      gap: t.spacing.extraSmall / 2,
    },
    teamSelectorTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
    },
    headerRightActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
    },
    offlineToggleButton: {
      width: t.touchTarget - 8,
      height: t.touchTarget - 8,
      borderRadius: (t.touchTarget - 8) / 2,
      backgroundColor: t.colors.surfaceContainer,
      justifyContent: 'center',
      alignItems: 'center',
    },
    offlineToggleButtonActive: {
      backgroundColor: t.colors.errorContainer,
    },
    expiredCard: {
      padding: t.spacing.base,
      gap: t.spacing.small,
      borderColor: t.colors.error,
      backgroundColor: t.colors.errorContainer,
    },
    teamDropdown: {
      backgroundColor: t.colors.surfaceContainer,
      padding: t.spacing.medium,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.surfaceVariant,
      gap: t.spacing.small,
    },
    teamDropdownHeader: {
      letterSpacing: 1,
      fontWeight: '700',
    },
    teamDropdownItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: t.spacing.medium,
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.card,
    },
    teamDropdownItemActive: {
      borderWidth: 1,
      borderColor: t.colors.primary,
    },
    teamDropdownItemLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
    },
    teamName: {
      fontWeight: '700',
    },
    roleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
    },
    newShiftButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
      backgroundColor: t.colors.primary,
      paddingHorizontal: t.spacing.medium,
      paddingVertical: t.spacing.small,
      minHeight: t.touchTarget - 8,
      borderRadius: t.radius.control,
    },
    newShiftButtonText: {
      fontWeight: '600',
    },
    scrollArea: {
      flex: 1,
    },
    scrollContent: {
      padding: t.spacing.base,
      gap: t.spacing.base,
      paddingBottom: t.spacing.extraLarge * 2,
    },
    swapsSection: {
      gap: t.spacing.small,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
    },
    sectionTitle: {
      fontWeight: '700',
    },
    swapCard: {
      gap: t.spacing.small,
      padding: t.spacing.medium,
      backgroundColor: t.colors.surfaceContainerLowest,
    },
    swapHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    swapSummary: {
      fontWeight: '600',
    },
    swapMessage: {
      fontStyle: 'italic',
    },
    swapActionsRow: {
      flexDirection: 'row',
      gap: t.spacing.small,
      marginTop: t.spacing.extraSmall,
    },
    swapActionButton: {
      flex: 1,
      minHeight: t.touchTarget - 8,
    },
    filterRow: {
      flexDirection: 'row',
      gap: t.spacing.small,
    },
    filterChip: {
      paddingHorizontal: t.spacing.medium,
      paddingVertical: t.spacing.small,
      borderRadius: t.radius.control,
      backgroundColor: t.colors.surfaceContainer,
      minHeight: t.touchTarget - 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    filterChipActive: {
      backgroundColor: t.colors.primary,
    },
    emptyShiftsCard: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: t.spacing.extraLarge * 1.5,
      gap: t.spacing.small,
    },
    emptyShiftsTitle: {
      fontWeight: '700',
      marginTop: t.spacing.small,
    },
    emptyShiftsSubtitle: {
      textAlign: 'center',
      maxWidth: 280,
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
      fontWeight: '700',
    },
    emptySubtitle: {
      textAlign: 'center',
      maxWidth: 300,
    },
    shiftsList: {
      gap: t.spacing.medium,
    },
    shiftCard: {
      gap: t.spacing.small,
      padding: t.spacing.base,
    },
    shiftCardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    shiftDateText: {
      fontWeight: '600',
    },
    shiftTitle: {
      fontWeight: '700',
    },
    shiftMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
    },
    notesBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: t.spacing.extraSmall,
      backgroundColor: t.colors.surfaceContainer,
      padding: t.spacing.small,
      borderRadius: t.radius.control,
      marginTop: t.spacing.extraSmall,
    },
    notesText: {
      flex: 1,
    },
    shiftActionsContainer: {
      marginTop: t.spacing.extraSmall,
      paddingTop: t.spacing.small,
      borderTopWidth: 1,
      borderTopColor: t.colors.surfaceVariant,
    },
    actionsRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: t.spacing.medium,
    },
    cancelTextButton: {
      paddingHorizontal: t.spacing.medium,
      minHeight: t.touchTarget - 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    cardActionButton: {
      minHeight: t.touchTarget - 8,
      paddingHorizontal: t.spacing.large,
    },
    cardFullButton: {
      width: '100%',
      minHeight: t.touchTarget - 8,
    },
    cancelPublishedButton: {
      alignSelf: 'flex-end',
      paddingVertical: t.spacing.extraSmall,
    },
    notificationBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.colors.primaryContainer,
      borderRadius: t.radius.card,
      padding: t.spacing.medium,
      gap: t.spacing.small,
      borderWidth: 1,
      borderColor: t.colors.primary,
    },
    notificationBannerContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
      flex: 1,
    },
    notificationBannerClose: {
      padding: t.spacing.extraSmall,
      minWidth: t.touchTarget - 16,
      minHeight: t.touchTarget - 16,
      justifyContent: 'center',
      alignItems: 'center',
    },
    highlightedCard: {
      borderWidth: 2,
      borderColor: t.colors.primary,
    },
    swapHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
    },
    shiftCardHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
    },
  });
