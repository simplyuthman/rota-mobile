import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Mail, Lock, Sparkles, AlertCircle, ArrowRight } from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../src/theme';
import { InputField } from '../../src/components/InputField';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { useSignIn, useRequestMagicLink } from '../../src/features/auth/useAuth';

export default function SignInScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [mode, setMode] = useState<'password' | 'magic-link'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const signInMutation = useSignIn();
  const magicLinkMutation = useRequestMagicLink();

  const handleSignIn = async () => {
    setErrorMessage(null);
    if (!email.trim()) {
      setErrorMessage('Please enter your email address.');
      return;
    }

    if (mode === 'password') {
      if (!password) {
        setErrorMessage('Please enter your password.');
        return;
      }

      try {
        await signInMutation.mutateAsync({ email: email.trim(), password });
        router.replace('/(tabs)');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Invalid credentials. Please try again.';
        setErrorMessage(message);
      }
    } else {
      try {
        await magicLinkMutation.mutateAsync({ email: email.trim() });
        setMagicLinkSent(true);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to request magic link.';
        setErrorMessage(message);
      }
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
        {/* Header Branding */}
        <View style={styles.header}>
          <Text style={styles.brandTitle}>ROTA</Text>
          <Text style={styles.heading}>Welcome back</Text>
          <Text style={styles.subheading}>
            Sign in to access your team schedules and shifts
          </Text>
        </View>

        {/* Auth Mode Toggle */}
        <View style={styles.toggleContainer} accessibilityRole="tablist">
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === 'password' }}
            style={[styles.toggleTab, mode === 'password' && styles.toggleTabActive]}
            onPress={() => {
              setMode('password');
              setErrorMessage(null);
              setMagicLinkSent(false);
            }}
          >
            <Lock
              size={16}
              color={mode === 'password' ? theme.colors.primary : theme.colors.onSurfaceVariant}
            />
            <Text
              style={[
                styles.toggleTabText,
                mode === 'password' && styles.toggleTabTextActive,
              ]}
            >
              Password
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === 'magic-link' }}
            style={[styles.toggleTab, mode === 'magic-link' && styles.toggleTabActive]}
            onPress={() => {
              setMode('magic-link');
              setErrorMessage(null);
              setMagicLinkSent(false);
            }}
          >
            <Sparkles
              size={16}
              color={mode === 'magic-link' ? theme.colors.primary : theme.colors.onSurfaceVariant}
            />
            <Text
              style={[
                styles.toggleTabText,
                mode === 'magic-link' && styles.toggleTabTextActive,
              ]}
            >
              Magic Link
            </Text>
          </Pressable>
        </View>

        {/* Error Banner */}
        {errorMessage && (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <AlertCircle size={18} color={theme.colors.error} />
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        )}

        {/* Magic Link Sent State */}
        {magicLinkSent ? (
          <View style={styles.successCard}>
            <Sparkles size={32} color={theme.colors.primary} />
            <Text style={styles.successTitle}>Check your email</Text>
            <Text style={styles.successDescription}>
              We sent a temporary sign-in link to{' '}
              <Text style={styles.boldEmail}>{email.trim()}</Text>. Tap the link in your email to sign in immediately.
            </Text>
            <PrimaryButton
              label="Use Password Instead"
              variant="secondary"
              onPress={() => {
                setMagicLinkSent(false);
                setMode('password');
              }}
              style={styles.actionButton}
            />
          </View>
        ) : (
          /* Form Controls */
          <View style={styles.form}>
            <InputField
              label="Email Address"
              placeholder="you@company.com"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
            />

            {mode === 'password' && (
              <InputField
                label="Password"
                placeholder="••••••••••••"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="password"
                value={password}
                onChangeText={setPassword}
              />
            )}

            <PrimaryButton
              label={
                mode === 'password'
                  ? 'Sign In with Password'
                  : 'Send Magic Link'
              }
              onPress={handleSignIn}
              loading={signInMutation.isPending || magicLinkMutation.isPending}
              trailingIcon={
                <ArrowRight size={18} color={theme.colors.onPrimary} />
              }
              style={styles.actionButton}
            />
          </View>
        )}

        {/* Footer Navigation */}
        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Have an invitation code?"
            style={styles.secondaryLink}
            onPress={() => router.push('/(auth)/enter-invite-code' as any)}
          >
            <Text style={styles.secondaryLinkText}>
              Invited by a manager? <Text style={styles.linkHighlight}>Enter Code</Text>
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create a new account"
            style={styles.secondaryLink}
            onPress={() => router.push('/(auth)/sign-up' as any)}
          >
            <Text style={styles.secondaryLinkText}>
              Need a team account? <Text style={styles.linkHighlight}>Sign Up</Text>
            </Text>
          </Pressable>
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
      paddingVertical: t.spacing.extraLarge,
      justifyContent: 'center',
    },
    header: {
      marginBottom: t.spacing.large,
      alignItems: 'center',
      gap: t.spacing.extraSmall,
    },
    brandTitle: {
      ...t.textStyles.labelLarge,
      color: t.colors.primary,
      fontWeight: '700',
      letterSpacing: 2,
    },
    heading: {
      ...t.textStyles.headlineMedium,
      color: t.colors.onSurface,
      fontWeight: '700',
    },
    subheading: {
      ...t.textStyles.bodyMedium,
      color: t.colors.onSurfaceVariant,
      textAlign: 'center',
      paddingHorizontal: t.spacing.medium,
    },
    toggleContainer: {
      flexDirection: 'row',
      backgroundColor: t.colors.surfaceContainer,
      borderRadius: t.radius.control,
      padding: t.spacing.extraSmall,
      marginBottom: t.spacing.medium,
    },
    toggleTab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: t.touchTarget - 8,
      borderRadius: t.radius.control - 2,
      gap: t.spacing.extraSmall,
    },
    toggleTabActive: {
      backgroundColor: t.colors.surface,
    },
    toggleTabText: {
      ...t.textStyles.labelMedium,
      color: t.colors.onSurfaceVariant,
      fontWeight: '500',
    },
    toggleTabTextActive: {
      color: t.colors.primary,
      fontWeight: '600',
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.colors.errorContainer,
      padding: t.spacing.medium,
      borderRadius: t.radius.control,
      gap: t.spacing.small,
      marginBottom: t.spacing.medium,
    },
    errorBannerText: {
      ...t.textStyles.bodySmall,
      color: t.colors.onErrorContainer,
      flex: 1,
    },
    form: {
      gap: t.spacing.medium,
      width: '100%',
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
    footer: {
      marginTop: t.spacing.extraLarge,
      alignItems: 'center',
      gap: t.spacing.medium,
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
