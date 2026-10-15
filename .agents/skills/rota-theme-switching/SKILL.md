---
name: rota-theme-switching
description: Implement the Rota ThemeProvider and useTheme hook - light, dark and system modes from the server-synced theme setting, with Android status/navigation bar styling and no flash of the wrong theme. Use when building src/theme, the theme setting, or debugging dark mode.
---

# Theme switching

## Behaviour (PRD §6.6, rule 81)
- Preference values: `light | dark | system`, stored in server settings (`user_settings.theme`, default `system`).
- Effective theme: `system` → device scheme (`useColorScheme()`), otherwise the preference. If the device scheme is unknown (`null`), use `light`.
- Before settings load (cold start, offline first run), use `system`. Never block rendering on the settings request.
- Changing the setting re-themes the whole app at once. No restart.
- Settings **edits are blocked offline** (P-03); reading the last known value is fine. Do not persist theme in AsyncStorage as a second source of truth (the persister holds only the upcoming-shifts query).

## Structure
```
ThemeProvider
  reads: server settings (TanStack Query), useColorScheme()
  resolves: effective ThemeName ('light' | 'dark')
  provides: { name, colors: colorRoles[name], spacing, typography, shadow() , touchTarget, ... }
useTheme()        -> that object; throws if used outside the provider
```
- `colors` is `colorRoles[name]` (semantic roles only; primitives are never exposed).
- Memoise the provided object on `name` so components re-render only on a theme change.
- Style the Android status bar and navigation bar from the effective theme using `expo-status-bar` / Expo's system UI API already in the project. Do not add a dependency for this; if one is needed, record it (X-03).
- Hold the splash screen until fonts (rule 82) and the first theme resolution are ready, to avoid a flash.

## Tests
- `system` + device dark → dark roles; `system` + device light → light roles; explicit `dark` ignores the device.
- Changing the preference updates `useTheme().name` without remount.
- A component snapshot renders in both themes with no literal colours (audit grep passes).
- `useTheme` outside the provider throws.

## Never
- Never read the colour scheme inside individual components; only the provider does (T-10).
- Never create a third theme or a high-contrast variant without a decision record and new tokens.
- Never use the CSS `@media` or `[data-theme]` mechanisms in React Native; they are web-only.
