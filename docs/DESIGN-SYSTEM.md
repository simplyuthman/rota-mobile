# Rota — Mobile Design System

**Document status:** Draft v1.1 (revised after adversarial review; every ruling applied)

**Purpose:** Give product designers and implementation agents a consistent, accessible visual language.

**Brand personality:** Calm, capable, clear, dependable, modern. Rota should feel operationally trustworthy, not playful or enterprise-heavy.

**Platform note:** Android (development build) is the verified platform. iOS shares the codebase but is not verified in MVP, so screen-reader checks target TalkBack; VoiceOver is checked only if an iOS device is available.

## 1. Design principles

- **Schedule first:** The next shift and upcoming week should be immediately scannable.
- **Strong hierarchy:** Use typography, spacing, and grouping before decoration.
- **Status has text, not color alone:** Every shift/request status uses a label and optionally an icon.
- **Calm surfaces:** Neutral backgrounds, restrained accent color, and clear cards.
- **Mobile ergonomics:** Primary actions near the bottom where practical; comfortable touch targets.
- **Transparent system state:** Make loading, offline, stale, pending, error, and success states visible.
- **Accessible by default (P0 gate):** Four checks are built into components from day one: accessibility labels, 44×44 pt touch targets, 4.5:1 text contrast, and layouts that survive the largest system font size.
- **Consistency over one-off screens:** Build reusable tokens and components before feature-specific styling.

## 2. Visual direction

- **Primary brand:** Deep teal / blue-green, communicating reliability and operational clarity.
- **Accent:** Fresh mint or teal tint for positive emphasis.
- **Neutrals:** Cool off-white page background, white surfaces, charcoal text, muted slate secondary text.
- **Status colors:** Green for approved/published success; amber for pending/warning; red for destructive/error; blue for informational states.
- **Shape language:** Rounded cards and inputs with restrained corner radii; avoid excessive pill-shaped containers.
- **Depth:** Prefer surface contrast and subtle borders over heavy shadows.
- **Iconography:** One consistent line-icon family; pair status icons with text labels.

Color values below are proposed starting tokens, not a final brand decision. Verify all foreground/background combinations for a contrast ratio of at least 4.5:1 for text before release.

## 3. Design tokens

### Color

```ts
export const colors = {
  brand: {
    50: "#E7F5F2",
    100: "#C8E8E1",
    500: "#168A7A",
    600: "#117466",
    700: "#0D5C53",
    900: "#123B39",
  },
  neutral: {
    0: "#FFFFFF",
    50: "#F7F9FA",
    100: "#EEF2F4",
    200: "#DDE4E8",
    300: "#C4CFD5",
    500: "#71808A",
    700: "#3B4850",
    900: "#17242B",
  },
  success: { bg: "#E7F6ED", fg: "#176B3A", border: "#B8E4C8" },
  warning: { bg: "#FFF4D9", fg: "#7B5200", border: "#F0D58C" },
  danger:  { bg: "#FDECEC", fg: "#A52525", border: "#F3B8B8" },
  info:    { bg: "#EAF3FF", fg: "#1F5592", border: "#B9D5FA" },
  dark: {
    background: "#10191D",
    surface: "#172328",
    elevated: "#203036",
    text: "#F4F7F8",
    mutedText: "#A9B8BE",
    border: "#34464D",
  },
};
```

### Typography

Use a platform-native sans-serif or a consistent family such as Inter if bundled and licensed appropriately.

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| `display` | 30 / 36 | 700 | Rare hero/empty-state title |
| `h1` | 26 / 32 | 700 | Screen title |
| `h2` | 22 / 28 | 700 | Major section |
| `h3` | 18 / 24 | 600 | Card/section heading |
| `body` | 16 / 24 | 400 | Main content |
| `bodyMedium` | 16 / 24 | 600 | Emphasis/action descriptions |
| `bodySmall` | 14 / 20 | 400 | Supporting content |
| `caption` | 12 / 16 | 500 | Metadata, timestamps |
| `button` | 15 / 20 | 600 | Button label |

Avoid 12px text for critical shift times or actions. Respect system text scaling; layouts must survive the largest system font size.

### Spacing

