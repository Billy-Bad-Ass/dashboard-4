import test from 'node:test';
import assert from 'node:assert/strict';

import {
  composeFirstEmail,
  configProblems,
  hostOf,
  openerFrom,
  optOutLine,
  outreachConfig,
  type OutreachConfig,
} from '../lib/outreach';

/**
 * What is worth testing here is the refusals.
 *
 * Composing a plausible email is easy and a wrong one is obvious the moment a
 * human reads the draft. The expensive failures are the silent ones: an email
 * that goes out missing the footer the law requires, an email that opens with
 * a fact about a site nobody could actually audit, or a second copy of a
 * message somebody already sent.
 */

const CONFIGURED: Record<string, string> = {
  sender_name: 'Billy',
  sender_email: 'billy@example.com',
  postal_address: '1 Example Street, Fairfax VA 22030',
  opt_out_reply: "Reply 'no thanks' and I'll delete your address.",
};

test('a complete settings table configures outreach', () => {
  assert.deepEqual(configProblems(CONFIGURED), []);
  assert.notEqual(outreachConfig(CONFIGURED), null);
});

test('every missing setting is named individually', () => {
  const problems = configProblems({});
  assert.equal(problems.length, 4);
  // The cron report is read by the person who has to go and set these, so each
  // one has to say which key and why — not "outreach is not configured".
  assert.ok(problems.some((p) => p.startsWith('sender_name')));
  assert.ok(problems.some((p) => p.startsWith('sender_email')));
  assert.ok(problems.some((p) => p.startsWith('postal_address')));
  assert.ok(problems.some((p) => p.startsWith('opt_out_url or opt_out_reply')));
});

test('no postal address means no config at all, not a config without a footer', () => {
  const { postal_address: _dropped, ...rest } = CONFIGURED;
  assert.equal(outreachConfig(rest), null);
});

test('whitespace is not a postal address', () => {
  // A settings row someone cleared by putting a space in it must read as unset.
  assert.equal(outreachConfig({ ...CONFIGURED, postal_address: '   ' }), null);
});

test('either opt-out method satisfies the requirement, and the link wins', () => {
  const { opt_out_reply: _dropped, ...noReply } = CONFIGURED;
  assert.deepEqual(configProblems({ ...noReply, opt_out_url: 'https://example.com/stop' }), []);

  const both = outreachConfig({ ...CONFIGURED, opt_out_url: 'https://example.com/stop' })!;
  assert.equal(both.compliance.optOut.kind, 'url');
  // One click beats composing a reply and hoping somebody reads it.
  assert.ok(optOutLine(both.compliance.optOut).includes('https://example.com/stop'));
});

test('the opener is read back out of the note the sync wrote', () => {
  const note =
    'Opportunity 63 / health 61. Opener: the phone number cannot be tapped on a phone. ' +
    'Also: page code unusually heavy. 5 findings.';
  assert.equal(openerFrom(note), 'the phone number cannot be tapped on a phone');
});

test('an unauditable prospect has no opener, so it gets no draft', () => {
  // These three notes are what lib/prospects.ts writes when the engine could
  // not read the site, or read it and found nothing. Opening an email to any
  // of them would mean opening with a pleasantry.
  assert.equal(openerFrom('Unauditable: the fetch failed outright on 2026-08-24. No findings.'), null);
  assert.equal(
    openerFrom('Unauditable: the site answered HTTP 403 to the audit engine.'),
    null,
  );
  assert.equal(openerFrom('Audited clean: no findings at all.'), null);
  assert.equal(openerFrom(null), null);
  assert.equal(openerFrom(''), null);
});

test('a note a human rewrote by hand yields no opener', () => {
  // Deliberate: a note somebody edited is not a place to mine sales copy from.
  assert.equal(openerFrom('Called them. Ask for Dana, she handles the website.'), null);
});

test('the host is what the reader calls their own site', () => {
  assert.equal(hostOf('https://www.allheartdentalcare.com/', 'x'), 'allheartdentalcare.com');
  assert.equal(hostOf('http://macalikdds.com/contact', 'x'), 'macalikdds.com');
  // A malformed website column must not put "https://" in the subject line.
  assert.equal(hostOf('www.example.com/page', 'x'), 'example.com');
  assert.equal(hostOf(null, 'fallback.com'), 'fallback.com');
});

const CONFIG = outreachConfig(CONFIGURED) as OutreachConfig;

test('the email carries all three things the law requires', () => {
  const { body } = composeFirstEmail(
    'allheartdentalcare.com',
    'the phone number cannot be tapped on a phone',
    CONFIG,
  );

  assert.ok(body.includes('Billy'), 'who is sending');
  assert.ok(body.includes('billy@example.com'), 'how to reach them');
  assert.ok(body.includes('1 Example Street, Fairfax VA 22030'), 'a real postal address');
  assert.ok(body.includes("Reply 'no thanks'"), 'a way to opt out');
});

test('the email opens with the specific finding, in the subject and the first line', () => {
  const { subject, body } = composeFirstEmail(
    'macalikdds.com',
    'the page has no main heading',
    CONFIG,
  );

  assert.equal(subject, 'Something I noticed on macalikdds.com');
  const firstLines = body.split('\n').slice(0, 3).join(' ');
  assert.ok(firstLines.includes('the page has no main heading'));
  assert.ok(firstLines.includes('macalikdds.com'));
});

test('it never promises an attachment it cannot carry', () => {
  // The Apps Script drafter takes a recipient, a subject and a body. Nothing
  // else. sitecheck-1's own draft offers an attached report because it writes
  // to a file a human attaches; this route has no such step, and a promise
  // nobody can keep is one a human has to remember to keep every single time.
  const { body } = composeFirstEmail('example.com', 'the page loads slowly', CONFIG);
  assert.ok(!/attach/i.test(body), body);
});

test('it promises exactly one email, and does not chase', () => {
  const { body } = composeFirstEmail('example.com', 'the page loads slowly', CONFIG);
  assert.ok(body.includes("only email you'll get from me unless you reply"));
});

test('a finding that starts mid-sentence is not shouted', () => {
  const { body } = composeFirstEmail('example.com', 'Images have no text alternative', CONFIG);
  assert.ok(body.includes('noticed images have no text alternative'), body);
});

test('a finding that is capitalised in its own right keeps its capitals', () => {
  // "HTTPS is not enabled" must not become "hTTPS is not enabled".
  const { body } = composeFirstEmail('example.com', 'HTTPS is not enabled', CONFIG);
  assert.ok(body.includes('noticed HTTPS is not enabled'), body);
});

test('the provenance line names their own site, not a generic one', () => {
  const { body } = composeFirstEmail('macalikdds.com', 'the page loads slowly', CONFIG);
  assert.ok(body.includes('because macalikdds.com is listed publicly'));
});
