/**
 * =============================================================================
 * Rota Mobile — Themed Card Component
 * =============================================================================
 * AGENTS.md §5 & rota-themed-component skill:
 * Fully theme-reactive card container using semantic surface tokens.
 */

import React, { useMemo } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
  type GestureResponderEvent,
} from 'react-native';
import { useTheme, type ThemeContextValue } from '../theme';

export interface CardProps {
  children: React.ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  variant?: 'elevated' | 'outlined' | 'flat';
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export function Card({
  children,
  onPress,
  style,
  variant = 'outlined',
  accessibilityLabel,
  accessibilityHint,
}: CardProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme, variant), [theme, variant]);

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={[styles.card, style]}>{children}</View>;
}

const createStyles = (t: ThemeContextValue, variant: 'elevated' | 'outlined' | 'flat') => {
  const shadow = variant === 'elevated' ? t.getShadow('soft') : {};
  const borderWidth = variant === 'outlined' ? 1 : 0;

  return StyleSheet.create({
    card: {
      backgroundColor: t.colors.surfaceContainerLowest,
      borderRadius: t.radius.card,
      borderColor: t.colors.surfaceVariant,
      borderWidth,
      padding: t.spacing.base,
      ...shadow,
    },
    pressed: {
      opacity: 0.9,
    },
  });
};
