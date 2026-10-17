/**
 * =============================================================================
 * Rota Mobile — RequestSwapModal
 * =============================================================================
 * AGENTS.md §3.2 (A-10: Direct colleague handoff, colleague accepts -> manager approves)
 * & rota-themed-component skill (accessible touch targets, design tokens only).
 */

import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  ScrollView,
  StyleSheet,
  Pressable,
} from 'react-native';
import { X, ArrowRightLeft, User, AlertCircle, Info } from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../theme';
import { Text } from '../../components/Text';
import { InputField } from '../../components/InputField';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Card } from '../../components/Card';
import { useCreateSwap } from './useSwaps';
import { useTeamMembers } from '../teams/useTeam';
import { getErrorCode, getErrorMessage } from '../../utils/error';
import type { ShiftDto, ShiftPublicDto } from '@rota/contracts';

export interface RequestSwapModalProps {
  visible: boolean;
  onClose: () => void;
  teamId: string;
  shift: ShiftDto | ShiftPublicDto | null;
  currentUserId: string;
}

export function RequestSwapModal({
  visible,
  onClose,
  teamId,
  shift,
  currentUserId,
}: RequestSwapModalProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const createSwap = useCreateSwap(teamId);
  const { data: members = [] } = useTeamMembers(teamId);

  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Eligible colleagues: active members excluding the current user
  const eligibleColleagues = useMemo(() => {
    return members.filter((m) => m.userId !== currentUserId && m.status === 'active');
  }, [members, currentUserId]);

  const handleSubmit = async () => {
    if (!shift) return;
    if (!selectedTargetId) {
      setErrorMessage('Please select a colleague to offer this shift to.');
      return;
    }

    setErrorMessage(null);

    try {
      await createSwap.mutateAsync({
        shiftId: shift.id,
        payload: {
          targetMembershipId: selectedTargetId,
          message: message.trim() || undefined,
        },
      });

      setSelectedTargetId(null);
      setMessage('');
      onClose();
    } catch (err: unknown) {
      const code = getErrorCode(err);
      if (code === 'CONFLICT' || code === 'INVALID_SWAP') {
        setErrorMessage('A swap request is already pending for this shift (Rule A-10).');
      } else {
        setErrorMessage(getErrorMessage(err, 'Failed to submit swap request.'));
      }
    }
  };

  if (!shift) return null;

  const starts = new Date(shift.startsAt);
  const ends = new Date(shift.endsAt);
  const dateFormatted = starts.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timeFormatted = `${starts.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })} – ${ends.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss modal backdrop"
        />
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <ArrowRightLeft size={20} color={theme.colors.primary} />
              <View>
                <Text role="headlineSmall" color="onSurface" style={styles.headerTitle}>
                  Request Shift Swap
                </Text>
                <Text role="bodySmall" color="onSurfaceVariant">
                  Direct handoff to a colleague (Rule A-10)
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close request swap modal"
              onPress={onClose}
              style={styles.closeButton}
            >
              <X size={20} color={theme.colors.onSurface} />
            </Pressable>
          </View>

          <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
            {errorMessage ? (
              <View style={styles.errorBanner} accessibilityRole="alert">
                <AlertCircle size={18} color={theme.colors.error} />
                <Text role="bodySmall" color="onErrorContainer" style={styles.errorBannerText}>
                  {errorMessage}
                </Text>
              </View>
            ) : null}

            {/* Shift Summary Card */}
            <Card variant="flat" style={styles.shiftCard}>
              <Text role="labelLarge" color="primary" style={styles.shiftTitle}>
                {shift.title}
              </Text>
              <Text role="bodyMedium" color="onSurface">
                {dateFormatted}
              </Text>
              <Text role="bodySmall" color="onSurfaceVariant">
                {timeFormatted}
                {shift.locationLabel ? ` • ${shift.locationLabel}` : ''}
              </Text>
            </Card>

            {/* Colleague Picker */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <User size={16} color={theme.colors.primary} />
                <Text role="labelMedium" color="onSurface" style={styles.sectionTitle}>
                  Select Colleague *
                </Text>
              </View>
              {eligibleColleagues.length === 0 ? (
                <Text role="bodySmall" color="onSurfaceVariant">
                  No other active team members available for swaps.
                </Text>
              ) : (
                <View style={styles.colleaguesList}>
                  {eligibleColleagues.map((colleague) => {
                    const isSelected = selectedTargetId === colleague.id;
                    const name =
                      colleague.displayName || colleague.email || `Member ${colleague.id.slice(0, 6)}`;
                    return (
                      <Pressable
                        key={colleague.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Select colleague ${name}`}
                        onPress={() => setSelectedTargetId(colleague.id)}
                        style={[
                          styles.colleagueCard,
                          isSelected && styles.colleagueCardSelected,
                        ]}
                      >
                        <View style={styles.colleagueInfo}>
                          <Text
                            role="bodyMedium"
                            color={isSelected ? 'primary' : 'onSurface'}
                            style={styles.colleagueName}
                          >
                            {name}
                          </Text>
                          <Text role="bodySmall" color="onSurfaceVariant">
                            Role: {colleague.role}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.radioCircle,
                            isSelected && styles.radioCircleSelected,
                          ]}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Message input */}
            <InputField
              label="Note for Colleague (Optional)"
              placeholder="e.g. Can you take this shift? I can trade for next Friday."
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={3}
            />

            {/* Informational Rule Notice */}
            <View style={styles.infoBanner}>
              <Info size={16} color={theme.colors.onSurfaceVariant} />
              <Text role="bodySmall" color="onSurfaceVariant" style={styles.infoText}>
                Your colleague must accept first. Once accepted, a manager will review and confirm
                the swap before assignments update.
              </Text>
            </View>
          </ScrollView>

          {/* Footer actions */}
          <View style={styles.footer}>
            <PrimaryButton
              label="Cancel"
              variant="secondary"
              onPress={onClose}
              style={styles.footerButton}
            />
            <PrimaryButton
              label="Send Request"
              loading={createSwap.isPending}
              disabled={!selectedTargetId}
              onPress={handleSubmit}
              style={styles.footerButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: t.colors.inverseSurface,
      opacity: 0.5,
    },
    modalContent: {
      backgroundColor: t.colors.surface,
      borderTopLeftRadius: t.radius.card,
      borderTopRightRadius: t.radius.card,
      maxHeight: '88%',
      paddingTop: t.spacing.base,
      paddingHorizontal: t.spacing.base,
      paddingBottom: t.spacing.large,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: t.spacing.medium,
      paddingBottom: t.spacing.small,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.surfaceVariant,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
    },
    headerTitle: {
      fontWeight: '700',
    },
    closeButton: {
      width: t.touchTarget - 8,
      height: t.touchTarget - 8,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: (t.touchTarget - 8) / 2,
      backgroundColor: t.colors.surfaceContainer,
    },
    scrollArea: {
      maxHeight: 460,
    },
    scrollContent: {
      gap: t.spacing.medium,
      paddingBottom: t.spacing.base,
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
      backgroundColor: t.colors.errorContainer,
      padding: t.spacing.medium,
      borderRadius: t.radius.control,
    },
    errorBannerText: {
      flex: 1,
    },
    shiftCard: {
      backgroundColor: t.colors.surfaceContainer,
      padding: t.spacing.medium,
      gap: t.spacing.extraSmall / 2,
    },
    shiftTitle: {
      fontWeight: '700',
    },
    section: {
      gap: t.spacing.small,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
    },
    sectionTitle: {
      fontWeight: '600',
    },
    colleaguesList: {
      gap: t.spacing.small,
    },
    colleagueCard: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: t.spacing.medium,
      borderRadius: t.radius.control,
      backgroundColor: t.colors.surfaceContainer,
      borderWidth: 1,
      borderColor: t.colors.surfaceVariant,
      minHeight: t.touchTarget,
    },
    colleagueCardSelected: {
      borderColor: t.colors.primary,
      backgroundColor: t.colors.primaryContainer,
    },
    colleagueInfo: {
      gap: t.spacing.extraSmall / 2,
    },
    colleagueName: {
      fontWeight: '600',
    },
    radioCircle: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: t.colors.onSurfaceVariant,
    },
    radioCircleSelected: {
      borderColor: t.colors.primary,
      backgroundColor: t.colors.primary,
    },
    infoBanner: {
      flexDirection: 'row',
      gap: t.spacing.small,
      backgroundColor: t.colors.surfaceContainer,
      padding: t.spacing.medium,
      borderRadius: t.radius.control,
    },
    infoText: {
      flex: 1,
      ...t.textStyles.bodySmall,
    },
    footer: {
      flexDirection: 'row',
      gap: t.spacing.medium,
      marginTop: t.spacing.medium,
      paddingTop: t.spacing.small,
      borderTopWidth: 1,
      borderTopColor: t.colors.surfaceVariant,
    },
    footerButton: {
      flex: 1,
    },
  });
