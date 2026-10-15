---
name: rota-offline-and-settings
description: Implement Rota's offline upcoming-shifts cache and cross-device user settings (quiet hours, time zone, categories, theme, language) including per-field PATCH, optimistic rollback, and cache wipe rules. Use for offline, persister, or settings work on mobile or backend.
---

# Offline cache and settings

## Offline cache
- **One** persisted TanStack Query (AsyncStorage persister): published shifts assigned to the user in the **next 30 days**; fields: time, title, location, status; **no notes**. Tokens stay in SecureStore.
- Show "Offline · Last updated <time>". If last successful sync is **> 14 days** ago, hide the cache and show "Reconnect to refresh".
- **Wipe** on logout, session revocation, refresh failure, and signed-in user change.
- **No offline writes**, including settings and swaps. Disable controls with "Connect to change settings".
- Test: logout → cache gone; user switch → previous cache gone; 14-day-old cache hidden.

## Settings (server is the single source of truth)
- Stored on the server: quiet hours, time zone, notification categories, language, theme.
- **`PATCH` sends changed fields only.** The server stamps each accepted field in `field_updated_at`; most recent accepted change per field wins. A tablet changing the theme must not overwrite quiet hours set on the phone (test it).
- Documented weakness (put in `STATE.md`): a stale device can still overwrite the same field after it reconnects.
- Time zone: set from the device on first launch; validate IANA; **no `UTC` default**.
- Sync: refetch on app open and on foreground.
- Mobile uses an **optimistic update**: snapshot → apply → rollback on error → refetch.
- Quiet-hours evaluation lives in the notification worker (see rota-notification-pipeline), never on the device.
- Language is stored and synced; show the language row in the UI only when a second language ships.
- Security notifications cannot be disabled.

## Document
Map every important piece of data to where it lives and why in `docs/STATE.md`.
