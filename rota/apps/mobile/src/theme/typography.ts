/**
 * =============================================================================
 * Rota Theme — Typography Mappings
 * =============================================================================
 * Maps font weight numbers to DM Sans font family variants.
 * AGENTS.md rule 82: DM Sans is the single font family.
 */

import type { TextStyle } from 'react-native';
import { typography as generatedTypography, type TypographyRole } from './tokens.generated';

export const FONT_FAMILY = {
  regular: 'DMSans-Regular', // 400
  medium: 'DMSans-Medium',   // 500
  semiBold: 'DMSans-SemiBold', // 600
  bold: 'DMSans-Bold',       // 700
} as const;

export function getFontFamilyForWeight(weight: number): string {
  if (weight >= 700) return FONT_FAMILY.bold;
  if (weight >= 600) return FONT_FAMILY.semiBold;
  if (weight >= 500) return FONT_FAMILY.medium;
  return FONT_FAMILY.regular;
}

export const textStyles: Record<TypographyRole, TextStyle> = Object.entries(
  generatedTypography
).reduce(
  (acc, [key, val]) => {
    acc[key as TypographyRole] = {
      fontSize: val.size,
      lineHeight: val.lineHeight,
      letterSpacing: val.letterSpacing,
      fontWeight: String(val.weight) as TextStyle['fontWeight'],
      fontFamily: getFontFamilyForWeight(val.weight),
    };
    return acc;
  },
  {} as Record<TypographyRole, TextStyle>
);
