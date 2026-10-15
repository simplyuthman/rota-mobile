---
name: rota-design-audit
description: Audit Rota mobile UI against the design tokens and accessibility gate - find raw colours, primitives, raw spacing and font values, check WCAG contrast of the colour-role pairs in light and dark, and verify touch targets, labels and large-font layouts. Use before finishing any UI task, after tokens change, and during the Phase 9 accessibility pass.
---

# Design audit

Run all four checks. Report real output in the completion report (rule 60). Never write PASS for a check you did not run.

## 1. Token-literal greps (must return nothing outside `src/theme/` and tests)
```
# raw colours
grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(" apps/mobile/src apps/mobile/app --include=*.ts --include=*.tsx | grep -v "src/theme/"
# named colours
grep -rnE "(color|backgroundColor|borderColor|tintColor)\s*:\s*['\"](white|black|red|blue|green|gray|grey|transparent)" apps/mobile/src apps/mobile/app
# primitives used anywhere but the theme
grep -rnE "primitives|--primitive-" apps/mobile/src apps/mobile/app | grep -v "src/theme/"
# raw typography
grep -rnE "fontSize|lineHeight|letterSpacing|fontWeight|fontFamily" apps/mobile/src apps/mobile/app | grep -v "src/theme/"
# raw spacing (numbers in spacing props)
grep -rnE "(margin|padding|gap)[A-Za-z]*\s*:\s*[0-9]" apps/mobile/src apps/mobile/app | grep -v "src/theme/"
# font scaling disabled
grep -rn "allowFontScaling={false}\|maxFontSizeMultiplier" apps/mobile/src apps/mobile/app
```
Allowed literals: `0`, and named theme constants (`touchTarget`, `disabledOpacity`). Everything else is a T-03/T-04/T-05 failure; fix it, never suppress the grep.

## 2. Contrast
Recompute the pairs below from `tokens.generated.ts` (both themes) with the WCAG relative-luminance formula: ratio = (L1 + 0.05) / (L2 + 0.05). Required: **≥ 4.5 for text**, **≥ 3 for control boundaries and meaningful icons**.
Pairs: `onSurface/surface`, `onSurfaceVariant/surface`, `onSurfaceVariant/surfaceVariant`, `primary/surface`, `onPrimary/primary`, `onPrimaryContainer/primaryContainer`, `secondary/surface`, `onSecondary/secondary`, `onSecondaryContainer/secondaryContainer`, `tertiary/surface`, `onTertiary/tertiary`, `error/surface`, `onError/error`, `onErrorContainer/errorContainer`, `inverseOnSurface/inverseSurface`, and `onSurface` on each `surfaceContainer*`.
Known results for the current tokens are in rule 81 (all text pairs pass). Known failure to keep avoiding: `surfaceVariant` vs `surface` is 1.20 (light) and 2.07 (dark): never a control border.
Also check any real foreground/background combination used in a screen, not only the table.

## 3. Accessibility gate (every interactive element)
- Has `accessibilityLabel` (icon-only buttons especially) and the right `accessibilityRole`.
- Touch target ≥ 44×44 pt (measure; do not assume).
- Layout at the **largest Android system font size**: no clipped shift times, status, prices, or action labels; nothing overlaps; lists still scroll.
- Reduced motion respected.
- TalkBack walkthrough of the screen: logical focus order, states announced (disabled, busy, selected, error text).
- Status never by colour alone.

## 4. Themes and states
- Open the screen in light, dark, and `system` (switch device theme live).
- Every list/screen shows loading (skeleton), empty, error with retry, and offline states where relevant.
- Critical text is never in `bodySmall`/`labelMedium`/`labelSmall` (rule 82, T-21).

## Report format
```
## Design audit
Token greps: PASS/FAIL (list hits)
Contrast: PASS/FAIL (list pairs < threshold with ratios)
Accessibility (TalkBack, 44pt, largest font): PASS/FAIL (list issues)
Themes/states: PASS/FAIL
Open issues and who must decide (missing tokens, etc.): <list or none>
```
