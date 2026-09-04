import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVitals } from '../lib/heartbeat.ts';
import { PROJECTS, type Project } from '../config/portfolio.ts';
import type { ProjectFinance } from '../lib/finance.ts';
import type { EnquirySnapshot } from '../lib/enquiries.ts';

/**
 * BBA Production's enquiry tiles.
 *
 * The funnel starts with somebody filling in a form on a Worker this dashboard
 * does not own, and stops dead if nobody reads it. These tests pin the two ways
 * that tile could lie: reading "0 waiting" when the database was never reached,
 * and reading unknown when it was reached and is genuinely empty.
 */

function producer(): Project {
  return {
    slug: 'project-7',
    name: 'BBA Production',
    tagline: '',
    repo: 'Billy-Bad-Ass/Code',
    stage: 'shipped',
    revenueModel: 'services',
    accent: '#B3245E',
    icon: 'handshake',
    startedOn: '2026-09-03',
    vitals: (['enquiries', 'enquiries_new'] as const).map((key) => ({
      key,
      label: key,
      source: 'ledger' as const,
      unit: 'count' as const,
      target: null,
      hint: '',
    })),
    gates: [],
    reality: '',
  };
}

function finance(): ProjectFinance {
  return {
    slug: 'project-7',
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

function resolve(enquiries: EnquirySnapshot | null) {
  return resolveVitals(producer(), null, finance(), null, new Map(), null, 0, null, enquiries);
}

test('no binding to the production database leaves the enquiry tiles unknown', () => {
  const vitals = resolve(null);

  // The dangerous reading. "0 waiting on you" is the answer somebody acts on by
  // not looking again, and it must never be what an unreachable database says.
  assert.equal(vitals.enquiries, null);
  assert.equal(vitals.enquiries_new, null);
});

test('a reachable but empty funnel is zero, because nobody has enquired', () => {
  const vitals = resolve({ total: 0, unanswered: 0, lastAt: null });

  assert.equal(vitals.enquiries, 0);
  assert.equal(vitals.enquiries_new, 0);
});

test('unanswered is the NEW count, not the total', () => {
  const vitals = resolve({ total: 9, unanswered: 2, lastAt: '2026-09-04T00:00:00Z' });

  assert.equal(vitals.enquiries, 9);
  assert.equal(vitals.enquiries_new, 2);
});

/**
 * The register entry is what makes any of the above reach a page. It was
 * possible to add the connector, the binding and the tiles and still have BBA
 * Production absent from the dashboard entirely — which is the state this whole
 * change exists to end.
 */
test('BBA Production is in the register, with the enquiry tile leading', () => {
  const project = PROJECTS.find((p) => p.slug === 'project-7');
  assert.ok(project, 'BBA Production should be a registered project');
  assert.equal(project.repo, 'Billy-Bad-Ass/Code');
  assert.equal(project.cloudflareScript, 'bba-production-form');
  assert.equal(project.liveUrl, 'https://production.bbanetwork.org');
  assert.equal(
    project.vitals[0]?.key,
    'enquiries_new',
    'the number that means somebody is waiting should be read first',
  );
});
