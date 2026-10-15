/**
 * =============================================================================
 * Rota API — Flutterwave Payment Adapter Stub
 * =============================================================================
 * AGENTS.md §4 (L-06):
 * Keep Flutterwave knowledge inside adapters/payments/flutterwave/.
 * The rest of the backend talks to a provider-neutral interface.
 * Phase 7 gate: Verified in test mode only.
 */

export interface PaymentProvider {
  createCustomer(params: { email: string; name: string }): Promise<{ customerId: string }>;
  chargeToken(params: {
    token: string;
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    txRef: string;
  }): Promise<{ status: 'success' | 'failed'; transactionId: string }>;
  verifyWebhookSignature(signature: string, payload: unknown): boolean;
}

export class FlutterwaveAdapter implements PaymentProvider {
  async createCustomer(_params: { email: string; name: string }): Promise<{ customerId: string }> {
    throw new Error('FlutterwaveAdapter not yet implemented — Phase 7 scope');
  }

  async chargeToken(_params: {
    token: string;
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    txRef: string;
  }): Promise<{ status: 'success' | 'failed'; transactionId: string }> {
    throw new Error('FlutterwaveAdapter not yet implemented — Phase 7 scope');
  }

  verifyWebhookSignature(_signature: string, _payload: unknown): boolean {
    throw new Error('FlutterwaveAdapter not yet implemented — Phase 7 scope');
  }
}
