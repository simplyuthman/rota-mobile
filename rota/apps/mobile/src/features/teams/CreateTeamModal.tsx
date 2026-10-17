/**
 * =============================================================================
 * Rota Mobile — CreateTeamModal
 * =============================================================================
 * AGENTS.md §2.2, §3.2 (A-11 trial initialization), §5 (zero raw literals).
 * Allows a registered user to create a team and immediately become its Owner.
 */

import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  Alert,
} from 'react-native';
import { X, Building2, Globe, Sparkles, AlertCircle } from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../theme';
import { Text } from '../../components/Text';
import { InputField } from '../../components/InputField';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Badge } from '../../components/Badge';
import { useCreateTeam } from './useTeam';
import { getErrorMessage } from '../../utils/error';

export interface CreateTeamModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: (teamId: string) => void;
}

const COMMON_TIMEZONES = [
  'Europe/London',
  'America/New_York',
  'Africa/Lagos',
  'America/Los_Angeles',
  'Asia/Dubai',
  'UTC',
];

export function CreateTeamModal({ visible, onClose, onSuccess }: CreateTeamModalProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const defaultTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);

  const [teamName, setTeamName] = useState('');
  const [timezone, setTimezone] = useState(defaultTz);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const createTeamMutation = useCreateTeam();

  const handleCreate = async () => {
    setErrorMessage(null);

    const trimmedName = teamName.trim();
    if (!trimmedName) {
      setErrorMessage('Please enter an organization or team name.');
      return;
    }

    const trimmedTz = timezone.trim();
    if (!trimmedTz) {
      setErrorMessage('Please specify an IANA timezone.');
      return;
    }

    try {
      const newTeam = await createTeamMutation.mutateAsync({
        name: trimmedName,
        timezone: trimmedTz,
      });

      Alert.alert(
        'Team Created',
        `Welcome to ${newTeam.name}! You are registered as the Owner with a 14-day free Starter trial.`
      );
      setTeamName('');
      onClose();
      onSuccess?.(newTeam.id);
    } catch (err: unknown) {
      setErrorMessage(getErrorMessage(err, 'Failed to create team. Please try again.'));
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <Pressable
          style={styles.backdropTouch}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close team creation modal"
        />

        <View style={styles.modalSheet}>
          {/* Header */}
          <View style={styles.sheetHeader}>
            <View style={styles.headerTitleRow}>
              <View style={styles.iconCircle}>
                <Building2 size={20} color={theme.colors.primary} />
              </View>
              <View>
                <Text role="headlineSmall" color="onSurface" style={styles.titleText}>
                  Create Team
                </Text>
                <Text role="bodySmall" color="onSurfaceVariant">
                  Set up your organization & shifts
                </Text>
              </View>
            </View>

            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close modal"
              style={styles.closeButton}
            >
              <X size={20} color={theme.colors.onSurfaceVariant} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.formScroll}
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Starter Plan Banner */}
            <View style={styles.trialBanner}>
              <Sparkles size={18} color={theme.colors.primary} />
              <View style={styles.trialBannerContent}>
                <View style={styles.trialHeaderRow}>
                  <Text role="labelMedium" color="onSurface" style={styles.trialTitle}>
                    14-Day Free Starter Trial
                  </Text>
                  <Badge label="FREE" variant="tertiary" size="small" />
                </View>
                <Text role="bodySmall" color="onSurfaceVariant">
                  Includes up to 5 team seats, published shifts, swap requests, and quiet-hours notifications. No credit card required.
                </Text>
              </View>
            </View>

            {/* Error Banner */}
            {errorMessage && (
              <View style={styles.errorBanner} accessibilityRole="alert">
                <AlertCircle size={18} color={theme.colors.error} />
                <Text role="bodyMedium" color="error" style={styles.errorText}>
                  {errorMessage}
                </Text>
              </View>
            )}

            {/* Team Name */}
            <InputField
              label="Organization or Team Name"
              placeholder="e.g. Bella Bistro, Downtown Branch"
              value={teamName}
              onChangeText={(val) => {
                setTeamName(val);
                setErrorMessage(null);
              }}
              autoCapitalize="words"
              autoFocus
            />

            {/* Timezone */}
            <InputField
              label="Operating Timezone (IANA)"
              placeholder="e.g. Europe/London"
              value={timezone}
              onChangeText={(val) => {
                setTimezone(val);
                setErrorMessage(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              hint="All shifts and quiet hours will be displayed in this timezone"
            />

            {/* Common Timezone Quick Select */}
            <View style={styles.timezoneQuickSection}>
              <View style={styles.tzHeader}>
                <Globe size={14} color={theme.colors.onSurfaceVariant} />
                <Text role="labelSmall" color="onSurfaceVariant">
                  Common Timezones
                </Text>
              </View>
              <View style={styles.tzChipsRow}>
                {COMMON_TIMEZONES.map((tz) => (
                  <Pressable
                    key={tz}
                    onPress={() => setTimezone(tz)}
                    style={[
                      styles.tzChip,
                      timezone === tz && styles.tzChipActive,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Set timezone to ${tz}`}
                  >
                    <Text
                      role="labelSmall"
                      color={timezone === tz ? 'onPrimary' : 'onSurface'}
                    >
                      {tz}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Action Buttons */}
            <View style={styles.actionsRow}>
              <PrimaryButton
                label="Cancel"
                variant="secondary"
                onPress={onClose}
                style={styles.cancelBtn}
              />
              <PrimaryButton
                label="Create Team"
                onPress={handleCreate}
                loading={createTeamMutation.isPending}
                style={styles.submitBtn}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    modalBackdrop: {
      flex: 1,
      backgroundColor: t.colors.inverseSurface,
      opacity: 0.95,
      justifyContent: 'flex-end',
    },
    backdropTouch: {
      flex: 1,
    },
    modalSheet: {
      backgroundColor: t.colors.surface,
      borderTopLeftRadius: t.radius.modal,
      borderTopRightRadius: t.radius.modal,
      maxHeight: '90%',
      paddingBottom: t.spacing.extraLarge,
      ...t.shadows.medium,
    },
    sheetHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: t.spacing.large,
      paddingTop: t.spacing.large,
      paddingBottom: t.spacing.medium,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.surfaceVariant,
    },
    headerTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.medium,
    },
    iconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: t.colors.surfaceVariant,
      justifyContent: 'center',
      alignItems: 'center',
    },
    titleText: {
      fontWeight: '700',
    },
    closeButton: {
      width: t.touchTarget,
      height: t.touchTarget,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: t.radius.control,
    },
    formScroll: {
      maxHeight: 520,
    },
    formContent: {
      paddingHorizontal: t.spacing.large,
      paddingVertical: t.spacing.medium,
      gap: t.spacing.medium,
    },
    trialBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: t.spacing.small,
      backgroundColor: t.colors.surfaceVariant,
      padding: t.spacing.medium,
      borderRadius: t.radius.card,
    },
    trialBannerContent: {
      flex: 1,
      gap: t.spacing.extraSmall,
    },
    trialHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    trialTitle: {
      fontWeight: '700',
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
      backgroundColor: t.colors.surfaceVariant,
      padding: t.spacing.medium,
      borderRadius: t.radius.control,
    },
    errorText: {
      flex: 1,
    },
    timezoneQuickSection: {
      gap: t.spacing.small,
    },
    tzHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
    },
    tzChipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: t.spacing.small,
    },
    tzChip: {
      paddingHorizontal: t.spacing.medium,
      paddingVertical: t.spacing.small,
      borderRadius: t.radius.controlSmall,
      borderWidth: 1,
      borderColor: t.colors.surfaceVariant,
      backgroundColor: t.colors.surface,
      minHeight: 36,
      justifyContent: 'center',
      alignItems: 'center',
    },
    tzChipActive: {
      backgroundColor: t.colors.primary,
      borderColor: t.colors.primary,
    },
    actionsRow: {
      flexDirection: 'row',
      gap: t.spacing.medium,
      marginTop: t.spacing.small,
    },
    cancelBtn: {
      flex: 1,
    },
    submitBtn: {
      flex: 2,
    },
  });
