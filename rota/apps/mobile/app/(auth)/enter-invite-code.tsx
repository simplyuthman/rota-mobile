import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { AlertCircle, ArrowRight, ShieldCheck, ArrowLeft } from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../src/theme';
import { InputField } from '../../src/components/InputField';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { useInviteDetails, useAcceptInvitation } from '../../src/features/auth/useAuth';

export default function EnterInviteCodeScreen() {
  const router = useRouter();
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
      router.replace('/(tabs)' as never);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to join team. The invitation may be expired or already used.';
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
        {/* Top Back Navigation */}
        <View style={styles.topNavRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to welcome"
            style={styles.backButton}
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace('/(auth)/welcome' as never)
            }
          >
            <ArrowLeft size={20} color={theme.colors.onSurface} />
          </Pressable>
        </View>

        <View style={styles.header}>
          <Text style={styles.brandTitle}>ROTA</Text>
          <Text style={styles.heading}>Enter Invite Code</Text>
          <Text style={styles.subheading}>
            Paste the invitation code sent to you by your team owner or manager
          </Text>
        </View>

        {(errorMessage || inviteQueryError) && (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <AlertCircle size={18} color={theme.colors.error} />
            <Text style={styles.errorBannerText}>
              {errorMessage || inviteQueryError?.message || 'Invalid or expired invitation token.'}
            </Text>
          </View>
        )}

        <View style={styles.form}>
          <InputField
            label="Invitation Code"
            placeholder="e.g. 550e8400...abc123"
            autoCapitalize="none"
            autoCorrect={false}
            hint="Invitation tokens are in the format {teamId}.{token}"
            value={inviteToken}
            onChangeText={(text) => {
              setInviteToken(text);
              setErrorMessage(null);
            }}
          />

          {/* Invitation Preview Card */}
          {isLoadingInvite && (
            <View style={styles.previewCard}>
              <ActivityIndicator color={theme.colors.primary} size="small" />
              <Text style={styles.previewLoadingText}>Verifying invitation code...</Text>
            </View>
          )}

          {inviteData && (
            <View style={styles.previewCard}>
              <View style={styles.previewHeader}>
                <ShieldCheck size={20} color={theme.colors.primary} />
                <Text style={styles.previewTitle}>Invitation Verified</Text>
              </View>

              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Team:</Text>
                <Text style={styles.previewValue}>{inviteData.teamName}</Text>
              </View>

              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Assigned Role:</Text>
                <Text style={styles.previewRoleBadge}>
                  {inviteData.role.toUpperCase()}
                </Text>
              </View>

              {inviteData.email && (
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Restricted to:</Text>
                  <Text style={styles.previewValue}>{inviteData.email}</Text>
                </View>
              )}
            </View>
          )}

          <PrimaryButton
            label="Accept & Join Team"
            onPress={handleAccept}
            loading={acceptMutation.isPending}
            disabled={!trimmedToken}
            trailingIcon={<ArrowRight size={18} color={theme.colors.onPrimary} />}
            style={styles.actionButton}
          />
        </View>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to sign in"
            style={styles.secondaryLink}
            onPress={() => router.back()}
          >
            <Text style={styles.secondaryLinkText}>
              Back to <Text style={styles.linkHighlight}>Sign In</Text>
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
    topNavRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: t.spacing.medium,
    },
    backButton: {
      width: t.touchTarget,
      height: t.touchTarget,
      borderRadius: t.radius.full,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: t.colors.surfaceVariant,
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
    previewCard: {
      backgroundColor: t.colors.surfaceContainer,
      borderRadius: t.radius.card,
      padding: t.spacing.medium,
      gap: t.spacing.small,
      borderWidth: 1,
      borderColor: t.colors.surfaceVariant,
    },
    previewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
      marginBottom: t.spacing.extraSmall,
    },
    previewTitle: {
      ...t.textStyles.labelLarge,
      color: t.colors.onSurface,
      fontWeight: '600',
    },
    previewLoadingText: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
      textAlign: 'center',
      marginTop: t.spacing.extraSmall,
    },
    previewRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    previewLabel: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
    },
    previewValue: {
      ...t.textStyles.bodyMedium,
      color: t.colors.onSurface,
      fontWeight: '500',
    },
    previewRoleBadge: {
      ...t.textStyles.labelSmall,
      color: t.colors.primary,
      backgroundColor: t.colors.surface,
      paddingHorizontal: t.spacing.small,
      paddingVertical: t.spacing.extraSmall / 2,
      borderRadius: t.radius.control,
      fontWeight: '700',
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
