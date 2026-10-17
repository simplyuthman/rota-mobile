/**
 * =============================================================================
 * Rota API — Flutterwave Payment Adapter
 * =============================================================================
 * AGENTS.md §2.1, §2.3, §4 (L-06), §3.1 (M-08, M-09, M-10, M-11):
 * - Keep Flutterwave knowledge inside adapters/payments/flutterwave/.
 * - The rest of the backend talks to a provider-neutral interface.
 * - Test mode only. Never log payment secrets or card tokens.
 * - Verify webhook signature strictly BEFORE reading/processing the payload.
 * =============================================================================
 */

import { timingSafeEqual } from 'node:crypto';
import { env } from '../../../config/env.js';

export interface CheckoutLinkParams {
  teamId: string;
  quoteId: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
  customerName: string;
  redirectUrl?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface CheckoutLinkResult {
  checkoutUrl: string;
  txRef: string;
}

export interface ChargeTokenParams {
  token: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  txRef: string;
  email: string;
}

export interface ChargeTokenResult {
  status: 'success' | 'failed';
  transactionId: string;
}

export interface ParsedWebhookEvent {
  providerEventId: string;
  eventType: string;
  teamId: string;
  quoteId: string;
  amountCents: number;
  currency: string;
  status: 'successful' | 'failed';
  customerEmail?: string | undefined;
  cardToken?: string | undefined;
  txRef: string;
  flwRef?: string | undefined;
}

export interface PaymentProvider {
  createCheckoutLink(params: CheckoutLinkParams): Promise<CheckoutLinkResult>;
  chargeToken(params: ChargeTokenParams): Promise<ChargeTokenResult>;
  verifyWebhookSignature(signatureHeader: string | undefined): boolean;
  parseWebhookPayload(payload: unknown): ParsedWebhookEvent | null;
}

export class FlutterwaveAdapter implements PaymentProvider {
  private secretKey: string;
  private webhookSecret: string;

  constructor(secretKey?: string, webhookSecret?: string) {
    this.secretKey = secretKey ?? env.FLUTTERWAVE_SECRET_KEY ?? 'FLWSECK_TEST-mock-key';
    this.webhookSecret = webhookSecret ?? env.FLUTTERWAVE_WEBHOOK_SECRET ?? 'test-webhook-secret-hash';
  }

  /**
   * Rule M-09: Verify webhook signature before reading or parsing the payload.
   * Compares the 'verif-hash' header to the configured secret using timingSafeEqual.
   */
  verifyWebhookSignature(signatureHeader: string | undefined): boolean {
    if (!signatureHeader || !this.webhookSecret) {
      return false;
    }

    try {
      const headerBuf = Buffer.from(signatureHeader, 'utf8');
      const secretBuf = Buffer.from(this.webhookSecret, 'utf8');

      if (headerBuf.length !== secretBuf.length) {
        return false;
      }

      return timingSafeEqual(headerBuf, secretBuf);
    } catch {
      return false;
    }
  }

  /**
   * Rule M-07, M-11:
   * Create a checkout session charging exactly the quoted amount in cents.
   */
  async createCheckoutLink(params: CheckoutLinkParams): Promise<CheckoutLinkResult> {
    const txRef = `rota_${params.teamId.slice(0, 8)}_${params.quoteId.slice(0, 8)}_${Date.now()}`;
    const amountUnits = (params.amountCents / 100).toFixed(2);

    // If running in development/test with mock key or offline
    if (this.secretKey.includes('mock') || env.NODE_ENV === 'test') {
      return {
        checkoutUrl: `https://checkout.flutterwave.com/v3/hosted/pay/mock_${txRef}`,
        txRef,
      };
    }

    try {
      const response = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tx_ref: txRef,
          amount: amountUnits,
          currency: params.currency || 'USD',
          redirect_url: params.redirectUrl || 'https://rota.app/billing/return',
          meta: {
            team_id: params.teamId,
            quote_id: params.quoteId,
          },
          customer: {
            email: params.customerEmail,
            name: params.customerName,
          },
          customizations: {
            title: 'Rota Subscription',
            description: `Payment for quote ${params.quoteId}`,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Flutterwave API error (${response.status}): ${errorText}`);
      }

      const body = (await response.json()) as {
        status: string;
        data?: { link?: string };
      };

      if (body.status !== 'success' || !body.data?.link) {
        throw new Error('Flutterwave failed to generate hosted checkout link');
      }

      return {
        checkoutUrl: body.data.link,
        txRef,
      };
    } catch (err) {
      if (env.NODE_ENV === 'development') {
        // Fallback for local testing if network is unavailable
        return {
          checkoutUrl: `https://checkout.flutterwave.com/v3/hosted/pay/mock_${txRef}`,
          txRef,
        };
      }
      throw err;
    }
  }

