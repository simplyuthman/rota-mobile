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
import { AlertCircle, ArrowRight } from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../src/theme';
import { InputField } from '../../src/components/InputField';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { useSignUp } from '../../src/features/auth/useAuth';

export default function SignUpScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const signUpMutation = useSignUp();

  const handleSignUp = async () => {
    setErrorMessage(null);

    if (!name.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }
    if (!email.trim()) {
      setErrorMessage('Please enter your email address.');
      return;
    }
    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    try {
      await signUpMutation.mutateAsync({
        displayName: name.trim(),
        email: email.trim(),
        password,
      });
      router.replace('/(tabs)' as never);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setErrorMessage(message);
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
        <View style={styles.header}>
          <Text style={styles.brandTitle}>ROTA</Text>
          <Text style={styles.heading}>Create your account</Text>
          <Text style={styles.subheading}>
            Set up your organization and schedule team shifts with ease
          </Text>
        </View>

        {errorMessage && (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <AlertCircle size={18} color={theme.colors.error} />
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        )}

        <View style={styles.form}>
          <InputField
            label="Full Name"
            placeholder="Sarah Jenkins"
            autoCapitalize="words"
            autoComplete="name"
            value={name}
            onChangeText={setName}
          />

          <InputField
            label="Work Email"
            placeholder="sarah@bistro.com"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
          />

          <InputField
            label="Password"
            placeholder="At least 8 characters"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            hint="Must be at least 8 characters with letters and numbers"
            value={password}
            onChangeText={setPassword}
          />

          <PrimaryButton
            label="Create Account"
            onPress={handleSignUp}
            loading={signUpMutation.isPending}
            trailingIcon={<ArrowRight size={18} color={theme.colors.onPrimary} />}
            style={styles.actionButton}
          />
        </View>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Already have an account? Sign in"
            style={styles.secondaryLink}
            onPress={() => router.back()}
          >
            <Text style={styles.secondaryLinkText}>
              Already have an account? <Text style={styles.linkHighlight}>Sign In</Text>
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
    footer: {
      marginTop: t.spacing.extraLarge,
      alignItems: 'center',
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