Use a 4-point base scale: `0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.

- Screen horizontal padding: 20–24.
- Card padding: 16.
- Standard vertical gap: 12 or 16.
- Dense metadata gap: 4–8.
- Bottom safe-area spacing: include device inset and navigation bar.

### Radius and elevation

- Small control radius: 8.
- Input/button radius: 12.
- Card radius: 16.
- Large modal/sheet radius: 24 at top corners.
- Use a 1px neutral border as default separation.
- Shadows only for floating menus, sheets, and elevated overlays.

### Motion

- Standard transitions: 160–220 ms.
- Prefer opacity/transform transitions.
- Respect reduced-motion settings.
- Avoid motion for status changes that may distract during shift work.

## 4. Layout and responsive rules

- Use safe-area-aware layouts and avoid placing critical controls under system bars.
- Screen content scrolls; primary navigation remains stable.
- On compact devices, use agenda/list presentation rather than compressing calendar cells.
- Calendar week view may horizontally scroll by day; shift cards must remain readable at the largest font size.
- Keep primary action hierarchy consistent: one filled primary action, secondary outlined/text action, destructive action separated.
- Bottom sheets are appropriate for filters, swap confirmation, and concise shift details; use full screens for complex forms.
- Do not rely on color alone for state or selected day.

## 5. Component library

### Buttons

- Variants: Primary, Secondary, Tertiary/Ghost, Destructive, Icon-only.
- States: Default, Pressed, Disabled, Loading, Focused.
- Rules:
  - Minimum touch target 44×44 pt (prefer 48).
  - Loading state disables duplicate submission.
  - Icon-only buttons require accessibility labels. Every button has a label.
  - Destructive actions require confirmation when they have irreversible consequences.

### Inputs

- Types: Text, Email, Password, Search, Time/Date picker, Select, Multiline, One-time code, Invite code.
- States: Default, Focused, Error, Disabled, Read-only.
- Rules:
  - Persistent labels; placeholders are examples, not the only label.
  - Inline error text explains how to recover.
  - Keyboard type and autofill match the field (one-time code uses the OTP autofill hint).
  - Password fields support visibility toggle and password-manager/autofill behavior.
  - Invite code field accepts paste and trims whitespace.

### Shift card

- Required information: start–end time, title/role, assignment/member, location if relevant.
- Status label (Draft, Published, Cancelled) when meaningful to the viewer. Staff never see Draft.
- Shift notes appear only for Owner/Manager viewers; staff cards never show notes.
- Times display in the team's time zone, labeled explicitly where ambiguity exists. Overnight shifts show the end date.
- Conflict warning where applicable (overlaps are blocked on the server; the card explains a rejected assignment).
- Tappable surface has a clear detail route.
- Use a consistent time layout and do not truncate the most important information.

### Status badge

- Variants: Draft, Published, Cancelled, Pending (waiting for colleague), Pending (waiting for manager), Approved, Rejected, Declined, Withdrawn, Expired, Trial, Offline/Stale.
- Always include text.
- Use neutral styling for non-critical statuses; reserve strong color for meaningful success, warning, and destructive states.

### Avatar and member row

- Avatar supports initials fallback.
- Member row shows display name and role to all members (staff need to know who they can swap with). Membership status, email, and phone are shown only to Owner/Manager.
- Avoid exposing email/phone in broad roster contexts unless needed.

### Calendar header

- Week range, previous/next controls, Today action.
- Accessible labels for navigation controls.
- Clearly identify the selected day and current day.
- Show an agenda/list alternative.

### Activity item

- Actor, event summary, relative time plus accessible absolute timestamp.
- Text is rendered on the client from `event_type` plus `params`, in the viewer's language and the team's time zone.
- Optional type icon.
- Never show private shift notes. Billing events appear only for the Owner; swap events only for participants, managers, and the Owner (the server filters by `visibility`).

### Swap request card

- Shift date/time, requester, target colleague, status, request time. (Open offers are out of MVP.)
- The target colleague sees Accept and Decline while the request is waiting for them.
- Managers see Approve and Reject only after the colleague has accepted and only when permitted and pending. The approver is never the requester or the target (owner exception tagged `self_approved`).
- The requester sees Withdraw only for their own pending request.
- After action, disable buttons and show pending/success/error feedback.

### Empty state

- Short title, one sentence, one relevant action.
- No decorative illustration required for every empty state.
- Example: "No shifts this week" / "Your published shifts will appear here."

### Loading and error states

- Use skeletons for predictable content layouts; use spinners for small in-place actions.
- Error state provides Retry when safe.
- Never leave a blank screen with no explanation.
- Feed has distinct initial-loading, empty, end-of-list, and error states.

### Toast/banner

- Use for non-blocking confirmation and recoverable errors.
- Do not communicate the only evidence of a critical billing or schedule change through a transient toast; reflect it in the persistent UI/activity feed.
- Persistent banners: offline, trial ending, payment pending, grace period, restricted (read-only), "Reconnect to refresh" (cache older than 14 days).

### Modal / bottom sheet

- Clear title, short context, primary action, cancel/close.
- Handle keyboard and safe area.
- Confirm destructive or financially meaningful actions with a summary (quote, effective date, amount).

### Navigation

- Role-aware destinations; backend remains authority.
- Use a persistent bottom tab bar with **five tabs: Schedule, Activity, Requests, Team, Settings.** Team is shown where the role allows more than a basic roster.
- **Billing is an Owner-only screen inside the Team tab**, not a sixth tab and not under Settings.
- Show unread counts only when they add useful information; avoid excessive badges.

## 6. Screen-level visual specification

### Schedule

- Top: greeting or team name, week selector, current/offline state.
- Main: next shift summary and week/agenda list.
- Staff: emphasize "Next shift" and upcoming assignments; published shifts only, no notes.
- Manager/Owner: prominent Create shift action and publish status; drafts visible.
- When offline, show a persistent but non-blocking banner and last-updated timestamp. Hide the cache and show "Reconnect to refresh" if the last sync is older than 14 days.

### Shift detail

- Large start/end time and date, in the team's time zone.
- Title/role and location.
- Assignment list if authorized.
- Primary action changes by role: Edit/Publish for Manager/Owner; Request swap for eligible Staff (published, future, currently assigned).
- Include change history link where useful.

### Requests

- Segments: Needs review (Manager/Owner), For you (colleague responses), My requests.
- Request cards clearly show shift, people, age, and status.
- Approval/rejection requires clear confirmation if assignment changes are consequential.

### Activity

- Chronological feed with readable actor/event/time hierarchy.
- Pull-to-refresh, infinite scroll, loading skeleton, empty state, end marker, and retry state.
- Do not append duplicate events when refreshing the first page.

### Team

- Searchable roster, role labels, invite action for the Owner only.
- Owner sees seat usage as "12 of 15 seats used" (active members of purchased seats).
- When the limit is reached, explain the next step (Owner: add seats in Billing) rather than failing silently. A non-owner never sees billing detail.
- Owner-only Billing entry. The Owner's own role row has no role or deactivate controls.

### Billing (Owner only, inside Team)

- Current plan, status (Trial, Active, Past due, Grace, Restricted), and renewal date; trial end date during trial.
- Seat breakdown: purchased seats, active members, included seats, extra seats. Seat ceilings shown (Starter 5, Team up to 38, Business up to 100).
- Plan cards with exact price, included seats, extra-seat pricing, and effective date.
- Before confirmation, show the **quote**: current plan, new plan, proration credit and charge, renewal amount, and quote expiry (30 minutes). The amount charged equals the quote.
- Changes that lower cost are shown as "Takes effect at the end of this period."
- Pending payment, trial, grace-period (7 days), and restricted banners are persistent until resolved.

### Settings

- Notification category toggles (shift changes, swaps, billing, activity), quiet-hour range, time zone, theme. Security notifications are not toggleable.
- The language row appears only when a second language ships.
- Indicate saving/saved/error states.
- Settings edits are blocked offline: show disabled controls with "Connect to change settings."
- Explain that quiet hours delay all non-security notifications, including time-critical shift changes (which still appear in the app immediately).
- Sessions: "Log out of all devices."

## 7. Accessibility requirements

Gated as P0 in the PRD (Section 11):

- Every interactive element has an accessibility label.
- Touch targets are at least 44×44 pt.
- Text contrast is at least 4.5:1.
- Layouts survive the largest system font size without clipped shift times or actions.

Also:

- Target WCAG 2.2 AA contrast for text and controls; validate tokens in actual combinations.
- Support TalkBack for all interactive elements (verified). VoiceOver is checked if an iOS device is available.
- Set accessibility labels and hints for icon-only controls and calendar navigation.
- Never use color alone to indicate request/shift status.
- Keep focus order logical in forms and modals.
- Announce submission outcomes and validation errors to assistive technologies.
- Respect reduced-motion preference.
- Test with TalkBack and large text on Android; add iOS if a device is available.

## 8. Dark mode

- Use semantic tokens (`background`, `surface`, `text`, `border`, `danger`) rather than hardcoded component colors.
- Keep contrast and status meaning consistent across themes.
- Theme setting is server-synchronized; device-level system theme is the default when preference is `system`.

## 9. Content and microcopy rules

- Use plain language: "Request swap", "Approve swap", "Published", "Last updated".
- Explain consequences before a financial or schedule-changing action.
- Avoid blaming the user in error messages.
- Provide actionable recovery: "Couldn't save settings. Try again."
- Use absolute dates/times in critical schedule confirmations; relative time may supplement them.
- Shifts show in the team's time zone; quiet hours use the user's. Name the zone where ambiguity exists.
- Never claim a payment succeeded until the server confirms verified webhook processing.
- Seat-limit message to a joining member: "This team is full. Ask the owner to add a seat."

## 10. Design QA checklist

- [ ] Tokenized colors, spacing, type, radii, and elevation are centralized.
- [ ] Light and dark themes cover every component.
- [ ] Contrast checked (at least 4.5:1) for text, icons, controls, badges, and disabled states.
- [ ] All components include loading, disabled, error, and success behavior where relevant.
- [ ] Every interactive element has an accessibility label and a touch target of at least 44×44 pt.
- [ ] Schedule is readable on compact screens and at the largest font size.
- [ ] Offline/stale state is visible, including "Reconnect to refresh".
- [ ] Billing shows exact price, quote, and proration breakdown; lives under Team (Owner only).
- [ ] Role-specific actions are clear without relying on UI as security; staff never see drafts, notes, or billing events.
- [ ] TalkBack (VoiceOver if an iOS device is available) and touch-target checks completed.
