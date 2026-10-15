/**
 * =============================================================================
 * Rota Theme — Radius Tokens
 * =============================================================================
 * Approved values from DESIGN-SYSTEM.md §3:
 * Small control: 8, input/button: 12, card: 16, modal: 24, full pill: 9999.
 */

export const radius = {
  none: 0,
  controlSmall: 8,
  control: 12,
  card: 16,
  modal: 24,
  full: 9999,
} as const;

export type RadiusToken = keyof typeof radius;
