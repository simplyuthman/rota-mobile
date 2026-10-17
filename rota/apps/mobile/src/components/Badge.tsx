/**
 * =============================================================================
 * Rota Mobile — Badge Component
 * =============================================================================
 * AGENTS.md §5 & rota-themed-component skill:
 * Status badge for shifts, roles, and swap statuses using exact token pairs.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { useTheme, type ThemeContextValue } from '../theme';

export type BadgeVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'error'
  | 'neutral'
  | 'outline';

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  size?: 'small' | 'medium';
  icon?: React.ReactNode;
  style?: ViewStyle;
}

export function Badge({
  label,
  variant = 'neutral',
  size = 'medium',
  icon,
  style,
}: BadgeProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme, variant, size), [theme, variant, size]);

  return (
    <View
      style={[styles.container, style]}
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      {icon}
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const createStyles = (
  t: ThemeContextValue,
  variant: BadgeVariant,
  size: 'small' | 'medium'
) => {
  let backgroundColor: string = t.colors.surfaceContainer;
  let textColor: string = t.colors.onSurfaceVariant;
  let borderColor: string = 'transparent';
  let borderWidth = 0;

  switch (variant) {
    case 'primary':
      backgroundColor = t.colors.primaryContainer;
      textColor = t.colors.onPrimaryContainer;
      break;
    case 'secondary':
      backgroundColor = t.colors.secondaryContainer;
      textColor = t.colors.onSecondaryContainer;
      break;
    case 'tertiary':
      backgroundColor = t.colors.tertiaryContainer;
      textColor = t.colors.onTertiaryContainer;
      break;
    case 'error':
      backgroundColor = t.colors.errorContainer;
      textColor = t.colors.onErrorContainer;
      break;
    case 'outline':
      backgroundColor = 'transparent';
      textColor = t.colors.onSurfaceVariant;
      borderColor = t.colors.surfaceVariant;
      borderWidth = 1;
      break;
    case 'neutral':
    default:
      backgroundColor = t.colors.surfaceContainer;
      textColor = t.colors.onSurfaceVariant;
      break;
  }

  const isSmall = size === 'small';

  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      paddingHorizontal: isSmall ? t.spacing.small : t.spacing.medium,
      paddingVertical: isSmall ? 2 : t.spacing.extraSmall,
      borderRadius: t.radius.control,
      backgroundColor,
      borderColor,
      borderWidth,
      gap: t.spacing.extraSmall,
    },
    text: {
      ...(isSmall ? t.textStyles.labelSmall : t.textStyles.labelMedium),
      color: textColor,
      fontWeight: '600',
    },
  });
};
