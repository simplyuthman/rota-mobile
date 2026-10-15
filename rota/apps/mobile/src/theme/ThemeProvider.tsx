/**
 * =============================================================================
 * Rota Theme — Theme Provider & useTheme Hook
 * =============================================================================
 * AGENTS.md §2.1 & Rule 81:
 * Provides theme context (light, dark, system).
 * Never exposes foundation primitives (T-01).
 * Styles Android status bar with expo-status-bar.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  colorRoles,
  spacing,
  shadows,
  typography,
  type ThemeName,
  type ShadowToken,
} from './tokens.generated';
import { textStyles } from './typography';
import { getShadowStyle } from './elevation';
import { radius } from './radius';

export type ThemePreference = 'light' | 'dark' | 'system';

export interface ThemeContextValue {
  name: ThemeName;
  colors: (typeof colorRoles)[ThemeName];
  spacing: typeof spacing;
  typography: typeof typography;
  textStyles: typeof textStyles;
  shadows: typeof shadows;
  radius: typeof radius;
  touchTarget: number;
  getShadow: (token: ShadowToken) => ReturnType<typeof getShadowStyle>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  children: React.ReactNode;
  preference?: ThemePreference;
}

export function ThemeProvider({ children, preference = 'system' }: ThemeProviderProps) {
  const systemScheme = useColorScheme();

  const effectiveTheme: ThemeName = useMemo(() => {
    if (preference === 'light' || preference === 'dark') {
      return preference;
    }
    return systemScheme === 'dark' ? 'dark' : 'light';
  }, [preference, systemScheme]);

  const value: ThemeContextValue = useMemo(() => {
    return {
      name: effectiveTheme,
      colors: colorRoles[effectiveTheme],
      spacing,
      typography,
      textStyles,
      shadows,
      radius,
      touchTarget: 48,
      getShadow: getShadowStyle,
    };
  }, [effectiveTheme]);

  return (
    <ThemeContext.Provider value={value}>
      <StatusBar style={effectiveTheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
