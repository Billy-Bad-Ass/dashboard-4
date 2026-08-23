/**
 * Stripe — the revenue truth for any project whose model is `stripe`.
 *
 * Read-only, always. Refunds and price changes are human decisions and this
 * dashboard has no business making them; the key it is given should be a
 * restricted key with read scopes only.
 *
 * Amounts arrive from Stripe in minor units and stay that way. There is no
 * conversion anywhere in this file, which is the point.
 */

import Stripe from 'stripe';
import { cfEnv } from '../db';
import { attempt, unconfigured, type ConnectorResult } from './types';

export interface StripeCharge {
  id: string;
  createdOn: string;
  amountPence: number;
  refundedPence: number;
  feePence: number;
  currency: string;
  description: string | null;
  /**
   * What the buyer sees on their statement. This is the attribution key: with
   * more than one project selling through the same Stripe account it is the
   * only per-charge signal that says which business earned it.
   */
  statementDescriptor: string | null;
  status: string;
}

export interface StripeSnapshot {
  /** Gross, before refunds. Minor units. */
  grossPence: number;
  refundedPence: number;
  feesPence: number;
  netPence: number;
  currency: string;
  /** Succeeded charges in the window. */
  units: number;
  refundCount: number;
  disputeCount: number;
  /** Balance actually available to pay out. */
  availablePence: number;
  pendingPence: number;
  /** Active products in this mode. Zero means nothing is for sale. */
  productCount: number;
  charges: StripeCharge[];
}

function client(): Stripe | null {
  const key = cfEnv()?.STRIPE_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, {
    // Workers has no Node http stack; Stripe's fetch client is the supported path.
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
  });
}

export async function fetchStripe(sinceDays = 90): Promise<ConnectorResult<StripeSnapshot>> {
  const stripe = client();
  if (!stripe) {
    return unconfigured(
      'No STRIPE_SECRET_KEY. Add it as a secret under ' +
        'Cloudflare \u2192 Workers & Pages \u2192 bba-heartbeat \u2192 Settings \u2192 ' +
        'Variables and Secrets. Use a restricted key with read scopes only, in live mode.',
    );
  }

  return attempt('Stripe', async () => {
    const created = { gte: Math.floor(Date.now() / 1000) - sinceDays * 86_400 };

    const [charges, balance, products, disputes] = await Promise.all([
      stripe.charges.list({ limit: 100, created, expand: ['data.balance_transaction'] }),
      stripe.balance.retrieve(),
      stripe.products.list({ limit: 100, active: true }),
      stripe.disputes.list({ limit: 100, created }),
    ]);

    let gross = 0;
    let refunded = 0;
    let fees = 0;
    let units = 0;
    let refundCount = 0;
    let currency = 'gbp';

    const rows: StripeCharge[] = [];
    for (const charge of charges.data) {
      if (!charge.paid || charge.status !== 'succeeded') continue;
      units += 1;
      gross += charge.amount;
      refunded += charge.amount_refunded;
      if (charge.amount_refunded > 0) refundCount += 1;
      currency = charge.currency;

      // The fee only exists once the balance transaction has settled. An
      // unsettled charge contributes zero rather than a guess.
      const txn = charge.balance_transaction;
      const fee = txn && typeof txn === 'object' ? txn.fee : 0;
      fees += fee;

      rows.push({
        id: charge.id,
        createdOn: new Date(charge.created * 1000).toISOString().slice(0, 10),
        amountPence: charge.amount,
        refundedPence: charge.amount_refunded,
        feePence: fee,
        currency: charge.currency,
        description: charge.description,
        // calculated_ is what Stripe actually sent to the bank; the raw field
        // is null whenever the account-level default was used.
        statementDescriptor:
          charge.calculated_statement_descriptor ?? charge.statement_descriptor ?? null,
        status: charge.status,
      });
    }

    return {
      grossPence: gross,
      refundedPence: refunded,
      feesPence: fees,
      netPence: gross - refunded - fees,
      currency,
      units,
      refundCount,
      disputeCount: disputes.data.length,
      availablePence: balance.available.reduce((a, b) => a + b.amount, 0),
      pendingPence: balance.pending.reduce((a, b) => a + b.amount, 0),
      productCount: products.data.length,
      charges: rows,
    };
  });
}
