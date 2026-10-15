# Design System Tokens Documentation

## 1. Overview & Architecture

This design system establishes a **two-tier token architecture** based on the Material Design 3 (M3) tonal palette specification.

```
┌─────────────────────────────────────────────────────────────┐
│                      KEY COLOR SEEDS                        │
│   Primary (#004ed4), Secondary (#003eaa), Tertiary (#005efe)│
│   Neutral (#16181d), Neutral Variant (#38393a), Error...    │
└──────────────────────────────┬──────────────────────────────┘
                               │ (Algorithmically expanded)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    TIER 1: PRIMITIVES                       │
│                   `--primitive-[palette]-[step]`            │
│  • Foundations only (0, 10, 20, 30, 40 ... 90, 95, 98, 100) │
│  • ⚠️ GOVERNANCE RULE: NEVER apply directly to UI components │
└──────────────────────────────┬──────────────────────────────┘
                               │ (Referenced by semantic roles)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 TIER 2: SEMANTIC COLOR ROLES                │
│                      `--color-[role]`                       │
│  • Primary, on-primary, surface, container, error, etc.     │
│  • ✅ USAGE RULE: ALWAYS apply these to UI components       │
│  • Automatically swaps between Light and Dark themes        │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Why the Separation? (Design System Governance)

| Tier | Prefix | Target | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| **Primitives** | `--primitive-*` | **Design System Foundations** | Raw color ramps and key colors. Hardcoded values. If you use these directly in components, your UI will break when switching themes. | `--primitive-primary-40` |
| **Color Roles** | `--color-*` | **UI Components** | Semantic tokens describing **intent** and **hierarchy**. These point to primitives using `var(...)`. Theme switching remaps only these pointers. | `--color-primary` |

> [!CAUTION]
> **Component Rule:** Never write `color: var(--primitive-neutral-10);` in component CSS. Always write `color: var(--color-on-surface);`. This guarantees that your component automatically supports Dark Mode with zero additional CSS.

---

## 3. Color Roles Matrix (Light vs. Dark Theme)

Every color role has paired luminance contrast between foreground (`on-*`) and background containers:

| Color Role Token | Light Theme Primitive | Dark Theme Primitive | UI Intent / Usage |
| :--- | :--- | :--- | :--- |
| `--color-primary` | `--primitive-key-primary` (`#004ed4`) | `--primitive-primary-80` (`#99beff`) | High-emphasis fills, primary action buttons, key brand highlights |
| `--color-on-primary` | `--primitive-primary-100` (`#ffffff`) | `--primitive-primary-20` (`#002566`) | Text and icons placed on top of `--color-primary` |
| `--color-primary-container` | `--primitive-primary-90` (`#ccdfff`) | `--primitive-primary-30` (`#003899`) | Standout containers, badges, active navigation items |
| `--color-on-primary-container` | `--primitive-primary-30` (`#003899`) | `--primitive-primary-90` (`#ccdfff`) | Text and icons placed on top of primary container |
| `--color-secondary` | `--primitive-key-secondary` (`#003eaa`) | `--primitive-secondary-80` (`#a3c5ff`) | Less prominent components, chips, secondary buttons |
| `--color-on-secondary` | `--primitive-secondary-100` (`#ffffff`) | `--primitive-secondary-20` (`#002e80`) | Text and icons on top of `--color-secondary` |
| `--color-secondary-container`| `--primitive-secondary-90` (`#d6e5ff`) | `--primitive-secondary-30` (`#003eaa`) | Secondary container backgrounds |
| `--color-on-secondary-container`| `--primitive-secondary-30` (`#003eaa`) | `--primitive-secondary-90` (`#d6e5ff`) | Text/icons on secondary container |
| `--color-tertiary` | `--primitive-key-tertiary` (`#005efe`) | `--primitive-tertiary-80` (`#99bfff`) | Balanced accents, creative highlights |
| `--color-on-tertiary` | `--primitive-tertiary-100` (`#ffffff`) | `--primitive-tertiary-20` (`#002666`) | Text/icons on top of tertiary color |
| `--color-tertiary-container` | `--primitive-tertiary-90` (`#ccdfff`) | `--primitive-tertiary-30` (`#003999`) | Tertiary container backgrounds |
| `--color-on-tertiary-container`| `--primitive-tertiary-30` (`#003999`) | `--primitive-tertiary-90` (`#ccdfff`) | Text/icons on tertiary container |
| `--color-error` | `--primitive-key-error` (`#c51707`) | `--primitive-error-80` (`#fcada6`) | Destructive actions, validation alerts, errors |
| `--color-on-error` | `--primitive-error-100` (`#ffffff`) | `--primitive-error-20` (`#630b03`) | Text/icons placed on top of error fill |
| `--color-error-container` | `--primitive-error-90` (`#fdd2ce`) | `--primitive-error-30` (`#ad1406`) | Error callout boxes and alert banners |
| `--color-on-error-container` | `--primitive-error-30` (`#ad1406`) | `--primitive-error-90` (`#fdd2ce`) | Text/icons on error container |
| `--color-surface` / `--color-surface-color` | `--primitive-neutral-98` (`#f9fafb`) | `--primitive-neutral-10` (`#16181d`) | Base app background & viewport background |
| `--color-on-surface` | `--primitive-neutral-10` (`#16181d`) | `--primitive-neutral-90` (`#e2e4e9`) | Primary body text and icons on base surface |
| `--color-surface-variant` | `--primitive-neutral-variant-90` (`#e5e5e6`) | `--primitive-neutral-variant-30` (`#4b4c4e`) | Subtle borders, dividers, secondary surfaces |
| `--color-on-surface-variant` | `--primitive-neutral-variant-30` (`#4b4c4e`) | `--primitive-neutral-variant-80` (`#cbcccd`) | Muted text, captions, secondary labels |
| `--color-surface-container-lowest` | `--primitive-neutral-100` (`#ffffff`) | `--primitive-neutral-0` (`#000000`) | Deepest container level in dark mode / pure cards |
| `--color-surface-container-low` | `--primitive-neutral-98` (`#f9fafb`) | `--primitive-neutral-10` (`#16181d`) | Low-elevation cards or panels |
| `--color-surface-container` | `--primitive-neutral-95` (`#f0f1f4`) | `--primitive-neutral-20` (`#2c303a`) | Standard elevated cards, list items |
| `--color-surface-container-high` | `--primitive-neutral-90` (`#e2e4e9`) | `--primitive-neutral-20` (`#2c303a`) | Higher elevation elements, sheets, dialogs |
| `--color-surface-container-highest` | `--primitive-neutral-90` (`#e2e4e9`) | `--primitive-neutral-30` (`#424857`) | Highest elevation, popovers, dropdowns |
| `--color-inverse-surface` | `--primitive-neutral-20` (`#2c303a`) | `--primitive-neutral-90` (`#e2e4e9`) | SnackBar or Toast notifications |
| `--color-inverse-on-surface` | `--primitive-neutral-95` (`#f0f1f4`) | `--primitive-neutral-20` (`#2c303a`) | Text inside SnackBars / Toasts |
| `--color-surface-tint` | `--primitive-primary-40` (`#004bcc`) | `--primitive-primary-80` (`#99beff`) | Tonal elevation tint applied to surfaces |

