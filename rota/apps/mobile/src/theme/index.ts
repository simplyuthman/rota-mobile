/**
 * =============================================================================
 * Rota Theme — Public Theme Barrel
 * =============================================================================
 * AGENTS.md rule T-01:
 * Re-exports ONLY semantic colorRoles, spacing, shadows, typography, and types.
 * MUST NOT re-export primitives.
 */

export {
  colorRoles,
  spacing,
  shadows,
  typography,
  type ColorRole,
  type ThemeName,
  type SpacingToken,
  type ShadowToken,
  type TypographyRole,
} from './tokens.generated';

export {
  ThemeProvider,
  useTheme,
  type ThemePreference,
  type ThemeContextValue,
} from './ThemeProvider';

export { textStyles, FONT_FAMILY } from './typography';
export { getShadowStyle } from './elevation';
export { radius, type RadiusToken } from './radius';
