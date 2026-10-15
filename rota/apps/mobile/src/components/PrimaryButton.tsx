/**
 * =============================================================================
 * Rota Mobile — PrimaryButton Component
 * =============================================================================
 * AGENTS.md rule 80, 81, 82 & rota-themed-component skill:
 * Fully accessible (>=44pt touch target), theme-reactive, zero raw literals.
 */

import React, { useMemo } from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, type ViewStyle, type TextStyle } from 'react-native';
import { useTheme, type ThemeContextValue } from '../theme';

export interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  style?: ViewStyle;
}

export function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  accessibilityHint,
  variant = 'primary',
  leadingIcon,
  trailingIcon,
  style,
}: PrimaryButtonProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme, variant), [theme, variant]);
  const isInactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      disabled={isInactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        isInactive && styles.inactive,
        pressed && !isInactive && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? theme.colors.onPrimary : theme.colors.primary}
          size="small"
        />
      ) : (
        <>
          {leadingIcon}
          <Text style={styles.text}>{label}</Text>
          {trailingIcon}
        </>
      )}
    </Pressable>
  );
}

const createStyles = (t: ThemeContextValue, variant: 'primary' | 'secondary' | 'ghost') => {
  const isSecondary = variant === 'secondary';

  let backgroundColor: string = t.colors.primary;
  let textColor: string = t.colors.onPrimary;
  let borderColor: string = 'transparent';
  let borderWidth = 0;

  if (isSecondary) {
    backgroundColor = t.colors.surfaceContainer;
    textColor = t.colors.onSurface;
    borderColor = t.colors.surfaceVariant;
    borderWidth = 1;
  } else if (variant === 'ghost') {
    backgroundColor = 'transparent';
    textColor = t.colors.primary;
  }

  const base: ViewStyle = {
    minHeight: t.touchTarget, // 48pt >= 44pt accessible target
    paddingHorizontal: t.spacing.large,
    paddingVertical: t.spacing.medium,
    borderRadius: t.radius.control,
    backgroundColor,
    borderColor,
    borderWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: t.spacing.small,
  };

  const text: TextStyle = {
    ...t.textStyles.labelLarge,
    color: textColor,
    fontWeight: '600',
  };

  return StyleSheet.create({
    base,
    text,
    inactive: {
      opacity: 0.5,
    },
    pressed: {
      opacity: 0.85,
    },
  });
};
