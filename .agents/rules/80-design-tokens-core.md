# Rule 80 — Design tokens: the only source of visual values

> **Activation:** Glob — `apps/mobile/**`. Breaking any rule here fails the task even if the screen looks right. Rule IDs: T-xx.

## Source of truth
- The generated token file is **`apps/mobile/src/theme/tokens.css`** (the "DESIGN SYSTEM TOKENS - GENERATED CSS VARIABLES" file). Never hand-edit it; the designer regenerates it.
- The mobile app reads **`apps/mobile/src/theme/tokens.generated.ts`**, produced from the CSS by `.agents/skills/rota-token-pipeline/scripts/generate-tokens.mjs`. Never hand-edit it. Re-run the script whenever the CSS changes.
- For **colour, typography, spacing and shadow values**, this token file **supersedes** the teal palette, Inter font, type scale and spacing list in `docs/DESIGN-SYSTEM.md` §3. The rest of that document (components, screens, accessibility, microcopy) still applies. Tell the user the old values are stale; do not mix the two.

## Never rules
- **T-01** Never use a **primitive** (`--primitive-*` / `primitives.*`) in a component, screen, or style. Primitives are foundation only. Only the theme layer may import `tokens.generated.ts`; block it elsewhere with an ESLint `no-restricted-imports` rule.
- **T-02** Use **semantic colour roles only** (`primary`, `onPrimary`, `surface`, `onSurface`, `error`, …) via `useTheme()`. Theme switching operates only on these roles.
- **T-03** Never write a raw colour: no hex, `rgb()`, `hsl()`, or named colours (`'white'`, `'red'`) in any component or style.
- **T-04** Never write a raw spacing number. Use only the spacing scale: `none`/`no` 0, `extraSmall` 4, `small` 8, `medium` 12, `base` 16, `large` 20, `extraLarge` 24, `veryLarge` 32. No `margin: 13`. For larger gaps, compose tokens (e.g. two `veryLarge`) — do not invent `40`/`48`.
- **T-05** Never write raw typography. Use a type role (see rule 82); never set `fontSize`, `lineHeight`, `fontWeight`, `letterSpacing`, or `fontFamily` by hand.
- **T-06** Use shadow tokens only (`hard`, `medium`, `soft`). Shadows are for floating menus, sheets, and overlays; prefer surface contrast and borders elsewhere. See the Android mapping in skill `rota-themed-component`.
- **T-07** Pair colours only as the system defines: `on-X` content on `X` background (`onPrimary` on `primary`, `onSurface` on `surface`, `onErrorContainer` on `errorContainer`, …). Never put arbitrary content colours on a role.
- **T-08** A component that is not in the design system's component list must be built from the same tokens and added to the component gallery. Every component documents its variants, states, and props.

## Missing tokens — do not invent
This file has **no** tokens for: border radius, outline/border colour, success/warning/info colours, scrim/overlay colour, icon sizes, or spacing above 32.
- **Radius:** the approved values from `docs/DESIGN-SYSTEM.md` §3 are small 8, control 12, card 16, sheet 24. Add them to the **token source** as `--radius-*` (via a decision record in `docs/decisions/`), regenerate, then use them. Never inline them.
- **Success / warning / info / scrim / outline / icon size:** **stop and ask** (rule 60 "Blocked" template). Until the user adds them, status badges differ by **text label + icon** using only existing roles (`primary`/`secondary`/`error` and their containers). Never improvise a green or amber.
- Never assume a token exists. If `tokens.generated.ts` lacks it, it does not exist.

## Locked facts about this system
- Font: **DM Sans** (see rule 82). Themes: `light` and `dark`, plus `system` (follow the device).
- Palette is blue (primary `#004ed4` key, secondary `#003eaa`, tertiary `#005efe`, error `#c51707`). `tertiary` is almost the same hue as `primary`: never rely on it to distinguish meaning.
- Rota's accessibility gate still applies to every component: accessibility label, ≥ 44×44 pt target, ≥ 4.5:1 text contrast, survives the largest system font size.
