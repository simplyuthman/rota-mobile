/**
 * =============================================================================
 * Rota Mobile — InviteMemberModal
 * =============================================================================
 * AGENTS.md §3.2 (A-05: Only Owner invites, S-06: Token format {teamId}.{random})
 * & rota-themed-component skill.
 */

import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  ScrollView,
  StyleSheet,
  Pressable,
} from 'react-native';
import { X, UserPlus, Shield, CheckCircle, AlertCircle } from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../theme';
import { Text } from '../../components/Text';
import { InputField } from '../../components/InputField';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { useCreateInvitation } from './useTeam';
import { getErrorMessage } from '../../utils/error';
import type { InvitationDto } from '@rota/contracts';

export interface InviteMemberModalProps {
  visible: boolean;
  onClose: () => void;
  teamId: string;
}

export function InviteMemberModal({ visible, onClose, teamId }: InviteMemberModalProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const createInvitation = useCreateInvitation(teamId);

  const [role, setRole] = useState<'staff' | 'manager'>('staff');
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<InvitationDto | null>(null);

  const handleCreate = async () => {
    setErrorMessage(null);

    try {
      const invite = await createInvitation.mutateAsync({
        intendedRole: role,
        email: email.trim() || undefined,
      });
      setCreatedInvite(invite);
    } catch (err: unknown) {
      setErrorMessage(getErrorMessage(err, 'Failed to generate invitation.'));
    }
  };

  const handleClose = () => {
    setCreatedInvite(null);
    setEmail('');
    setRole('staff');
    setErrorMessage(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss modal backdrop"
        />
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <UserPlus size={20} color={theme.colors.primary} />
              <View>
                <Text role="headlineSmall" color="onSurface" style={styles.headerTitle}>
                  Invite Member
                </Text>
                <Text role="bodySmall" color="onSurfaceVariant">
                  Add staff or managers to your team
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close invite modal"
              onPress={handleClose}
              style={styles.closeButton}
            >
              <X size={20} color={theme.colors.onSurface} />
            </Pressable>
          </View>

          <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
            {createdInvite ? (
              /* Success View showing invite token */
              <View style={styles.successContainer}>
                <View style={styles.successIconCircle}>
                  <CheckCircle size={36} color={theme.colors.secondary} />
                </View>
                <Text role="headlineSmall" color="onSurface" style={styles.successTitle}>
                  Invitation Generated!
                </Text>
                <Text role="bodyMedium" color="onSurfaceVariant" style={styles.successSubtitle}>
                  Share this invitation code with your colleague to let them join:
                </Text>

                <Card variant="flat" style={styles.codeCard}>
                  <Text role="labelSmall" color="onSurfaceVariant">
                    INVITATION CODE
                  </Text>
                  <Text
                    role="headlineMedium"
                    color="primary"
                    selectable
                    style={styles.codeText}
                  >
                    {createdInvite.token}
                  </Text>
                  <Badge
                    label={`Role: ${createdInvite.intendedRole.toUpperCase()}`}
                    variant="primary"
                    size="small"
                  />
                </Card>

                <Text role="bodySmall" color="onSurfaceVariant" style={styles.expiryNote}>
                  Expires in 7 days. Once accepted, it consumes 1 purchased seat (Rule A-06).
                </Text>

                <PrimaryButton
                  label="Done"
                  onPress={handleClose}
                  style={styles.doneButton}
                />
              </View>
            ) : (
              /* Creation Form */
              <>
                {errorMessage ? (
                  <View style={styles.errorBanner} accessibilityRole="alert">
                    <AlertCircle size={18} color={theme.colors.error} />
                    <Text role="bodySmall" color="onErrorContainer" style={styles.errorBannerText}>
                      {errorMessage}
                    </Text>
                  </View>
                ) : null}

                {/* Role Picker */}
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Shield size={16} color={theme.colors.primary} />
                    <Text role="labelMedium" color="onSurface" style={styles.sectionTitle}>
                      Intended Role *
                    </Text>
                  </View>
                  <View style={styles.roleRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Select Staff role"
                      onPress={() => setRole('staff')}
                      style={[
                        styles.roleCard,
                        role === 'staff' && styles.roleCardSelected,
                      ]}
                    >
                      <Text
                        role="labelLarge"
                        color={role === 'staff' ? 'primary' : 'onSurface'}
                        style={styles.roleCardTitle}
                      >
                        Staff
                      </Text>
                      <Text role="bodySmall" color="onSurfaceVariant">
                        Views published shifts, requests swaps
                      </Text>
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Select Manager role"
                      onPress={() => setRole('manager')}
                      style={[
                        styles.roleCard,
                        role === 'manager' && styles.roleCardSelected,
                      ]}
                    >
                      <Text
                        role="labelLarge"
                        color={role === 'manager' ? 'primary' : 'onSurface'}
                        style={styles.roleCardTitle}
                      >
                        Manager
                      </Text>
                      <Text role="bodySmall" color="onSurfaceVariant">
                        Publishes shifts, manages assignments, approves swaps
                      </Text>
                    </Pressable>
                  </View>
                </View>

                {/* Optional Email */}
                <InputField
                  label="Colleague Email (Optional)"
                  placeholder="e.g. staff@example.com"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  hint="If set, only an account with this verified email can accept."
                />

                <PrimaryButton
                  label="Generate Invite Code"
                  loading={createInvitation.isPending}
                  onPress={handleCreate}
                  style={styles.generateButton}
                />
              </>
            )}
          </ScrollView>
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
      maxHeight: '85%',
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
    roleRow: {
      gap: t.spacing.small,
    },
    roleCard: {
      padding: t.spacing.medium,
      borderRadius: t.radius.control,
      backgroundColor: t.colors.surfaceContainer,
      borderWidth: 1,
      borderColor: t.colors.surfaceVariant,
      gap: 2,
    },
    roleCardSelected: {
      borderColor: t.colors.primary,
      backgroundColor: t.colors.primaryContainer,
    },
    roleCardTitle: {
      fontWeight: '700',
    },
    generateButton: {
      marginTop: t.spacing.small,
    },
    successContainer: {
      alignItems: 'center',
      gap: t.spacing.medium,
      paddingVertical: t.spacing.medium,
    },
    successIconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: t.colors.surfaceContainer,
      justifyContent: 'center',
      alignItems: 'center',
    },
    successTitle: {
      fontWeight: '700',
      textAlign: 'center',
    },
    successSubtitle: {
      textAlign: 'center',
      paddingHorizontal: t.spacing.medium,
    },
    codeCard: {
      width: '100%',
      alignItems: 'center',
      backgroundColor: t.colors.surfaceContainer,
      padding: t.spacing.large,
      gap: t.spacing.small,
    },
    codeText: {
      fontWeight: '700',
      letterSpacing: 1,
      textAlign: 'center',
    },
    expiryNote: {
      textAlign: 'center',
      fontSize: 12,
    },
    doneButton: {
      width: '100%',
      marginTop: t.spacing.small,
    },
  });
