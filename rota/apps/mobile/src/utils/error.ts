/**
 * =============================================================================
 * Rota Mobile — Error Extraction Utilities
 * =============================================================================
 * Safe extraction of error messages and error codes from unknown thrown values,
 * adhering to AGENTS.md §5 (No any; strict TypeScript).
 */

import axios from 'axios';

export function getErrorMessage(err: unknown, defaultMessage = 'An unexpected error occurred'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: { message?: string } } | undefined;
    return data?.error?.message || err.message || defaultMessage;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return defaultMessage;
}

export function getErrorCode(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: { code?: string } } | undefined;
    return data?.error?.code;
  }
  return undefined;
}
