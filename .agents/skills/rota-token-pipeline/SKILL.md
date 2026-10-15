---
name: rota-token-pipeline
description: Convert the generated design-system CSS (tokens.css with --primitive-*, --color-* roles, spacing, shadows, DM Sans typography) into the typed tokens.generated.ts and the theme layer for the Rota mobile app. Use when tokens.css is added or changes, when setting up src/theme, or when a token seems missing.
---

# Token pipeline

The designer's CSS is the source of truth. The app never reads CSS at runtime (React Native has no CSS variables). A script turns it into TypeScript.

## Files
```
apps/mobile/src/theme/
  tokens.css                # source. Never hand-edit. Copy the designer's file here unchanged.
  tokens.generated.ts       # GENERATED. Never hand-edit.
  index.ts                  # the ONLY file that imports tokens.generated.ts
  ThemeProvider.tsx         # see skill rota-theme-switching
  typography.ts             # weight -> font family map (single place)
  elevation.ts              # shadow token -> platform style (single place)
```

## Generate
```
node .agents/skills/rota-token-pipeline/scripts/generate-tokens.mjs \
  apps/mobile/src/theme/tokens.css apps/mobile/src/theme/tokens.generated.ts
```
Add it as an npm script (`pnpm tokens`) and run it in CI; fail CI if the generated file is out of date (regenerate and `git diff --exit-code`).

## What the script does
- Reads only the global `:root` block (primitives, spacing, shadows, typography), the light role block, and the `[data-theme="dark"]` block. It **skips** the `@media (prefers-color-scheme: dark)` block, because it duplicates the dark block.
- Fully resolves `var()` chains to hex (for example `--color-surface` → `--color-surface-color` → neutral 98). The intermediate `--color-surface-color` is dropped.
- Strips `px`. Parses shadows into `{offsetX, offsetY, blur, spread, color}`; shadow colours are 8-digit hex with alpha last (`#00000052`), which React Native accepts.
- Converts names to camelCase: `extra-small` → `extraSmall`, `on-primary-container` → `onPrimaryContainer`, `display-large` → `displayLarge`.
- Fails loudly on a circular or unresolved reference, an unrecognised shadow format, a non-px size, or light/dark themes with different roles. Fix the source CSS; never loosen the script to hide a failure.
- Ignores the `.display-large` etc. utility classes (web helpers).

## Wire the theme layer
`index.ts` re-exports **only** `spacing`, `shadows`, `typography`, `colorRoles` and the types. It must **not** re-export `primitives` (rule T-01). Add ESLint `no-restricted-imports` so `tokens.generated` can be imported only from `src/theme/**`.

## Add a test
`theme/tokens.test.ts` must assert: every colour role exists in both themes; every role value matches `/^#[0-9a-f]{6}$/i`; spacing values are multiples of 4 except `0`; every typography role has size, lineHeight, weight, letterSpacing, family.

## When a token is missing
This CSS has no radius, outline, success/warning/info, scrim, icon-size, or spacing above 32. Follow rule 80 "Missing tokens": radii come from the approved DESIGN-SYSTEM §3 values and are added to the **CSS source** as `--radius-*` through a decision record; everything else, stop and ask. Extend the generator (a new section like spacing) in the same PR that adds the CSS tokens, with a test.

## When the designer regenerates
Replace `tokens.css`, run the script, run the contrast audit (skill `rota-design-audit`), check both themes, commit CSS + generated file together.
