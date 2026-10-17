/**
 * =============================================================================
 * Rota API — Sentry & Error Event Scrubber (Rule O-03)
 * =============================================================================
 * AGENTS.md §3.6 (O-03):
 * "Run Sentry on both the server and the mobile app. Scrub Authorization headers,
 * tokens, push tokens, secrets, and notes before sending."
 * =============================================================================
 */

export interface ScrubTarget {
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'password',
  'token',
  'refreshtoken',
  'magiclink',
  'secret',
  'flwsecretkey',
  'pushtoken',
  'notes',
  'cardnumber',
  'cvv',
]);

/**
 * Recursively deep-scrubs an object, redacting sensitive keys with '[REDACTED]'.
 */
export function scrubObject<T>(input: T): T {
  if (input === null || typeof input !== 'object') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => scrubObject(item)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = scrubObject(value);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Sentry beforeSend hook for scrubbing sensitive data.
 */
export function sentryBeforeSendHook(event: ScrubTarget): ScrubTarget {
  return scrubObject(event);
}
