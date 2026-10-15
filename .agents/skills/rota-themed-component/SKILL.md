---
name: rota-themed-component
description: Build or modify a Rota mobile UI component or screen using only design tokens - semantic colour roles, spacing scale, type roles, shadows - with accessibility, loading/empty/error states, and dark mode. Use whenever creating a Button, Text, Card, Input, Chip, Badge, Skeleton, Toast, EmptyState, BottomSheet, list row, or any screen styling.
---

# Themed component

## Procedure
1. Read rules 80, 81, 82 and `docs/DESIGN-SYSTEM.md` §5 for the component's spec.
2. Take every visual value from `useTheme()`: `colors.<role>`, `spacing.<name>`, `typography` via `<Text role>`, `shadow(<token>)`. No literals (T-03/T-04/T-05).
3. Build the styles from a function of the theme so light and dark both work: `const styles = useMemo(() => createStyles(theme), [theme])`.
4. Cover every state: default, pressed, disabled, loading, focused, error (inputs), selected (chips). Skeletons for predictable lists, spinners only for small in-place actions. Never a blank screen.
5. Accessibility gate (P0): `accessibilityRole`, `accessibilityLabel` (and `accessibilityState` for disabled/selected/busy), touch target ≥ 44×44 pt (`minHeight`/`minWidth` from `spacing`, or `hitSlop`), text contrast per rule 81, layout survives the largest system font size, respect reduced motion.
6. Document variants, states, and props in `COMPONENTS` docs or the component gallery screen, and add the component to the gallery in every state and both themes.
7. Never fetch data or hold server state inside a design-system component (L-08).

## Colour pairings
| Surface you draw | Content colour |
|---|---|
| `primary` fill | `onPrimary` |
| `primaryContainer` | `onPrimaryContainer` |
| `secondaryContainer` | `onSecondaryContainer` |
| `errorContainer` / `error` | `onErrorContainer` / `onError` |
| `surface*` | `onSurface` (primary text), `onSurfaceVariant` (secondary text) |
| `inverseSurface` (toast) | `inverseOnSurface` |
Control borders (input outline, outlined button, selected chip) use `onSurfaceVariant`, never `surfaceVariant` (rule 81).

## Example: Button (primary, with loading)
```tsx
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useMemo } from 'react';
import { Text } from '../Text';
import { useTheme, type Theme } from '../../theme';

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
};

export function PrimaryButton({ label, onPress, loading = false, disabled = false, accessibilityHint }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.base, inactive && styles.inactive, pressed && styles.pressed]}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors.onPrimary} />
      ) : (
        <Text role="labelLarge" color="onPrimary">{label}</Text>
      )}
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    base: {
      minHeight: 48,                      // >= 44 pt target; 48 is the preferred size
      paddingHorizontal: t.spacing.extraLarge,
      paddingVertical: t.spacing.medium,
      borderRadius: t.radius.control,     // from --radius-* once added to the token source
      backgroundColor: t.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inactive: { opacity: 0.5 },
    pressed: { opacity: 0.85 },
  });
```
Notes: `minHeight: 48` is a layout minimum required by the 44 pt gate, not a design token; keep it as a named constant in the theme (`touchTarget`) rather than a literal in each file. `t.radius` exists only after radius tokens are added (rule 80). Until then, stop and ask; do not hard-code `12`. `opacity` for disabled is a documented exception: state it once in the theme as `disabledOpacity`.

## Text component contract
`<Text role="bodyLarge" color="onSurface">`; `role` is a `TypographyRole`; `color` is a `ColorRole` (default `onSurface`). It applies size, lineHeight, weight (through the weight→family map), and letterSpacing from the token, and never disables font scaling.

## Shadows (Android is the verified platform)
`elevation.ts` is the single place that converts a shadow token to a platform style. CSS `box-shadow` does not exist in React Native. Use: iOS `shadowColor` (rgb of the token colour), `shadowOpacity` (its alpha), `shadowOffset`, `shadowRadius ≈ blur / 2`; Android `elevation` chosen per token (suggested: `soft` 3, `medium` 6, `hard` 10; confirm visually). If the installed React Native supports the `boxShadow` style prop, prefer it with the token values. `spread` has no equivalent on the legacy props. Check the result on an Android device in both themes and record the mapping in a decision record.

## Done when
Typecheck and lint pass; no literal colour/spacing/font value in the diff (run the audit greps in skill `rota-design-audit`); light and dark checked; gallery updated; the completion report (rule 60) lists the T-rules touched.