---

## 4. Spacing Scale

| Token | Value | Equivalent | Usage |
| :--- | :--- | :--- | :--- |
| `--spacing-none` / `--spacing-no` | `0px` | `0` | Reset margins/paddings |
| `--spacing-extra-small` | `4px` | `0.25rem` | Micro spacing (icon-to-text, tag gaps) |
| `--spacing-small` | `8px` | `0.5rem` | Compact element padding, grid gaps |
| `--spacing-medium` | `12px` | `0.75rem` | Input field padding, list gap |
| `--spacing-base` | `16px` | `1.0rem` | Default content margin & standard card padding |
| `--spacing-large` | `20px` | `1.25rem` | Section padding, modal content gap |
| `--spacing-extra-large` | `24px` | `1.5rem` | Header padding, section gutters |
| `--spacing-very-large` | `32px` | `2.0rem` | Hero margins, major layout section breaks |

---

## 5. Shadows & Elevation

| Token | CSS Value | Visual Effect |
| :--- | :--- | :--- |
| `--shadow-soft` | `2px 2px 20px 0px #0000001f` | Ambient diffused elevation (cards, resting items) |
| `--shadow-medium` | `2px 4px 6px 0px #00000047` | Hovered states, floating buttons, popups |
| `--shadow-hard` | `4px 6px 8px 0px #00000052` | Dropdowns, modals, high-contrast separation |

