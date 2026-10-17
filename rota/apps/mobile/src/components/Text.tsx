/**
 * =============================================================================
 * Rota Mobile — Themed Text Component
 * =============================================================================
 * AGENTS.md §5 & rota-themed-component skill:
 * Fully theme-reactive text applying tokens without literal values.
 * Contract: <Text role="bodyLarge" color="onSurface">
 */

import React from 'react';
import {
  Text as RNText,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';
import {
  useTheme,
  type TypographyRole,
  type ColorRole,
} from '../theme';

export interface TextProps extends Omit<RNTextProps, 'role'> {
  role?: TypographyRole;
  color?: ColorRole;
  style?: TextStyle | TextStyle[];
  children?: React.ReactNode;
}

export function Text({
  role = 'bodyMedium',
  color = 'onSurface',
  style,
  children,
  ...props
}: TextProps) {
  const { colors, textStyles } = useTheme();

  const baseStyle: TextStyle = {
    ...textStyles[role],
    color: colors[color],
  };

  return (
    <RNText style={[baseStyle, style]} {...props}>
      {children}
    </RNText>
  );
}
