/**
 * =============================================================================
 * Rota Mobile — InputField Component
 * =============================================================================
 * AGENTS.md §5 & rota-themed-component skill:
 * Theme-reactive text input with accessible touch target (>=44pt),
 * explicit labels, error state, and zero raw literals.
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  type TextInputProps,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { useTheme, type ThemeContextValue } from '../theme';

export interface InputFieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string | null;
  containerStyle?: ViewStyle;
}

export function InputField({
  label,
  error,
  hint,
  containerStyle,
  style,
  ...inputProps
}: InputFieldProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme, !!error), [theme, !!error]);

  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={theme.colors.onSurfaceVariant}
        style={[styles.input, style]}
        accessibilityLabel={label}
        accessibilityRole="none"
        {...inputProps}
      />
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const createStyles = (t: ThemeContextValue, hasError: boolean) =>
  StyleSheet.create({
    container: {
      gap: t.spacing.extraSmall,
      width: '100%',
    },
    label: {
      ...t.textStyles.labelMedium,
      color: hasError ? t.colors.error : t.colors.onSurface,
      fontWeight: '600',
    },
    input: {
      minHeight: t.touchTarget, // >= 44pt accessible touch target
      borderRadius: t.radius.control,
      backgroundColor: t.colors.surfaceContainer,
      borderWidth: 1,
      borderColor: hasError ? t.colors.error : t.colors.surfaceVariant,
      paddingHorizontal: t.spacing.medium,
      paddingVertical: t.spacing.small,
      color: t.colors.onSurface,
      ...t.textStyles.bodyLarge,
    },
    error: {
      ...t.textStyles.bodySmall,
      color: t.colors.error,
    },
    hint: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
    },
  });