---

## 6. Typography Scale

Font Family: `'DM Sans', sans-serif` across all styles.

| Scale Token | Font Size | Line Height | Weight | Letter Spacing | Helper Class |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `display-large` | `64px` | `96px` | `500` | `-4px` | `.display-large` |
| `display-medium`| `50px` | `75px` | `500` | `-3px` | `.display-medium` |
| `display-small` | `40px` | `60px` | `500` | `-2.3px` | `.display-small` |
| `headline-large`| `32px` | `48px` | `500` | `-1.55px` | `.headline-large` |
| `headline-medium`| `28px`| `42px` | `500` | `-1.35px` | `.headline-medium`|
| `headline-small`| `24px` | `36px` | `500` | `-1px` | `.headline-small` |
| `title-large`   | `22px` | `33px` | `500` | `-1px` | `.title-large` |
| `title-medium`  | `16px` | `24px` | `600` | `-0.85px` | `.title-medium` |
| `title-small`   | `14px` | `21px` | `400` | `-0.75px` | `.title-small` |
| `body-large`    | `16px` | `24px` | `500` | `-0.8px` | `.body-large` |
| `body-medium`   | `14px` | `21px` | `500` | `-0.75px` | `.body-medium` |
| `body-small`    | `12px` | `18px` | `400` | `-0.75px` | `.body-small` |
| `label-large`   | `14px` | `21px` | `500` | `-0.9px` | `.label-large` |
| `label-medium`  | `12px` | `18px` | `500` | `-0.9px` | `.label-medium` |
| `label-small`   | `11px` | `16.5px` | `500` | `-0.8px` | `.label-small` |

---

## 7. How to Run the Converter

The conversion script `convert-tokens.js` is self-contained with **zero external dependencies** (uses Node.js built-in `fs` and `path`).

### Basic Command:
```bash
node convert-tokens.js
```

### With Custom Input and Output:
```bash
node convert-tokens.js --input ./design-tokens.tokens.json --output ./styles/tokens.css
```

---

## 8. Implementation & Usage Examples

### A. Linking Tokens in HTML
```html
<link rel="stylesheet" href="tokens.css">
```

### B. Building a UI Card Component
```css
.card {
  background-color: var(--color-surface-container);
  color: var(--color-on-surface);
  border-radius: var(--spacing-medium);
  padding: var(--spacing-base);
  box-shadow: var(--shadow-soft);
  border: 1px solid var(--color-surface-variant);
}

.card-title {
  font-family: var(--font-title-large-family);
  font-size: var(--font-title-large-size);
  font-weight: var(--font-title-large-weight);
  line-height: var(--font-title-large-line-height);
  color: var(--color-on-surface);
  margin-bottom: var(--spacing-small);
}

.card-subtitle {
  font-family: var(--font-body-medium-family);
  font-size: var(--font-body-medium-size);
  color: var(--color-on-surface-variant);
  margin-bottom: var(--spacing-base);
}

.btn-primary {
  background-color: var(--color-primary);
  color: var(--color-on-primary);
  padding: var(--spacing-small) var(--spacing-base);
  border-radius: var(--spacing-small);
  border: none;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--shadow-medium);
  transition: opacity 0.2s ease;
}

.btn-primary:hover {
  opacity: 0.92;
}
```

### C. Theme Switching via JavaScript
```javascript
// Toggle between light and dark
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

// Example usage:
setTheme('dark');  // Force Dark theme
setTheme('light'); // Force Light theme
```
If no `data-theme` attribute is set, the CSS automatically follows the user's OS preference via `@media (prefers-color-scheme: dark)`.