  /**
   * Rule M-11: Tokenized recurring charge for background renewals
   */
  async chargeToken(params: ChargeTokenParams): Promise<ChargeTokenResult> {
    const amountUnits = (params.amountCents / 100).toFixed(2);

    if (this.secretKey.includes('mock') || env.NODE_ENV === 'test') {
      return {
        status: 'success',
        transactionId: `flw_mock_tx_${Date.now()}`,
      };
    }

    const response = await fetch('https://api.flutterwave.com/v3/tokenized-charges', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: params.token,
        currency: params.currency || 'USD',
        amount: amountUnits,
        email: params.email,
        tx_ref: params.txRef,
      }),
    });

    if (!response.ok) {
      return {
        status: 'failed',
        transactionId: '',
      };
    }

    const data = (await response.json()) as {
      status: string;
      data?: { id: number | string; status: string };
    };

    if (data.status === 'success' && data.data?.status === 'successful') {
      return {
        status: 'success',
        transactionId: String(data.data.id),
      };
    }

    return {
      status: 'failed',
      transactionId: data.data?.id ? String(data.data.id) : '',
    };
  }

  /**
   * Rule M-08, M-10:
   * Safely extract verified event details from Flutterwave webhook payload.
   */
  parseWebhookPayload(payload: unknown): ParsedWebhookEvent | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const raw = payload as Record<string, unknown>;
    const eventType = String(raw['event'] ?? '');
    const data = (raw['data'] as Record<string, unknown>) ?? raw;

    const providerEventId = String(data['id'] ?? raw['id'] ?? '');
    if (!providerEventId) {
      return null;
    }

    const meta = (data['meta'] as Record<string, unknown>) ?? {};
    const teamId = String(meta['team_id'] ?? data['team_id'] ?? '');
    const quoteId = String(meta['quote_id'] ?? data['quote_id'] ?? '');

    const rawAmount = data['amount'];
    const amountCents =
      typeof rawAmount === 'number'
        ? Math.round(rawAmount * 100)
        : typeof rawAmount === 'string'
        ? Math.round(parseFloat(rawAmount) * 100)
        : 0;

    const currency = String(data['currency'] ?? 'USD');
    const status = String(data['status'] ?? '').toLowerCase() === 'successful' ? 'successful' : 'failed';
    const txRef = String(data['tx_ref'] ?? data['txRef'] ?? '');
    const flwRef = data['flw_ref'] ? String(data['flw_ref']) : undefined;

    const customer = (data['customer'] as Record<string, unknown>) ?? {};
    const customerEmail = customer['email'] ? String(customer['email']) : undefined;

    const card = (data['card'] as Record<string, unknown>) ?? {};
    const cardToken = card['token'] ? String(card['token']) : undefined;

    return {
      providerEventId,
      eventType: eventType || 'charge.completed',
      teamId,
      quoteId,
      amountCents,
      currency,
      status,
      customerEmail,
      cardToken,
      txRef,
      flwRef,
    };
  }
}

export const defaultPaymentProvider = new FlutterwaveAdapter();
