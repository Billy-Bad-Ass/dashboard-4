import test from 'node:test';
import assert from 'node:assert/strict';
import { hostKey, heatFor, noteFor } from '../lib/prospects.ts';

/**
 * The two ways a prospect sync lies.
 *
 * One: the same practice arrives twice under two spellings of its address and
 * gets emailed twice, which is the single most expensive mistake in cold
 * outreach. Two: a site the engine could not read arrives looking like a site
 * with nothing wrong — an empty findings list rendered as a clean bill of
 * health, which is the unknown-versus-zero rule wearing a different hat.
 */

test('the same host under different spellings is one prospect', () => {
  const keys = [
    'https://www.allheartdentalcare.com/',
    'http://allheartdentalcare.com',
    'https://AllHeartDentalCare.com/contact',
  ].map(hostKey);

  assert.deepEqual(new Set(keys), new Set(['allheartdentalcare.com']));
});

test('an unparseable address yields no key rather than a bad one', () => {
  assert.equal(hostKey('not a url'), null);
  assert.equal(hostKey(''), null);
});

test('heat bands are coarse and never exceed the CRM scale', () => {
  assert.equal(heatFor(63), 3);
  assert.equal(heatFor(60), 3);
  assert.equal(heatFor(47), 2);
  assert.equal(heatFor(25), 1);
  assert.equal(heatFor(0), 1);
  assert.equal(heatFor(null), 1);
  assert.equal(heatFor(undefined), 1);
});

test('an unreachable site says so instead of reading as clean', () => {
  const note = noteFor({ url: 'https://example.com', error: 'fetch failed', findings: [] });
  assert.match(note, /Unauditable/);
  assert.match(note, /fetch failed/);
  assert.doesNotMatch(note, /clean/);
});

test('a site that blocks the engine is distinguished from one that is broken', () => {
  const note = noteFor({ url: 'https://example.com', status: 403, findings: [] });
  assert.match(note, /403/);
  assert.match(note, /Working site/);
});

test('no findings is called a bad prospect, not a good site', () => {
  const note = noteFor({ url: 'https://example.com', status: 200, findings: [] });
  assert.match(note, /bad prospect/);
});

test('the opener is the most severe finding, and the rest follow', () => {
  const note = noteFor({
    url: 'https://example.com',
    status: 200,
    opportunityScore: 63,
    healthScore: 61,
    findings: [
      { severity: 'low', title: 'Shared links have no preview image' },
      { severity: 'high', title: 'The phone number cannot be tapped on a phone' },
      { severity: 'medium', title: 'Form fields are unlabeled' },
    ],
  });

  assert.match(note, /Opener: The phone number cannot be tapped on a phone\./);
  assert.match(note, /Also: Form fields are unlabeled; Shared links have no preview image\./);
  assert.match(note, /3 findings\./);
  assert.match(note, /Opportunity 63 \/ health 61\./);
});

test('one finding is not pluralised', () => {
  const note = noteFor({
    url: 'https://example.com',
    status: 200,
    findings: [{ severity: 'high', title: 'No HTTPS' }],
  });
  assert.match(note, /1 finding\./);
});
