import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVitals } from '../lib/heartbeat.ts';
import type { Project } from '../config/portfolio.ts';
import type { ProjectFinance } from '../lib/finance.ts';
import type { StripeSnapshot } from '../lib/connectors/stripe.ts';
import type { CloudflareSnapshot } from '../lib/connectors/cloudflare.ts';

/**
 * The unknown-versus-zero rule, at the one place it was actually broken.
 *
 * CLAUDE.md opens with it and `resolveVitals` was the function violating it:
 * with Stripe unconfigured it emitted "$0.00 revenue, 0 units, 0% refunds" —
 * three measured-looking figures for an API that had never been contacted. The
 * cron then wrote those zeroes into `metrics`, so the charts drew a flat, and
 * entirely fictional, revenue line.
 */

const VITALS = ['revenue', 'units', 'refund_rate'] as const;

function seller(): Project {
  return {
    slug: 'p',
    name: 'P',
    tagline: '',
    repo: 'owner/p',
    stage: 'shipped',
    revenueModel: 'stripe',
    accent: '#000',
    icon: 'bolt',
    startedOn: '2026-01-01',
    vitals: VITALS.map((key) => ({
      key,
      label: key,
      source: 'stripe' as const,
      unit: key === 'refund_rate' ? ('percent' as const) : ('count' as const),
      target: null,
      hint: '',
    })),
    gates: [],
    reality: '',
  };
}

function finance(): ProjectFinance {
  return {
    slug: 'p',
    spentPence: 0,
    grossPence: 0,
    refundedPence: 0,
    feesPence: 0,
    netPence: 0,
    profitPence: 0,
    roi: null,
    directSpendPence: 0,
    overheadPence: 0,
    daysToFirstRevenue: null,
  };
}

function snapshot(over: Partial<StripeSnapshot> = {}): StripeSnapshot {
  return {
    grossPence: 0,
    refundedPence: 0,
    feesPence: 0,
    netPence: 0,
    currency: 'usd',
    units: 0,
    refundCount: 0,
    disputeCount: 0,
    availablePence: 0,
    pendingPence: 0,
    productCount: 0,
    charges: [],
    ...over,
  };
}

function resolve(stripe: StripeSnapshot | null) {
  return resolveVitals(seller(), null, finance(), stripe, new Map(), null, 0);
}

test('an unconfigured Stripe leaves every money vital unknown, not zero', () => {
  const vitals = resolve(null);

  for (const key of VITALS) {
    assert.equal(
      vitals[key],
      null,
      `${key} must be null when Stripe never answered — a zero here renders as ` +
        'a measured figure and gets written into the metric history',
    );
  }
});

test('a Stripe that answered with no sales reports a real zero', () => {
  const vitals = resolve(snapshot());

  // The other half of the rule. Suppressing this to null would be just as
  // wrong: Stripe was asked, and the answer is genuinely nothing yet.
  assert.equal(vitals.revenue, 0);
  assert.equal(vitals.units, 0);
});

test('refund rate is undefined until something has actually been sold', () => {
  // 0/0 is not 0%, exactly as roiPercent() is undefined on zero spend.
  assert.equal(resolve(snapshot()).refund_rate, null);
});

test('refund rate is a real number once there is gross to divide by', () => {
  const vitals = resolve(snapshot({ grossPence: 10_000, refundedPence: 2_500 }));
  assert.equal(vitals.refund_rate, 25);
});

test('real Stripe figures pass through untouched', () => {
  const vitals = resolve(snapshot({ netPence: 9_400, units: 1, grossPence: 10_000 }));
  assert.equal(vitals.revenue, 9_400);
  assert.equal(vitals.units, 1);
});


/**
 * The `visitors` vital, which the Cloudflare connector feeds.
 *
 * Before this was wired, the connector could report `ok`, hold real per-script
 * traffic, and every visitors tile still read "—" — because nothing mapped a
 * project to its Worker. Honest, but only by accident.
 */

function traffic(): CloudflareSnapshot {
  return {
    requests: 1_500,
    errors: 3,
    cpuMedianUs: 900,
    byScript: [
      { script: 'bba-network-store', requests: 1_200, errors: 2 },
      { script: 'bba-network-hub', requests: 300, errors: 1 },
    ],
    windowDays: 7,
  };
}

function siteWithScript(script?: string): Project {
  const base = seller();
  return {
    ...base,
    cloudflareScript: script,
    vitals: [
      { key: 'visitors', label: 'Visitors', source: 'cloudflare', unit: 'count', target: null, hint: '' },
    ],
  };
}

function visitorsFor(project: Project, cloudflare: CloudflareSnapshot | null) {
  return resolveVitals(project, null, finance(), null, new Map(), null, 0, cloudflare).visitors;
}

test('visitors reads this project Worker, never the account total', () => {
  // 1200, not 1500. Two projects on one account must not be shown each
  // other's traffic — the same trap that made Stripe attribution per-project.
  assert.equal(visitorsFor(siteWithScript('bba-network-store'), traffic()), 1_200);
  assert.equal(visitorsFor(siteWithScript('bba-network-hub'), traffic()), 300);
});

test('a project with no Worker of its own reports unknown, not zero', () => {
  assert.equal(visitorsFor(siteWithScript(undefined), traffic()), null);
});

test('a Worker with no traffic rows yet is unknown, not zero', () => {
  // Cloudflare omits a script entirely until it has been invoked. That is
  // "nothing reported", not "nobody visited".
  assert.equal(visitorsFor(siteWithScript('bba-growth-os'), traffic()), null);
});

test('an unreachable Cloudflare leaves visitors unknown', () => {
  assert.equal(visitorsFor(siteWithScript('bba-network-store'), null), null);
});
