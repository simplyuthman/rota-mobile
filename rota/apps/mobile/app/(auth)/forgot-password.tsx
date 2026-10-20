/**
 * =============================================================================
 * Rota Mobile — Forgot Password Screen
 * =============================================================================
 * Initiates the password reset flow. Responds identically whether or not an
 * email exists to prevent user enumeration.
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
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../src/theme';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { InputField } from '../../src/components/InputField';
import { useRequestPasswordReset } from '../../src/features/auth/useAuth';
import { getErrorMessage } from '../../src/utils/error';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const requestResetMutation = useRequestPasswordReset();

  const handleSendReset = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setErrorMessage('Please enter your email address.');
      return;
    }

    if (!trimmed.includes('@') || !trimmed.includes('.')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setErrorMessage(null);

    try {
      await requestResetMutation.mutateAsync({ email: trimmed });
      setIsSuccess(true);
    } catch (err: unknown) {
      setErrorMessage(getErrorMessage(err, 'Failed to send reset link. Please try again.'));
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
            <Text style={styles.heading}>Reset password</Text>
            <Text style={styles.subheading}>
              Enter your account email to receive a password reset link
            </Text>
          </View>

          {/* Success State */}
          {isSuccess ? (
            <View style={styles.successCard}>
              <View style={styles.successIconCircle}>
                <CheckCircle2 size={36} color={theme.colors.primary} />
              </View>
              <Text style={styles.successTitle}>Check your inbox</Text>
              <Text style={styles.successDescription}>
                If an account is registered with{' '}
                <Text style={styles.boldEmail}>{email.trim()}</Text>, we have sent a password
                reset link. The link expires in 15 minutes.
              </Text>

              <PrimaryButton
                label="Back to Sign In"
                onPress={() => router.replace('/(auth)/sign-in' as never)}
                style={styles.actionButton}
              />

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Enter token manually"
                style={styles.secondaryLink}
                onPress={() => router.push('/(auth)/reset-password' as never)}
              >
                <Text style={styles.secondaryLinkText}>
                  Have a reset token? <Text style={styles.linkHighlight}>Enter token</Text>
                </Text>
              </Pressable>
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

              <InputField
                label="Email address"
                placeholder="name@company.com"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (errorMessage) setErrorMessage(null);
                }}
              />

              <PrimaryButton
                label="Send Reset Link"
                onPress={handleSendReset}
                loading={requestResetMutation.isPending}
                trailingIcon={<ArrowRight size={18} color={theme.colors.onPrimary} />}
                style={styles.actionButton}
              />

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remember your password? Sign in"
                style={styles.signInLink}
                onPress={() => router.replace('/(auth)/sign-in' as never)}
              >
                <Text style={styles.secondaryLinkText}>
                  Remember your password? <Text style={styles.linkHighlight}>Sign In</Text>
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
    boldEmail: {
      color: t.colors.onSurface,
      fontWeight: '600',
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
