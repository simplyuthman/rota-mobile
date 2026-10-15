import { describe, it, expect } from 'vitest';
import { colorRoles, spacing, typography } from './tokens.generated';

describe('Design Tokens Validation', () => {
  it('every color role exists in both light and dark themes and is valid hex', () => {
    const lightKeys = Object.keys(colorRoles.light).sort();
    const darkKeys = Object.keys(colorRoles.dark).sort();

    expect(lightKeys).toEqual(darkKeys);

    const hexRegex = /^#[0-9a-fA-F]{6}$/;
    for (const [role, hex] of Object.entries(colorRoles.light)) {
      expect(hex, `light.${role}`).toMatch(hexRegex);
    }
    for (const [role, hex] of Object.entries(colorRoles.dark)) {
      expect(hex, `dark.${role}`).toMatch(hexRegex);
    }
  });

  it('spacing values are multiples of 4 except 0', () => {
    for (const [token, val] of Object.entries(spacing)) {
      if (val === 0) {
        expect(val).toBe(0);
      } else {
        expect(val % 4, `${token} value ${val} must be multiple of 4`).toBe(0);
      }
    }
  });

  it('every typography role has size, lineHeight, weight, letterSpacing, and family', () => {
    for (const [role, config] of Object.entries(typography)) {
      expect(config.size, `${role} size`).toBeGreaterThan(0);
      expect(config.lineHeight, `${role} lineHeight`).toBeGreaterThan(0);
      expect(config.weight, `${role} weight`).toBeGreaterThanOrEqual(400);
      expect(typeof config.letterSpacing, `${role} letterSpacing`).toBe('number');
      expect(config.family, `${role} family`).toBe('DM Sans');
    }
  });
});
