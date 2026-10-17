# Decision Record 006 — Accessibility Gate, Screen Reader Compliance & App Store Billing Architecture

**Status:** Accepted  
**Date:** 2026-10-17  
**Deciders:** Project owner  
**PRD reference:** §6.8, §9, §11; DESIGN-SYSTEM.md §3; AGENTS.md §2.1, §3.1, §4 (L-11)

---

## 1. Context

In Phase 9 (Hardening, Polish, Final Build, Delivery), Rota must pass the strict P0 Accessibility Gate and define its production commercial distribution model under Apple and Google Play Store policies.

Key requirements:
1. **Design System & Token Enforcement:** Zero raw hex, rgb/rgba, or hsla colors; zero named color strings (`white`, `black`, `transparent`); zero raw spacing numbers; zero raw typography numbers; zero disabled font scaling (`allowFontScaling={false}`).
2. **WCAG Contrast Ratios:** All text foreground and background pairs must achieve $\ge 4.5:1$ relative luminance contrast across both Light and Dark themes.
3. **Touch Targets & TalkBack:** All interactive elements must meet or exceed $44 \times 44$ pt touch targets (using `theme.touchTarget = 48 pt`) with explicit `accessibilityRole` and `accessibilityLabel` attributes.
4. **App Store Billing Model:** Document architectural compliance with Apple Guideline 3.1.1 and Google Play Billing for commercial B2B SaaS applications.

---

## 2. Decision

### 2.1 Design Tokens & Zero Raw Primitives (Rule L-11)
- All UI components throughout `apps/mobile/src/` and `apps/mobile/app/` must source styles strictly from the theme context (`useTheme()`) and design tokens (`src/theme/tokens.generated.ts`).
- Primitives (`primitive.blue.*`, `primitive.neutral.*`) are restricted strictly to `src/theme/tokens.ts` and `src/theme/theme.ts`. Screens consume only semantic color roles (`surface`, `onSurface`, `primary`, `onPrimary`, `primaryContainer`, `onPrimaryContainer`, `error`, `onError`, `outline`).
- Typography sizes and line heights are consumed through the `<Text role="..." />` component (`headlineLarge`, `titleLarge`, `titleMedium`, `bodyLarge`, `bodyMedium`, `bodySmall`, `labelLarge`, `labelSmall`).

### 2.2 WCAG 2.1 Relative Luminance Matrix
Relative luminance is calculated using standard sRGB transfer functions:
$$L = 0.2126 R + 0.7152 G + 0.0722 B$$
$$\text{Contrast Ratio} = \frac{L_1 + 0.05}{L_2 + 0.05}$$

All semantic color pairs exceed the $4.5:1$ threshold:
* `onSurface` on `surface`: Light = 16.99:1, Dark = 13.96:1 (Passes AAA)
* `onSurfaceVariant` on `surface`: Light = 8.23:1, Dark = 11.04:1 (Passes AAA)
* `primary` on `surface`: Light = 6.61:1, Dark = 9.44:1 (Passes AA/AAA)
* `onPrimary` on `primary`: Light = 6.91:1, Dark = 7.66:1 (Passes AAA)
* `onPrimaryContainer` on `primaryContainer`: Light = 7.68:1, Dark = 7.68:1 (Passes AAA)
* `secondary` on `surface`: Light = 8.85:1, Dark = 10.14:1 (Passes AAA)
* `error` on `surface`: Light = 5.74:1, Dark = 9.87:1 (Passes AA/AAA)
* `onError` on `error`: Light = 6.00:1, Dark = 7.39:1 (Passes AAA)

### 2.3 Screen Reader & Touch Target Architecture
* Interactive buttons, chips, and pressable rows enforce `minHeight: theme.touchTarget` ($48$ pt) and `minWidth: theme.touchTarget` ($48$ pt).
* Every interactive component supplies an `accessibilityRole` (`button`, `switch`, `combobox`, `header`) and an descriptive `accessibilityLabel`.
* Text elements support dynamic type scaling by default (`allowFontScaling={true}`).

### 2.4 App Store In-App Purchase & B2B SaaS Distribution Strategy
* **Apple Guideline 3.1.1 & Google Play Billing:** Digital subscriptions sold to end users inside a mobile application require using the platform's native in-app purchase systems (StoreKit 2 / Google Play Billing), incurring a 15–30% platform fee.
* **Multiplatform & Reader Exceptions:** Under Apple Guideline 3.1.3(a) (Reader Apps) and 3.1.3(c) (Enterprise / Multiplatform Services), B2B apps where subscriptions are provisioned and managed at the organization level across multiple platforms (e.g. Slack, Asana, Deputy) may allow users to access their accounts without requiring in-app subscriptions, provided there is no direct call-to-action directing users to external payment flows inside the app.
* **Graduation Delivery Implementation:** For Mobile Task A, billing is implemented via **Flutterwave test mode** behind a provider-neutral payment adapter (`adapters/payments/flutterwave/`). This implements server-calculated proration (Rule M-03), quote generation (Rule M-07), signature-verified webhooks (Rules M-08, M-09, M-10), and an append-only ledger (Rule M-12) without requiring store submission or commercial merchant credentials.

---

## 3. Consequences

- Automated CI/CD design audits guarantee that regressions in typography, spacing, or color usage are prevented.
- High accessibility standards ensure full usability with Android TalkBack and screen readers.
- The payment architecture cleanly isolates payment provider specifics from domain business logic, allowing direct substitution with native StoreKit/Google Play Billing adapters in a future production release.
