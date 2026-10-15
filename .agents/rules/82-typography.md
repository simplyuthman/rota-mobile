# Rule 82 — Typography (DM Sans)

> **Activation:** Glob — `apps/mobile/**`. Breaking any rule fails the task.

## Roles (size / line-height px, weight)
| Role | Size / LH | Weight | Use in Rota |
|---|---|---:|---|
| displayLarge / Medium | 64/96, 50/75 | 500 | Do not use on phones without a decision record |
| displaySmall | 40/60 | 500 | Rare empty-state hero only |
| headlineLarge | 32/48 | 500 | Rare |
| headlineMedium | 28/42 | 500 | Screen title option |
| headlineSmall | 24/36 | 500 | Screen title |
| titleLarge | 22/33 | 500 | Section heading |
| titleMedium | 16/24 | 600 | Card heading, emphasis |
| titleSmall | 14/21 | 400 | Sub-heading |
| bodyLarge | 16/24 | 500 | Main content |
| bodyMedium | 14/21 | 500 | Supporting content |
| bodySmall | 12/18 | 400 | Metadata only |
| labelLarge | 14/21 | 500 | Buttons, tabs |
| labelMedium | 12/18 | 500 | Chips, badges |
| labelSmall | 11/16.5 | 500 | Captions only |

## Never rules
- **T-20** Render text only through the `Text` component with a `role` prop (e.g. `<Text role="bodyLarge">`). Never use RN `Text` directly with ad-hoc styles.
- **T-21** Never put **critical information** in `bodySmall`, `labelMedium`, or `labelSmall`. Critical = shift start/end times, status labels, prices and totals, errors, action labels. Minimum for critical text: `bodyMedium` / `labelLarge` (14).
- **T-22** Never disable font scaling (`allowFontScaling={false}`) and never cap it with `maxFontSizeMultiplier` unless a decision record exists. Layouts must survive the largest system font size without clipped times or actions. Verify on a device at the largest size: line heights are fixed pixel values in the tokens, so check for clipping.
- **T-23** Apply `letterSpacing` exactly as tokenised (px). It is intentionally tight (about −0.75 to −0.9 px at 11–16 px). Do not "fix" it by hand. If a role looks cramped on a real Android device, report it to the user; do not edit tokens yourself.
- **T-24** Load **DM Sans before first render** (hold the splash screen until fonts are ready). Weights used: 400, 500, 600 only. React Native needs a **separate font family name per weight** (e.g. the `@expo-google-fonts/dm-sans` names); map weight → family in **one** function in `src/theme/`. Never reference font family strings anywhere else.
- **T-25** Adding `expo-font` / `@expo-google-fonts/dm-sans` is a new dependency: record it in `docs/decisions/` and get the user's approval first (rule 00, X-03). Do not substitute another font if loading fails; fall back to the system font and report it.
- **T-26** Never use a font weight that is not in the token for that role.
- **T-27** Text colour comes from a semantic role that pairs with its background (rule 81).
