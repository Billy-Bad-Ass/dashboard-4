import test from 'node:test';
import assert from 'node:assert/strict';
import { expandSpend, overheadBearers, type SpendRow } from '../lib/finance.ts';
import type { Project } from '../config/portfolio.ts';

function spend(overrides: Partial<SpendRow> = {}): SpendRow {
  return {
    id: 1,
    project_slug: null,
    incurred_on: '2026-01-15',
    amount_pence: 500,
    currency: 'gbp',
    category: 'infra',
    vendor: 'Cloudflare',
    note: null,
    recurrence: 'once',
    ended_on: null,
    ...overrides,
  };
}

const FROM = new Date('2000-01-01T00:00:00Z');

test('a one-off charge produces exactly one occurrence', () => {
  const out = expandSpend(spend(), FROM, new Date('2026-06-01T00:00:00Z'));
  assert.equal(out.length, 1);
  assert.equal(out[0]?.amountPence, 500);
  assert.equal(out[0]?.recurring, false);
});

test('a one-off charge outside the window produces none', () => {
  const out = expandSpend(spend({ incurred_on: '2027-01-01' }), FROM, new Date('2026-06-01T00:00:00Z'));
  assert.equal(out.length, 0);
});

test('a monthly subscription expands one occurrence per elapsed month', () => {
  // Started 15 Jan, looking on 15 Apr: Jan, Feb, Mar, Apr = 4 charges.
  const out = expandSpend(
    spend({ recurrence: 'monthly' }),
    FROM,
    new Date('2026-04-15T12:00:00Z'),
  );
  assert.equal(out.length, 4);
  assert.deepEqual(
    out.map((o) => o.date),
    ['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15'],
  );
  assert.ok(out.every((o) => o.recurring));
});

test('a cancelled subscription stops billing at ended_on', () => {
  const out = expandSpend(
    spend({ recurrence: 'monthly', ended_on: '2026-03-01' }),
    FROM,
    new Date('2026-06-01T00:00:00Z'),
  );
  // Jan and Feb only — the March charge falls after the cancellation date.
  assert.deepEqual(
    out.map((o) => o.date),
    ['2026-01-15', '2026-02-15'],
  );
});

test('a subscription anchored past the end of a short month falls back to its last day', () => {
  // Billing on the 31st must not silently skip February. A subscription does
  // not stop charging because the calendar is awkward.
  const out = expandSpend(
    spend({ incurred_on: '2026-01-31', recurrence: 'monthly' }),
    FROM,
    new Date('2026-04-01T00:00:00Z'),
  );
  assert.deepEqual(
    out.map((o) => o.date),
    ['2026-01-31', '2026-02-28', '2026-03-31'],
  );
});

test('a yearly subscription steps twelve months at a time', () => {
  const out = expandSpend(
    spend({ incurred_on: '2024-03-01', recurrence: 'yearly', amount_pence: 1200 }),
    FROM,
    new Date('2026-06-01T00:00:00Z'),
  );
  assert.deepEqual(
    out.map((o) => o.date),
    ['2024-03-01', '2025-03-01', '2026-03-01'],
  );
});

test('expansion is bounded even for an absurdly old start date', () => {
  const out = expandSpend(
    spend({ incurred_on: '1900-01-01', recurrence: 'monthly' }),
    FROM,
    new Date('2026-06-01T00:00:00Z'),
  );
  // Capped at 1200 iterations; the guard is what stops a corrupt date spinning.
  assert.ok(out.length > 0);
  assert.ok(out.length <= 1200);
});

// ---------------------------------------------------------------- overhead --

function project(slug: string, stage: Project['stage']): Project {
  return {
    slug,
    name: slug,
    tagline: '',
    repo: `owner/${slug}`,
    stage,
    revenueModel: 'none',
    accent: '#000',
    icon: 'bolt',
    startedOn: '2026-01-01',
    vitals: [],
    gates: [],
    reality: '',
  };
}

const SAMPLE = [
  project('a', 'earning'),
  project('b', 'building'),
  project('c', 'idea'),
  project('d', 'paused'),
];

test('overhead "active" excludes unstarted and paused projects', () => {
  // An empty repository should not drag down a working project's ROI by
  // absorbing a share of the Cloudflare bill.
  const bearers = overheadBearers('active', SAMPLE).map((p) => p.slug);
  assert.deepEqual(bearers, ['a', 'b']);
});

test('overhead "even" includes ideas but still excludes paused', () => {
  const bearers = overheadBearers('even', SAMPLE).map((p) => p.slug);
  assert.deepEqual(bearers, ['a', 'b', 'c']);
});

test('overhead "none" charges nobody', () => {
  assert.deepEqual(overheadBearers('none', SAMPLE), []);
});

test('an unknown apportionment rule falls back to "active"', () => {
  const bearers = overheadBearers('nonsense', SAMPLE).map((p) => p.slug);
  assert.deepEqual(bearers, ['a', 'b']);
});
