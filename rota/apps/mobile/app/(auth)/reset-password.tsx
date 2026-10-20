/**
 * =============================================================================
 * Rota Mobile — Reset Password Screen
 * =============================================================================
 * Validates the reset token and allows the user to set a new password.
 * Revokes all existing user sessions upon completion.
 * =============================================================================
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../src/theme';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { InputField } from '../../src/components/InputField';
import { useConfirmPasswordReset } from '../../src/features/auth/useAuth';
import { getErrorMessage } from '../../src/utils/error';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [token, setToken] = useState(params.token || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const confirmResetMutation = useConfirmPasswordReset();

  const handleResetPassword = async () => {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setErrorMessage('Please enter or paste your reset token.');
      return;
    }

    if (!newPassword) {
      setErrorMessage('Please enter a new password.');
      return;
    }

    if (newPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please re-enter.');
      return;
    }

    setErrorMessage(null);

    try {
      await confirmResetMutation.mutateAsync({
        token: trimmedToken,
        newPassword,
      });
      setIsSuccess(true);
    } catch (err: unknown) {
      setErrorMessage(getErrorMessage(err, 'Failed to reset password. The link or token may have expired.'));
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.keyboardContainer}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Top Back Navigation */}
        <View style={styles.topNavRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to sign in"
            style={styles.backButton}
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace('/(auth)/sign-in' as never)
            }
          >
            <ArrowLeft size={20} color={theme.colors.onSurface} />
          </Pressable>
        </View>

        <View style={styles.centerContainer}>
          {/* Header Branding */}
          <View style={styles.header}>
            <Text style={styles.brandTitle}>ROTA</Text>
            <Text style={styles.heading}>Create new password</Text>
            <Text style={styles.subheading}>
              Choose a strong password with at least 8 characters
            </Text>
          </View>

          {/* Success State */}
          {isSuccess ? (
            <View style={styles.successCard}>
              <View style={styles.successIconCircle}>
                <CheckCircle2 size={36} color={theme.colors.primary} />
              </View>
              <Text style={styles.successTitle}>Password updated</Text>
              <Text style={styles.successDescription}>
                Your password has been reset successfully. All existing sessions have been secured.
                You can now sign in with your new password.
              </Text>

              <PrimaryButton
                label="Sign In Now"
                onPress={() => router.replace('/(auth)/sign-in' as never)}
                style={styles.actionButton}
              />
            </View>
          ) : (
            /* Form State */
            <View style={styles.form}>
              {errorMessage ? (
                <View style={styles.errorBanner} accessibilityRole="alert">
                  <AlertCircle size={18} color={theme.colors.error} />
                  <Text style={styles.errorBannerText}>{errorMessage}</Text>
                </View>
              ) : null}

              {/* Token Input or Token Pre-filled Indicator */}
              {params.token ? (
                <View style={styles.tokenVerifiedBadge}>
                  <ShieldCheck size={18} color={theme.colors.primary} />
                  <Text style={styles.tokenVerifiedText}>Reset token attached from link</Text>
                </View>
              ) : (
                <InputField
                  label="Reset Token"
                  placeholder="Paste your reset token"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={token}
                  onChangeText={(text) => {
                    setToken(text);
                    if (errorMessage) setErrorMessage(null);
                  }}
                />
              )}

              <InputField
                label="New Password"
                placeholder="Minimum 8 characters"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                value={newPassword}
                onChangeText={(text) => {
                  setNewPassword(text);
                  if (errorMessage) setErrorMessage(null);
                }}
              />

              <InputField
                label="Confirm New Password"
                placeholder="Re-enter password"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                value={confirmPassword}
                onChangeText={(text) => {
                  setConfirmPassword(text);
                  if (errorMessage) setErrorMessage(null);
                }}
              />

              <PrimaryButton
                label="Update Password"
                onPress={handleResetPassword}
                loading={confirmResetMutation.isPending}
                trailingIcon={<ArrowRight size={18} color={theme.colors.onPrimary} />}
                style={styles.actionButton}
              />

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to sign in"
                style={styles.signInLink}
                onPress={() => router.replace('/(auth)/sign-in' as never)}
              >
                <Text style={styles.secondaryLinkText}>
                  Cancel and return to <Text style={styles.linkHighlight}>Sign In</Text>
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    keyboardContainer: {
      flex: 1,
      backgroundColor: t.colors.surface,
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: t.spacing.large,
      paddingTop: Platform.OS === 'android' ? t.spacing.extraLarge : t.spacing.large,
      paddingBottom: t.spacing.extraLarge,
    },
    topNavRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: t.spacing.medium,
    },
    centerContainer: {
      flex: 1,
      justifyContent: 'center',
      width: '100%',
      paddingBottom: t.spacing.large,
    },
    backButton: {
      width: t.touchTarget,
      height: t.touchTarget,
      borderRadius: t.radius.control,
      backgroundColor: t.colors.surfaceContainer,
      justifyContent: 'center',
      alignItems: 'center',
    },
    header: {
      marginBottom: t.spacing.large,
    },
    brandTitle: {
      ...t.textStyles.labelSmall,
      color: t.colors.primary,
      fontWeight: '700',
      letterSpacing: 2,
      marginBottom: t.spacing.extraSmall,
    },
    heading: {
      ...t.textStyles.headlineMedium,
      color: t.colors.onSurface,
      fontWeight: '700',
      marginBottom: t.spacing.extraSmall,
    },
    subheading: {
      ...t.textStyles.bodyMedium,
      color: t.colors.onSurfaceVariant,
      lineHeight: 22,
    },
    form: {
      gap: t.spacing.medium,
      width: '100%',
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.colors.errorContainer,
      padding: t.spacing.medium,
      borderRadius: t.radius.control,
      gap: t.spacing.small,
      marginBottom: t.spacing.extraSmall,
    },
    errorBannerText: {
      ...t.textStyles.bodySmall,
      color: t.colors.onErrorContainer,
      flex: 1,
    },
    tokenVerifiedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.colors.primaryContainer,
      padding: t.spacing.medium,
      borderRadius: t.radius.control,
      gap: t.spacing.small,
    },
    tokenVerifiedText: {
      ...t.textStyles.labelMedium,
      color: t.colors.onPrimaryContainer,
      fontWeight: '600',
    },
    actionButton: {
      marginTop: t.spacing.small,
      width: '100%',
    },
    successCard: {
      backgroundColor: t.colors.surfaceContainer,
      borderRadius: t.radius.card,
      padding: t.spacing.extraLarge,
      alignItems: 'center',
      gap: t.spacing.medium,
      marginVertical: t.spacing.medium,
    },
    successIconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: t.colors.primaryContainer,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: t.spacing.extraSmall,
    },
    successTitle: {
      ...t.textStyles.headlineSmall,
      color: t.colors.onSurface,
      fontWeight: '700',
    },
    successDescription: {
      ...t.textStyles.bodyMedium,
      color: t.colors.onSurfaceVariant,
      textAlign: 'center',
      lineHeight: 22,
    },
    signInLink: {
      minHeight: t.touchTarget,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: t.spacing.medium,
      marginTop: -t.spacing.small,
    },
    secondaryLink: {
      minHeight: t.touchTarget,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: t.spacing.medium,
    },
    secondaryLinkText: {
      ...t.textStyles.bodyMedium,
      color: t.colors.onSurfaceVariant,
    },
    linkHighlight: {
      color: t.colors.primary,
      fontWeight: '600',
    },
  });
