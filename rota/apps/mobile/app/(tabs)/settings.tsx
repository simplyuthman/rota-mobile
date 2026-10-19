/**
 * =============================================================================
 * Rota Mobile — Settings Tab Screen
 * =============================================================================
 * AGENTS.md §3.2 (A-04, A-05, A-06), §3.3 (S-03, S-07), §3.4 (P-01, P-04, P-06, P-07, P-08),
 * §5 (zero raw literals, token-only styling).
 *
 * Sections:
 *   1. User Profile & Account
 *   2. Active Team & Roster
 *   3. Quiet Hours & Timezone (Rule P-06, P-07)
 *   4. Notification Preferences (Category toggles, security non-disableable)
 *   5. Appearance & Theme Switcher (light / dark / system)
 *   6. Sign Out (wipes shift cache P-01 and deactivates push devices P-04)
 * =============================================================================
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  User,
  Users,
  UserPlus,
  Moon,
  Sun,
  Smartphone,
  LogOut,
  CheckCircle2,
  Clock,
  ChevronRight,
  Building2,
  KeyRound,
  Plus,
  Bell,
  BellOff,
  ShieldCheck,
  Globe,
  Calendar,
  ArrowLeftRight,
  CreditCard,
  Radio,
  Cpu,
  Activity,
  Sparkles,
} from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../src/theme';
import { Text } from '../../src/components/Text';
import { Badge } from '../../src/components/Badge';
import { Card } from '../../src/components/Card';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { useCurrentUser, useSignOut } from '../../src/features/auth/useAuth';
import { useUIStore } from '../../src/state/uiStore';
import { useNetworkStore } from '../../src/state/networkStore';
import {
  useTeamMembers,
  useUpdateMemberRoleOrStatus,
} from '../../src/features/teams/useTeam';
import { useSettings, useUpdateSettings } from '../../src/features/settings/useSettings';
import { InviteMemberModal } from '../../src/features/teams/InviteMemberModal';
import { CreateTeamModal } from '../../src/features/teams/CreateTeamModal';
import { JoinTeamModal } from '../../src/features/teams/JoinTeamModal';
import { BillingModal } from '../../src/features/billing/BillingModal';
// Dev-only tools — excluded from production/preview builds
const PushNotificationSimulatorModal = __DEV__
  ? require('../../src/features/notifications/PushNotificationSimulatorModal').PushNotificationSimulatorModal
  : null;
const SystemDiagnosticsModal = __DEV__
  ? require('../../src/features/system/SystemDiagnosticsModal').SystemDiagnosticsModal
  : null;
const ProductionReadinessModal = __DEV__
  ? require('../../src/features/system/ProductionReadinessModal').ProductionReadinessModal
  : null;
import { useSubscription } from '../../src/features/billing/useBilling';
import { getErrorMessage } from '../../src/utils/error';
import type { TeamMembershipDto, Role } from '@rota/contracts';

const QUIET_HOURS_PRESETS = [
  { label: '22:00 – 07:00 (Standard)', start: '22:00', end: '07:00' },
  { label: '23:00 – 08:00 (Night Owl)', start: '23:00', end: '08:00' },
  { label: '21:00 – 06:00 (Early Bird)', start: '21:00', end: '06:00' },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();

  // Network state for offline write blocking (Rule P-03)
  const isOnline = useNetworkStore((s) => s.effectiveIsOnline());

  const { data: authData, isLoading: authLoading } = useCurrentUser();
  const {
    selectedTeamId,
    setSelectedTeamId,
    pushDeviceToken,
    openBillingModal,
    setOpenBillingModal,
  } = useUIStore();
  const teams = authData?.teams ?? [];
  const activeTeam = teams.find((t) => t.id === selectedTeamId) ?? teams[0];
  const user = authData?.user;
  const teamId = activeTeam?.id;
  const isOwner = activeTeam?.role === 'owner';

  const { data: members = [], isLoading: membersLoading } = useTeamMembers(teamId);
  const updateMember = useUpdateMemberRoleOrStatus(teamId);
  const signOut = useSignOut();

  // Settings query & mutation
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();

  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [createTeamModalOpen, setCreateTeamModalOpen] = useState(false);
  const [joinTeamModalOpen, setJoinTeamModalOpen] = useState(false);
  const [billingModalOpen, setBillingModalOpen] = useState(false);
  // Dev-only modal state — not accessible in production builds
  const [pushModalOpen, setPushModalOpen] = useState(__DEV__ ? false : false);
  const [diagnosticsModalOpen, setDiagnosticsModalOpen] = useState(__DEV__ ? false : false);
  const [productionModalOpen, setProductionModalOpen] = useState(__DEV__ ? false : false);

  // When a push notification of type 'billing' arrives, auto-open billing modal (Rule P-05)
  useEffect(() => {
    if (openBillingModal) {
      setBillingModalOpen(true);
      setOpenBillingModal(false);
    }
  }, [openBillingModal, setOpenBillingModal]);

  // Subscription & Billing query (PRD §6.8)
  const { data: subscription } = useSubscription(teamId);

  // Active seats count
  const activeSeats = useMemo(() => {
    return members.filter((m) => m.status === 'active').length;
  }, [members]);

  const handleRoleChange = (member: TeamMembershipDto) => {
    if (!isOwner) return;

    // Rule P-03: Never write while offline
    if (!isOnline) {
      Alert.alert('Offline Mode', 'Connect to change member roles (Rule P-03).');
      return;
    }

    // Rule A-04: Owner cannot change own role
    if (member.role === 'owner') {
      Alert.alert('Protected Account', 'The Owner role is immutable and cannot be changed.');
      return;
    }

    const nextRole: Role = member.role === 'staff' ? 'manager' : 'staff';
    const actionLabel = nextRole === 'manager' ? 'Promote to Manager' : 'Demote to Staff';

    Alert.alert(
      'Update Member Role',
      `Change role for ${member.displayName || member.email || 'this member'} to ${nextRole.toUpperCase()}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: actionLabel,
          onPress: async () => {
            try {
              await updateMember.mutateAsync({
                memberId: member.id,
                data: { role: nextRole },
              });
            } catch (err: unknown) {
              Alert.alert('Error', getErrorMessage(err, 'Failed to update role'));
            }
          },
        },
      ]
    );
  };

  const handleToggleQuietHours = (value: boolean) => {
    // Rule P-03: Never write while offline
    if (!isOnline) {
      Alert.alert('Offline Mode', 'Connect to change quiet hours (Rule P-03).');
      return;
    }

    updateSettings.mutate(
      {
        quietHoursEnabled: value,
        quietHoursStart: settings?.quietHoursStart ?? '22:00',
        quietHoursEnd: settings?.quietHoursEnd ?? '07:00',
      },
      {
        onError: (err) => {
          Alert.alert('Error', getErrorMessage(err, 'Failed to update quiet hours'));
        },
      }
    );
  };

  const handleSelectQuietHoursPreset = (start: string, end: string) => {
    // Rule P-03: Never write while offline
    if (!isOnline) {
      Alert.alert('Offline Mode', 'Connect to change quiet hours (Rule P-03).');
      return;
    }

    updateSettings.mutate(
      {
        quietHoursStart: start,
        quietHoursEnd: end,
      },
      {
        onError: (err) => {
          Alert.alert('Error', getErrorMessage(err, 'Failed to update quiet hours'));
        },
      }
    );
  };

  const handleToggleCategory = (categoryKey: 'shiftChanges' | 'swaps' | 'activity') => {
    if (!settings) return;

    // Rule P-03: Never write while offline
    if (!isOnline) {
      Alert.alert('Offline Mode', 'Connect to change notification preferences (Rule P-03).');
      return;
    }

    const current = settings.notificationPreferences[categoryKey];
    updateSettings.mutate(
      {
        notificationPreferences: {
          [categoryKey]: !current,
        },
      },
      {
        onError: (err) => {
          Alert.alert('Error', getErrorMessage(err, 'Failed to update notification category'));
        },
      }
    );
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out? Your shift cache will be cleared (Rule P-01) and push device unregistered (Rule P-04).',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await signOut.mutateAsync();
            router.replace('/(auth)/sign-in' as never);
          },
        },
      ]
    );
  };

  if (authLoading) {
    return (
      <View style={styles.centerContainer} accessibilityRole="progressbar">
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text role="bodyMedium" color="onSurfaceVariant" style={styles.loadingText}>
          Loading profile...
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 1. User Profile Section */}
      <View style={styles.section}>
        <Text role="labelLarge" color="onSurfaceVariant" style={styles.sectionHeaderTitle}>
          USER ACCOUNT
        </Text>
        <Card variant="outlined" style={styles.profileCard}>
          <View style={styles.profileRow}>
            <View style={styles.avatarCircle}>
              <User size={28} color={theme.colors.primary} />
            </View>
            <View style={styles.profileInfo}>
              <Text role="headlineSmall" color="onSurface" style={styles.profileName}>
                {user?.displayName || 'User'}
              </Text>
              <Text role="bodyMedium" color="onSurfaceVariant">
                {user?.email}
              </Text>
            </View>
          </View>

          <View style={styles.profileMetaRow}>
            <Badge
              label={user?.emailVerified ? 'Verified Account' : 'Unverified Email'}
              variant={user?.emailVerified ? 'secondary' : 'error'}
              size="small"
              icon={
                user?.emailVerified ? (
                  <CheckCircle2 size={12} color={theme.colors.onSecondaryContainer} />
                ) : undefined
              }
            />
            <Text role="bodySmall" color="onSurfaceVariant">
              Joined {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : ''}
            </Text>
          </View>
        </Card>
      </View>

      {/* 2. Active Team & Roster Section */}
      <View style={styles.section}>
        <View style={styles.teamSectionHeader}>
          <Text role="labelLarge" color="onSurfaceVariant" style={styles.sectionHeaderTitle}>
            ACTIVE TEAM
          </Text>
          {activeTeam && isOwner ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Invite new member"
              onPress={() => {
                if (!isOnline) {
                  Alert.alert('Offline Mode', 'Connect to invite members (Rule P-03).');
                  return;
                }
                setInviteModalOpen(true);
              }}
              style={styles.inviteButton}
            >
              <UserPlus size={14} color={theme.colors.primary} />
              <Text role="labelSmall" color="primary" style={styles.inviteButtonText}>
                Invite Member
              </Text>
            </Pressable>
          ) : null}
        </View>

        {!activeTeam ? (
          <Card variant="outlined" style={styles.noTeamCard}>
            <View style={styles.noTeamHeader}>
              <View style={styles.noTeamIconCircle}>
                <Building2 size={24} color={theme.colors.primary} />
              </View>
              <View style={styles.noTeamTextContainer}>
                <Text role="headlineSmall" color="onSurface" style={styles.teamTitle}>
                  No Active Team
                </Text>
                <Text role="bodySmall" color="onSurfaceVariant">
                  Create your team to begin scheduling shifts, or enter an invitation code from your manager.
                </Text>
              </View>
            </View>

            <View style={styles.noTeamButtonsRow}>
              <PrimaryButton
                label="Create a Team"
                leadingIcon={<Plus size={16} color={theme.colors.onPrimary} />}
                onPress={() => setCreateTeamModalOpen(true)}
                style={styles.noTeamBtn}
              />
              <PrimaryButton
                label="Join with Code"
                variant="secondary"
                leadingIcon={<KeyRound size={16} color={theme.colors.primary} />}
                onPress={() => setJoinTeamModalOpen(true)}
                style={styles.noTeamBtn}
              />
            </View>
          </Card>
        ) : (
          <Card variant="outlined" style={styles.teamCard}>
            <View style={styles.teamCardTop}>
              <View>
                <Text role="headlineSmall" color="onSurface" style={styles.teamTitle}>
                  {activeTeam.name}
                </Text>
                <View style={styles.timezoneRow}>
                  <Clock size={14} color={theme.colors.onSurfaceVariant} />
                  <Text role="bodySmall" color="onSurfaceVariant">
                    Timezone: {activeTeam.timezone}
                  </Text>
                </View>
              </View>
              <Badge
                label={activeTeam.role.toUpperCase()}
                variant="primary"
                size="medium"
              />
            </View>

            {/* Capacity / Seats counter */}
            <View style={styles.seatsUsageRow}>
              <Text role="bodySmall" color="onSurfaceVariant">
                Active Seats: <Text role="bodySmall" color="onSurface" style={styles.seatCountBold}>{activeSeats}</Text>
                {subscription ? ` / ${subscription.purchasedSeats} (${subscription.plan.toUpperCase()})` : isOwner ? ' / 5 (Starter Plan)' : ''}
              </Text>
              <Badge
                label={subscription ? subscription.status.toUpperCase() : 'TRIAL PERIOD ACTIVE'}
                variant={
                  subscription?.status === 'active'
                    ? 'primary'
                    : subscription?.status === 'trialing'
                    ? 'tertiary'
                    : 'error'
                }
                size="small"
              />
            </View>

            {/* Team Roster */}
            <View style={styles.rosterContainer}>
              <View style={styles.rosterHeader}>
                <Users size={16} color={theme.colors.onSurfaceVariant} />
                <Text role="labelMedium" color="onSurface" style={styles.rosterTitle}>
                  Team Roster ({members.length})
                </Text>
              </View>

              {membersLoading ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : (
                <View style={styles.membersList}>
                  {members.map((member) => {
                    const isSelf = member.userId === user?.id;
                    const name =
                      member.displayName || member.email || `Member ${member.id.slice(0, 6)}`;

                    return (
                      <Pressable
                        key={member.id}
                        disabled={!isOwner || member.role === 'owner'}
                        onPress={() => handleRoleChange(member)}
                        accessibilityRole={isOwner && member.role !== 'owner' ? 'button' : 'text'}
                        accessibilityLabel={`Member ${name}, role ${member.role}`}
                        style={styles.memberRow}
                      >
                        <View style={styles.memberInfo}>
                          <Text
                            role="bodyMedium"
                            color="onSurface"
                            style={styles.memberName}
                          >
                            {name}
                            {isSelf ? ' (You)' : ''}
                          </Text>
                          {member.email && member.displayName ? (
                            <Text role="bodySmall" color="onSurfaceVariant">
                              {member.email}
                            </Text>
                          ) : null}
                        </View>

                        <View style={styles.memberRoleContainer}>
                          <Badge
                            label={member.role.toUpperCase()}
                            variant={
                              member.role === 'owner'
                                ? 'primary'
                                : member.role === 'manager'
                                ? 'tertiary'
                                : 'neutral'
                            }
                            size="small"
                          />
                          {isOwner && member.role !== 'owner' ? (
                            <ChevronRight size={16} color={theme.colors.onSurfaceVariant} />
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Extra actions: Add/Join Another Team */}
            <View style={styles.teamCardFooter}>
              <Pressable
                onPress={() => setCreateTeamModalOpen(true)}
                style={styles.footerTeamAction}
                accessibilityRole="button"
                accessibilityLabel="Create another team"
              >
                <Plus size={14} color={theme.colors.primary} />
                <Text role="labelSmall" color="primary">
                  Create Another Team
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setJoinTeamModalOpen(true)}
                style={styles.footerTeamAction}
                accessibilityRole="button"
                accessibilityLabel="Join another team with code"
              >
                <KeyRound size={14} color={theme.colors.primary} />
                <Text role="labelSmall" color="primary">
                  Join Team with Code
                </Text>
              </Pressable>
            </View>
          </Card>
        )}
      </View>

      {/* Subscription & Billing Section (PRD §6.8, Tier 5) */}
      {activeTeam ? (
        <View style={styles.section}>
          <Text role="labelLarge" color="onSurfaceVariant" style={styles.sectionHeaderTitle}>
            SUBSCRIPTION & BILLING
          </Text>
          <Card variant="outlined" style={styles.settingsCard}>
            <View style={styles.billingCardTop}>
              <View style={styles.billingInfoLeft}>
                <View style={styles.labelWithIcon}>
                  <CreditCard size={18} color={theme.colors.primary} />
                  <Text role="headlineSmall" color="onSurface" style={styles.billingPlanTitle}>
                    {subscription ? `${subscription.plan.toUpperCase()} PLAN` : 'STARTER PLAN'}
                  </Text>
                </View>
                <Text role="bodySmall" color="onSurfaceVariant">
                  {subscription
                    ? `${subscription.purchasedSeats} Purchased Seats • $${(subscription.currentRecurringCents / 100).toFixed(2)}/mo`
                    : '5 Seats Included • $20.00/mo'}
                </Text>
              </View>
              <Badge
                label={subscription ? subscription.status.toUpperCase() : 'TRIALING'}
                variant={
                  subscription?.status === 'active'
                    ? 'primary'
                    : subscription?.status === 'trialing'
                    ? 'secondary'
                    : 'error'
                }
                size="medium"
              />
            </View>

            {subscription?.periodEnd && (
              <View style={styles.periodRow}>
                <Clock size={14} color={theme.colors.onSurfaceVariant} />
                <Text role="bodySmall" color="onSurfaceVariant">
                  {subscription.status === 'trialing' ? 'Trial ends' : 'Renews'}:{' '}
                  {new Date(subscription.periodEnd).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </Text>
              </View>
            )}

            {isOwner ? (
              <PrimaryButton
                label="Manage Subscription & Billing"
                variant="secondary"
                leadingIcon={<CreditCard size={16} color={theme.colors.primary} />}
                onPress={() => {
                  if (!isOnline) {
                    Alert.alert('Offline Mode', 'Connect to manage billing (Rule P-03).');
                    return;
                  }
                  setBillingModalOpen(true);
                }}
                style={styles.manageBillingBtn}
              />
            ) : (
              <Text role="bodySmall" color="onSurfaceVariant" style={styles.nonOwnerBillingNote}>
                Only the team owner can modify the subscription plan or billing details.
              </Text>
            )}
          </Card>
        </View>
      ) : null}

      {/* 3. Quiet Hours & Device Timezone (AGENTS.md P-06, P-07) */}
      <View style={styles.section}>
        <Text role="labelLarge" color="onSurfaceVariant" style={styles.sectionHeaderTitle}>
          QUIET HOURS & TIMEZONE
        </Text>
        <Card variant="outlined" style={styles.settingsCard}>
          {/* Timezone Info */}
          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <View style={styles.labelWithIcon}>
                <Globe size={18} color={theme.colors.primary} />
                <Text role="labelLarge" color="onSurface" style={styles.settingTitle}>
                  Device Timezone
                </Text>
              </View>
              <Text role="bodySmall" color="onSurfaceVariant">
                Initialized from your device (Rule P-07)
              </Text>
            </View>
            <Badge
              label={settings?.timezone || 'Detecting...'}
              variant="neutral"
              size="medium"
            />
          </View>

          <View style={styles.divider} />

          {/* Quiet Hours Switch */}
          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <View style={styles.labelWithIcon}>
                <BellOff size={18} color={theme.colors.primary} />
                <Text role="labelLarge" color="onSurface" style={styles.settingTitle}>
                  Quiet Hours
                </Text>
              </View>
              <Text role="bodySmall" color="onSurfaceVariant">
                Delay non-security notifications while you rest
              </Text>
            </View>
            <Switch
              value={settings?.quietHoursEnabled ?? false}
              onValueChange={handleToggleQuietHours}
              thumbColor={theme.colors.surface}
              trackColor={{ false: theme.colors.surfaceVariant, true: theme.colors.primary }}
              accessibilityRole="switch"
              accessibilityLabel="Enable Quiet Hours"
            />
          </View>

          {/* Quiet Hours Window & Presets */}
          {settings?.quietHoursEnabled ? (
            <View style={styles.quietHoursOptions}>
              <Text role="labelSmall" color="onSurfaceVariant">
                Active Window: {settings.quietHoursStart} to {settings.quietHoursEnd}
              </Text>
              <View style={styles.presetButtonsRow}>
                {QUIET_HOURS_PRESETS.map((preset) => {
                  const isSelected =
                    settings.quietHoursStart === preset.start &&
                    settings.quietHoursEnd === preset.end;
                  return (
                    <Pressable
                      key={preset.label}
                      onPress={() => handleSelectQuietHoursPreset(preset.start, preset.end)}
                      accessibilityRole="button"
                      accessibilityLabel={`Set quiet hours to ${preset.label}`}
                      style={[
                        styles.presetButton,
                        isSelected && styles.presetButtonSelected,
                      ]}
                    >
                      <Text
                        role="bodySmall"
                        color={isSelected ? 'primary' : 'onSurface'}
                        style={isSelected ? styles.presetTextSelected : undefined}
                      >
                        {preset.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text role="bodySmall" color="onSurfaceVariant" style={styles.quietHoursHint}>
                Security alerts (new sign-ins, password changes) bypass quiet hours immediately (Rule P-06).
              </Text>
            </View>
          ) : null}
        </Card>
      </View>

      {/* 4. Notification Preferences (Rule P-06 categories) */}
      <View style={styles.section}>
        <Text role="labelLarge" color="onSurfaceVariant" style={styles.sectionHeaderTitle}>
          NOTIFICATION CATEGORIES
        </Text>
        <Card variant="outlined" style={styles.settingsCard}>
          {/* Shift Changes */}
          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <View style={styles.labelWithIcon}>
                <Calendar size={18} color={theme.colors.primary} />
                <Text role="labelLarge" color="onSurface" style={styles.settingTitle}>
                  Shift Changes
                </Text>
              </View>
              <Text role="bodySmall" color="onSurfaceVariant">
                Published shifts, assignments, and schedule updates
              </Text>
            </View>
            <Switch
              value={settings?.notificationPreferences.shiftChanges ?? true}
              onValueChange={() => handleToggleCategory('shiftChanges')}
              thumbColor={theme.colors.surface}
              trackColor={{ false: theme.colors.surfaceVariant, true: theme.colors.primary }}
              accessibilityRole="switch"
              accessibilityLabel="Shift Changes Notifications"
            />
          </View>

          <View style={styles.divider} />

          {/* Shift Swaps */}
          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <View style={styles.labelWithIcon}>
                <ArrowLeftRight size={18} color={theme.colors.primary} />
                <Text role="labelLarge" color="onSurface" style={styles.settingTitle}>
                  Shift Swaps
                </Text>
              </View>
              <Text role="bodySmall" color="onSurfaceVariant">
                Swap requests from colleagues and manager reviews
              </Text>
            </View>
            <Switch
              value={settings?.notificationPreferences.swaps ?? true}
              onValueChange={() => handleToggleCategory('swaps')}
              thumbColor={theme.colors.surface}
              trackColor={{ false: theme.colors.surfaceVariant, true: theme.colors.primary }}
              accessibilityRole="switch"
              accessibilityLabel="Shift Swaps Notifications"
            />
          </View>

          <View style={styles.divider} />

          {/* Activity Feed */}
          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <View style={styles.labelWithIcon}>
                <Bell size={18} color={theme.colors.primary} />
                <Text role="labelLarge" color="onSurface" style={styles.settingTitle}>
                  Team Activity
                </Text>
              </View>
              <Text role="bodySmall" color="onSurfaceVariant">
                Team announcements and activity highlights
              </Text>
            </View>
            <Switch
              value={settings?.notificationPreferences.activity ?? true}
              onValueChange={() => handleToggleCategory('activity')}
              thumbColor={theme.colors.surface}
              trackColor={{ false: theme.colors.surfaceVariant, true: theme.colors.primary }}
              accessibilityRole="switch"
              accessibilityLabel="Team Activity Notifications"
            />
          </View>

          <View style={styles.divider} />

          {/* Security & Account (Rule P-06: Non-disableable) */}
          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <View style={styles.labelWithIcon}>
                <ShieldCheck size={18} color={theme.colors.primary} />
                <Text role="labelLarge" color="onSurface" style={styles.settingTitle}>
                  Security & Account
                </Text>
              </View>
              <Text role="bodySmall" color="onSurfaceVariant">
                Sign-ins, password changes, and critical security alerts
              </Text>
            </View>
            <Badge label="ALWAYS ON" variant="primary" size="small" />
          </View>
        </Card>

        {/* Tier 7: Push Notifications & Device Tester Card */}
        <Card variant="outlined" style={[styles.settingsCard, { marginTop: theme.spacing.medium }]}>
          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <View style={styles.labelWithIcon}>
                <Radio size={18} color={theme.colors.primary} />
                <Text role="labelLarge" color="onSurface" style={styles.settingTitle}>
                  Push Notifications & Tap Routing
                </Text>
              </View>
              <Text role="bodySmall" color="onSurfaceVariant">
                {pushDeviceToken ? 'Device registered on FCM / Expo (Rule P-04)' : 'Device token active on server'}
              </Text>
            </View>
            <Badge
              label={pushDeviceToken ? 'CONNECTED' : 'STANDBY'}
              variant={pushDeviceToken ? 'primary' : 'neutral'}
              size="small"
            />
          </View>

          <PrimaryButton
            label="Test Push Notifications & Routing"
            variant="secondary"
            leadingIcon={<Bell size={16} color={theme.colors.primary} />}
            onPress={() => setPushModalOpen(true)}
            style={{ width: '100%', marginTop: theme.spacing.small }}
          />
        </Card>

      {/* Dev-only diagnostic cards — hidden in production/preview builds */}
      {__DEV__ && (
        <>
          {/* Tier 7: Push Notification Simulator Card */}
          <Card variant="outlined" style={[styles.settingsCard, { marginTop: theme.spacing.medium }]}>
            <View style={styles.settingRow}>
              <View style={styles.settingTextCol}>
                <View style={styles.labelWithIcon}>
                  <Radio size={18} color={theme.colors.primary} />
                  <Text role="labelLarge" color="onSurface" style={styles.settingTitle}>
                    Push Notification Simulator
                  </Text>
                </View>
                <Text role="bodySmall" color="onSurfaceVariant">
                  Simulate push events: shift published, swap requested, billing
                </Text>
              </View>
              <Badge label="DEV" variant="primary" size="small" />
            </View>

            <PrimaryButton
              label="Open Push Simulator"
              variant="secondary"
              leadingIcon={<Bell size={16} color={theme.colors.primary} />}
              onPress={() => setPushModalOpen(true)}
              style={{ width: '100%', marginTop: theme.spacing.small }}
            />
          </Card>

          {/* Tier 8: System Architecture & Diagnostics Card */}
          <Card variant="outlined" style={[styles.settingsCard, { marginTop: theme.spacing.medium }]}>
            <View style={styles.settingRow}>
              <View style={styles.settingTextCol}>
                <View style={styles.labelWithIcon}>
                  <Cpu size={18} color={theme.colors.primary} />
                  <Text role="labelLarge" color="onSurface" style={styles.settingTitle}>
                    System Architecture & Sharding
                  </Text>
                </View>
                <Text role="bodySmall" color="onSurfaceVariant">
                  CRC-32 sharding, pool limits, read-your-own-writes & k6 metrics
                </Text>
              </View>
              <Badge label="DEV" variant="primary" size="small" />
            </View>

            <PrimaryButton
              label="Open System Diagnostics"
              variant="secondary"
              leadingIcon={<Activity size={16} color={theme.colors.primary} />}
              onPress={() => setDiagnosticsModalOpen(true)}
              style={{ width: '100%', marginTop: theme.spacing.small }}
            />
          </Card>

          {/* Tier 9: Production Readiness & Accessibility Card */}
          <Card variant="outlined" style={[styles.settingsCard, { marginTop: theme.spacing.medium }]}>
            <View style={styles.settingRow}>
              <View style={styles.settingTextCol}>
                <View style={styles.labelWithIcon}>
                  <Sparkles size={18} color={theme.colors.primary} />
                  <Text role="labelLarge" color="onSurface" style={styles.settingTitle}>
                    Production Readiness & Polish
                  </Text>
                </View>
                <Text role="bodySmall" color="onSurfaceVariant">
                  WCAG AAA contrast, TalkBack gate, 8-threat security audit & store billing
                </Text>
              </View>
              <Badge label="DEV" variant="primary" size="small" />
            </View>

            <PrimaryButton
              label="Open Production Readiness & Accessibility"
              variant="secondary"
              leadingIcon={<ShieldCheck size={16} color={theme.colors.primary} />}
              onPress={() => setProductionModalOpen(true)}
              style={{ width: '100%', marginTop: theme.spacing.small }}
            />
          </Card>
        </>
      )}
      </View>

      {/* 5. Appearance Theme Switcher */}
      <View style={styles.section}>
        <Text role="labelLarge" color="onSurfaceVariant" style={styles.sectionHeaderTitle}>
          APPEARANCE & THEME
        </Text>
        <Card variant="outlined" style={styles.themeCard}>
          <Text role="bodyMedium" color="onSurfaceVariant">
            Select your preferred display theme:
          </Text>

          <View style={styles.themeOptionsRow}>
            {/* System */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use System theme preference"
              onPress={() => {
                theme.setPreference('system');
                if (isOnline) {
                  updateSettings.mutate({ theme: 'system' });
                }
              }}
              style={[
                styles.themeOptionButton,
                theme.preference === 'system' && styles.themeOptionSelected,
              ]}
            >
              <Smartphone
                size={20}
                color={
                  theme.preference === 'system'
                    ? theme.colors.primary
                    : theme.colors.onSurfaceVariant
                }
              />
              <Text
                role="labelMedium"
                color={theme.preference === 'system' ? 'primary' : 'onSurface'}
                style={styles.themeOptionText}
              >
                System
              </Text>
            </Pressable>

            {/* Light */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use Light theme preference"
              onPress={() => {
                theme.setPreference('light');
                if (isOnline) {
                  updateSettings.mutate({ theme: 'light' });
                }
              }}
              style={[
                styles.themeOptionButton,
                theme.preference === 'light' && styles.themeOptionSelected,
              ]}
            >
              <Sun
                size={20}
                color={
                  theme.preference === 'light'
                    ? theme.colors.primary
                    : theme.colors.onSurfaceVariant
                }
              />
              <Text
                role="labelMedium"
                color={theme.preference === 'light' ? 'primary' : 'onSurface'}
                style={styles.themeOptionText}
              >
                Light
              </Text>
            </Pressable>

            {/* Dark */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use Dark theme preference"
              onPress={() => {
                theme.setPreference('dark');
                if (isOnline) {
                  updateSettings.mutate({ theme: 'dark' });
                }
              }}
              style={[
                styles.themeOptionButton,
                theme.preference === 'dark' && styles.themeOptionSelected,
              ]}
            >
              <Moon
                size={20}
                color={
                  theme.preference === 'dark'
                    ? theme.colors.primary
                    : theme.colors.onSurfaceVariant
                }
              />
              <Text
                role="labelMedium"
                color={theme.preference === 'dark' ? 'primary' : 'onSurface'}
                style={styles.themeOptionText}
              >
                Dark
              </Text>
            </Pressable>
          </View>
        </Card>
      </View>

      {/* 6. Sign Out Section */}
      <View style={styles.signOutSection}>
        <PrimaryButton
          label="Sign Out"
          variant="secondary"
          leadingIcon={<LogOut size={16} color={theme.colors.error} />}
          loading={signOut.isPending}
          onPress={handleSignOut}
          style={styles.signOutButton}
        />
        <Text role="bodySmall" color="onSurfaceVariant" style={styles.versionText}>
          Rota Mobile • MVP v1.1
        </Text>
      </View>

      {/* Invite Member Modal */}
      {teamId ? (
        <InviteMemberModal
          visible={inviteModalOpen}
          onClose={() => setInviteModalOpen(false)}
          teamId={teamId}
        />
      ) : null}

      {/* Billing & Subscription Modal (PRD §6.8, Tier 5) */}
      {teamId ? (
        <BillingModal
          visible={billingModalOpen}
          onClose={() => setBillingModalOpen(false)}
          teamId={teamId}
          teamName={activeTeam?.name ?? 'Team'}
        />
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
      {/* Dev-only modals — excluded from production/preview builds */}
      {__DEV__ && PushNotificationSimulatorModal && (
        <PushNotificationSimulatorModal
          visible={pushModalOpen}
          onClose={() => setPushModalOpen(false)}
          activeTeamId={teamId}
        />
      )}
      {__DEV__ && SystemDiagnosticsModal && (
        <SystemDiagnosticsModal
          visible={diagnosticsModalOpen}
          onClose={() => setDiagnosticsModalOpen(false)}
          teamId={teamId}
          teamName={activeTeam?.name ?? 'Team'}
        />
      )}
      {__DEV__ && ProductionReadinessModal && (
        <ProductionReadinessModal
          visible={productionModalOpen}
          onClose={() => setProductionModalOpen(false)}
        />
      )}
    </ScrollView>
  );
}

const createStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.colors.surface,
    },
    content: {
      padding: t.spacing.base,
      gap: t.spacing.large,
      paddingBottom: t.spacing.extraLarge * 2,
    },
    centerContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: t.colors.surface,
      gap: t.spacing.small,
    },
    loadingText: {
      marginTop: t.spacing.small,
    },
    noTeamCard: {
      padding: t.spacing.base,
      gap: t.spacing.medium,
      backgroundColor: t.colors.surface,
    },
    noTeamHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.medium,
    },
    noTeamIconCircle: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: t.colors.surfaceVariant,
      justifyContent: 'center',
      alignItems: 'center',
    },
    noTeamTextContainer: {
      flex: 1,
      gap: t.spacing.extraSmall / 2,
    },
    noTeamButtonsRow: {
      flexDirection: 'row',
      gap: t.spacing.medium,
      marginTop: t.spacing.small,
    },
    noTeamBtn: {
      flex: 1,
    },
    teamCardFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: t.spacing.medium,
      paddingTop: t.spacing.small,
      borderTopWidth: 1,
      borderTopColor: t.colors.surfaceVariant,
    },
    footerTeamAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
      paddingVertical: t.spacing.extraSmall,
    },
    section: {
      gap: t.spacing.small,
    },
    sectionHeaderTitle: {
      fontWeight: '700',
      letterSpacing: 0.8,
    },
    profileCard: {
      gap: t.spacing.medium,
      padding: t.spacing.base,
    },
    profileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.medium,
    },
    avatarCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: t.colors.primaryContainer,
      justifyContent: 'center',
      alignItems: 'center',
    },
    profileInfo: {
      flex: 1,
      gap: t.spacing.extraSmall / 2,
    },
    profileName: {
      fontWeight: '700',
    },
    profileMetaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: t.spacing.small,
      borderTopWidth: 1,
      borderTopColor: t.colors.surfaceVariant,
    },
    teamSectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    inviteButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
      paddingHorizontal: t.spacing.medium,
      paddingVertical: t.spacing.extraSmall,
      borderRadius: t.radius.control,
      backgroundColor: t.colors.primaryContainer,
    },
    inviteButtonText: {
      fontWeight: '600',
    },
    teamCard: {
      gap: t.spacing.medium,
      padding: t.spacing.base,
    },
    teamCardTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    teamTitle: {
      fontWeight: '700',
    },
    timezoneRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
      marginTop: t.spacing.extraSmall / 2,
    },
    seatsUsageRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: t.spacing.small,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: t.colors.surfaceVariant,
    },
    seatCountBold: {
      fontWeight: '700',
    },
    rosterContainer: {
      gap: t.spacing.small,
    },
    rosterHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
    },
    rosterTitle: {
      fontWeight: '600',
    },
    membersList: {
      gap: t.spacing.small,
    },
    memberRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: t.spacing.small,
      paddingHorizontal: t.spacing.small,
      borderRadius: t.radius.control,
      backgroundColor: t.colors.surfaceContainer,
    },
    memberInfo: {
      flex: 1,
      gap: t.spacing.extraSmall / 2,
    },
    memberName: {
      fontWeight: '600',
    },
    memberRoleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
    },
    settingsCard: {
      gap: t.spacing.medium,
      padding: t.spacing.base,
    },
    billingCardTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    billingInfoLeft: {
      flex: 1,
      gap: t.spacing.extraSmall,
    },
    billingPlanTitle: {
      fontWeight: '700',
    },
    periodRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
      marginTop: t.spacing.small,
    },
    manageBillingBtn: {
      marginTop: t.spacing.medium,
    },
    nonOwnerBillingNote: {
      marginTop: t.spacing.small,
      fontStyle: 'italic',
    },
    settingRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: t.spacing.medium,
    },
    settingTextCol: {
      flex: 1,
      gap: t.spacing.extraSmall / 2,
    },
    labelWithIcon: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
    },
    settingTitle: {
      fontWeight: '600',
    },
    divider: {
      height: 1,
      backgroundColor: t.colors.surfaceVariant,
    },
    quietHoursOptions: {
      gap: t.spacing.small,
      paddingTop: t.spacing.small,
    },
    presetButtonsRow: {
      gap: t.spacing.small,
    },
    presetButton: {
      paddingVertical: t.spacing.small,
      paddingHorizontal: t.spacing.medium,
      borderRadius: t.radius.control,
      borderWidth: 1,
      borderColor: t.colors.surfaceVariant,
      backgroundColor: t.colors.surfaceContainer,
    },
    presetButtonSelected: {
      borderColor: t.colors.primary,
      backgroundColor: t.colors.primaryContainer,
    },
    presetTextSelected: {
      fontWeight: '600',
    },
    quietHoursHint: {
      marginTop: t.spacing.extraSmall / 2,
      fontStyle: 'italic',
    },
    themeCard: {
      gap: t.spacing.medium,
      padding: t.spacing.base,
    },
    themeOptionsRow: {
      flexDirection: 'row',
      gap: t.spacing.small,
    },
    themeOptionButton: {
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
      minHeight: t.touchTarget - 4,
      borderRadius: t.radius.control,
      backgroundColor: t.colors.surfaceContainer,
      borderWidth: 1,
      borderColor: t.colors.surfaceVariant,
    },
    themeOptionSelected: {
      borderColor: t.colors.primary,
      backgroundColor: t.colors.primaryContainer,
    },
    themeOptionText: {
      fontWeight: '600',
    },
    signOutSection: {
      marginTop: t.spacing.medium,
      gap: t.spacing.medium,
      alignItems: 'center',
    },
    signOutButton: {
      width: '100%',
    },
    versionText: {
      ...t.textStyles.bodySmall,
    },
  });
