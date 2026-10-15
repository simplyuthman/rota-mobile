# Rule 81 — Light/dark theming and contrast

> **Activation:** Glob — `apps/mobile/**`. Breaking any rule fails the task.

- **T-10** Components never branch on theme for colour. No `isDark ? '#…' : '#…'`. They read `useTheme().colors.<role>`; the provider swaps the whole role map.
- **T-11** The theme preference has three values: `light`, `dark`, `system`, stored in the server-synced settings (PRD §6.6). `system` follows the device colour scheme. Before settings load, use `system`. Changing the preference must re-theme the whole app and the Android status/navigation bar style immediately, without a restart.
- **T-12** Both themes define exactly the same roles. If a role is added to one theme only, the generator fails; fix the source, never the generator.
- **T-13** Never ship a screen that was only checked in one theme. Check light and dark.
- **T-14** Never convey status by colour alone. Pair every status colour with a text label (and an icon where useful).
- **T-15** Re-run the contrast audit (skill `rota-design-audit`) after **any** token change. Do not trust the table below once the CSS changes.

## Verified text contrast (WCAG ratios, computed from the current tokens)
All pass the 4.5:1 text rule.

| Pair | Light | Dark |
|---|---:|---:|
| onSurface on surface | 16.99 | 13.96 |
| onSurfaceVariant on surface | 8.23 | 11.04 |
| onSurfaceVariant on surfaceVariant | 6.83 | 5.35 |
| primary on surface | 6.61 | 9.44 |
| onPrimary on primary | 6.91 | 7.66 |
| onPrimaryContainer on primaryContainer | 7.68 | 7.68 |
| onSecondary on secondary | 9.25 | 7.04 |
| onSecondaryContainer on secondaryContainer | 7.28 | 7.28 |
| tertiary on surface | 4.98 | 9.51 |
| onTertiary on tertiary | 5.21 | 7.66 |
| error on surface | 5.74 | 9.87 |
| onError on error | 6.00 | 7.39 |
| onErrorContainer on errorContainer | 5.31 | 5.31 |

`tertiary` text on `surface` in light mode is 4.98:1: it passes but with little margin. Prefer `primary` for text links.

## The border trap (important)
`surfaceVariant` against `surface` is only **1.20:1 (light)** and **2.07:1 (dark)**. That fails the 3:1 needed for UI component boundaries.
- Use `surfaceVariant` only for **decorative** fills and dividers.
- Any border or fill that **identifies a control or its state** (input outline, outlined button, selected chip, focus ring, checkbox) must use **`onSurfaceVariant`** (8.23 light / 11.04 dark) or `primary`.
- Never use `surfaceVariant` as an input border.

## Surface hierarchy
`surfaceContainerLowest` < `surfaceContainerLow` < `surfaceContainer` < `surfaceContainerHigh` < `surfaceContainerHighest`. Use them for cards, sheets, and nesting. In light mode `surfaceContainerHigh` and `surfaceContainerHighest` are the same colour: do not rely on a visible difference between them. Use `inverseSurface` / `inverseOnSurface` for toasts and snackbars. `surfaceTint` is for elevation tinting only, never text.
