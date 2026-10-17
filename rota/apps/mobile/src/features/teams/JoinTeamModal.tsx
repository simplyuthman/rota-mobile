/**
 * =============================================================================
 * Rota Mobile — JoinTeamModal
 * =============================================================================
 * AGENTS.md §3.2 (A-06), §3.3 (S-06, S-07), §5 (zero raw literals).
 * Allows a user to paste an invitation code ({teamId}.{random}), preview team
 * details, and accept membership.
 */

import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { X, ShieldCheck, KeyRound, AlertCircle } from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../theme';
import { Text } from '../../components/Text';
import { InputField } from '../../components/InputField';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { useInviteDetails, useAcceptInvitation } from '../auth/useAuth';
import { getErrorMessage } from '../../utils/error';

export interface JoinTeamModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function JoinTeamModal({ visible, onClose, onSuccess }: JoinTeamModalProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [inviteToken, setInviteToken] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmedToken = inviteToken.trim();
  const { data: inviteData, isLoading: isLoadingInvite, error: inviteQueryError } =
    useInviteDetails(trimmedToken);

  const acceptMutation = useAcceptInvitation();

  const handleAccept = async () => {
    setErrorMessage(null);
    if (!trimmedToken) {
      setErrorMessage('Please enter your invitation code.');
      return;
    }

    try {
      await acceptMutation.mutateAsync({ token: trimmedToken });
      Alert.alert(
        'Welcome!',
        `You have successfully joined ${inviteData?.teamName || 'the team'}.`
      );
      setInviteToken('');
      onClose();
      onSuccess?.();
    } catch (err: unknown) {
      setErrorMessage(getErrorMessage(err, 'Failed to join team. The code may be expired or already used.'));
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
          accessibilityLabel="Close join team modal"
        />

        <View style={styles.modalSheet}>
          {/* Header */}
          <View style={styles.sheetHeader}>
            <View style={styles.headerTitleRow}>
              <View style={styles.iconCircle}>
                <KeyRound size={20} color={theme.colors.primary} />
              </View>
              <View>
                <Text role="headlineSmall" color="onSurface" style={styles.titleText}>
                  Join with Code
                </Text>
                <Text role="bodySmall" color="onSurfaceVariant">
                  Enter invite code from your team
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
            {/* Error Banner */}
            {(errorMessage || inviteQueryError) && (
              <View style={styles.errorBanner} accessibilityRole="alert">
                <AlertCircle size={18} color={theme.colors.error} />
                <Text role="bodyMedium" color="error" style={styles.errorText}>
                  {errorMessage || inviteQueryError?.message || 'Invalid or expired invitation code.'}
                </Text>
              </View>
            )}

            {/* Input */}
            <InputField
              label="Invitation Code"
              placeholder="e.g. 550e8400...abc123"
              value={inviteToken}
              onChangeText={(val) => {
                setInviteToken(val);
                setErrorMessage(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              hint="Format: {teamId}.{randomToken}"
            />

            {/* Preview Loading */}
            {isLoadingInvite && (
              <View style={styles.loadingCard}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text role="bodySmall" color="onSurfaceVariant">
                  Verifying invitation details...
                </Text>
              </View>
            )}

            {/* Invitation Preview Card */}
            {inviteData && (
              <Card variant="outlined" style={styles.previewCard}>
                <View style={styles.previewHeader}>
                  <ShieldCheck size={20} color={theme.colors.primary} />
                  <Text role="labelLarge" color="onSurface" style={styles.previewTitle}>
                    Valid Invitation Found
                  </Text>
                </View>

                <View style={styles.previewRow}>
                  <Text role="bodySmall" color="onSurfaceVariant">
                    Team:
                  </Text>
                  <Text role="bodyMedium" color="onSurface" style={styles.previewBold}>
                    {inviteData.teamName}
                  </Text>
                </View>

                <View style={styles.previewRow}>
                  <Text role="bodySmall" color="onSurfaceVariant">
                    Role Assigned:
                  </Text>
                  <Badge
                    label={inviteData.role.toUpperCase()}
                    variant={inviteData.role === 'manager' ? 'primary' : 'neutral'}
                    size="small"
                  />
                </View>

                {inviteData.email ? (
                  <View style={styles.previewRow}>
                    <Text role="bodySmall" color="onSurfaceVariant">
                      Bound to:
                    </Text>
                    <Text role="bodySmall" color="onSurface">
                      {inviteData.email}
                    </Text>
                  </View>
                ) : null}
              </Card>
            )}

            {/* Action Buttons */}
            <View style={styles.actionsRow}>
              <PrimaryButton
                label="Cancel"
                variant="secondary"
                onPress={onClose}
                style={styles.cancelBtn}
              />
              <PrimaryButton
                label="Join Team"
                onPress={handleAccept}
                loading={acceptMutation.isPending}
                disabled={!trimmedToken}
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
    loadingCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
      padding: t.spacing.medium,
      justifyContent: 'center',
    },
    previewCard: {
      padding: t.spacing.medium,
      gap: t.spacing.small,
    },
    previewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
      marginBottom: t.spacing.extraSmall,
    },
    previewTitle: {
      fontWeight: '700',
    },
    previewRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    previewBold: {
      fontWeight: '600',
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
