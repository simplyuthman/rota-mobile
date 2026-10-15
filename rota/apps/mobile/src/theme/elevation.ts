/**
 * =============================================================================
 * Rota Theme — Elevation & Shadow Styles
 * =============================================================================
 * Converts platform-agnostic shadow tokens into React Native platform styles.
 */

import { Platform, type ViewStyle } from 'react-native';
import { shadows as generatedShadows, type ShadowToken } from './tokens.generated';

export function getShadowStyle(token: ShadowToken): ViewStyle {
  const shadow = generatedShadows[token];

  if (Platform.OS === 'android') {
    const elevationMap: Record<ShadowToken, number> = {
      soft: 2,
      medium: 4,
      hard: 8,
    };
    return {
      elevation: elevationMap[token],
    };
  }

  return {
    shadowColor: shadow.color.slice(0, 7), // #000000
    shadowOffset: {
      width: shadow.offsetX,
      height: shadow.offsetY,
    },
    shadowOpacity: parseInt(shadow.color.slice(7, 9) || 'ff', 16) / 255,
    shadowRadius: shadow.blur,
  };
}
