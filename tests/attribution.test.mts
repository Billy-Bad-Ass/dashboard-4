import test from 'node:test';
import assert from 'node:assert/strict';
import { projectForCharge, PROJECTS } from '../config/portfolio.ts';

test('the audit takes its own charges', () => {
  const p = projectForCharge({ statementDescriptor: 'BBA NETWORK AUDIT' });
  assert.equal(p?.slug, 'project-1');
});

test('specificity beats declaration order', () => {
  // "BBA NETWORK" is a substring of "BBA NETWORK AUDIT". If the shorter
  // descriptor won, every $100 audit would land on the store's ROI — which is
  // precisely the bug that prompted this function.
  const audit = projectForCharge({ statementDescriptor: 'BBA NETWORK AUDIT' });
  assert.equal(audit?.slug, 'project-1');

  const store = projectForCharge({ statementDescriptor: 'BBA NETWORK' });
  assert.equal(store?.slug, 'project-2');
});

test('a product id wins over any descriptor text', () => {
  const p = projectForCharge({
    statementDescriptor: 'BBA NETWORK',
    productIds: ['prod_V7tZMsJQTM8AMG'],
  });
  assert.equal(p?.slug, 'project-1');
});

test('matching is case and whitespace insensitive', () => {
  assert.equal(projectForCharge({ statementDescriptor: '  bba network audit ' })?.slug, 'project-1');
  assert.equal(projectForCharge({ description: 'Bba Network Audit' })?.slug, 'project-1');
});

test('an unrecognised charge is null, never a guess', () => {
  // The whole point. A charge from a business the register does not know about
  // must not silently improve some other project's ROI.
  assert.equal(projectForCharge({ statementDescriptor: 'SOMETHING ELSE' }), null);
  assert.equal(projectForCharge({ statementDescriptor: '' }), null);
  assert.equal(projectForCharge({}), null);
  assert.equal(projectForCharge({ statementDescriptor: null, description: null }), null);
});

test('only projects that declared a matcher can claim a charge', () => {
  // Projects with no stripeMatch must never absorb revenue by accident.
  const claimable = PROJECTS.filter((p) => p.stripeMatch);
  assert.ok(claimable.length >= 2);
  for (const p of PROJECTS) {
    if (p.stripeMatch) continue;
    const hit = projectForCharge({ statementDescriptor: p.name.toUpperCase() });
    assert.notEqual(hit?.slug, p.slug, `${p.slug} claimed a charge without declaring a matcher`);
  }
});
