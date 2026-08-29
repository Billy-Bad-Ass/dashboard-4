import test from 'node:test';
import assert from 'node:assert/strict';
import { formatVital } from '../lib/vitals.ts';
import { PROJECTS } from '../config/portfolio.ts';

/**
 * `formatVital` moved out of `app/projects/[slug]/page.tsx` on 2026-08-29.
 *
 * It lived there as a private function, which meant the only way to share it
 * with the `Chart` client component was to hand it over as a prop — and a
 * function cannot cross that boundary, so every project page answered 500.
 * The move is the fix; these tests are what stop the move from also being a
 * silent change to what the numbers look like.
 */

test('each unit is written the way its panel expects', () => {
  // Money arrives in minor units, always. 945 is $9.45, not $945.
  assert.equal(formatVital(945, 'gbp'), '$9.45');
  assert.equal(formatVital(0, 'gbp'), '$0.00');
  assert.equal(formatVital(-500, 'gbp'), '-$5.00');

  assert.equal(formatVital(2.5, 'percent'), '2.5%');
  assert.equal(formatVital(0, 'percent'), '0.0%');

  assert.equal(formatVital(1, 'days'), '1d');
  assert.equal(formatVital(1.4, 'days'), '1d');

  assert.equal(formatVital(3, 'count'), '3');
  assert.equal(formatVital(12345, 'count'), '12,345');
});

/**
 * The fallback the project page depends on.
 *
 * A metric row whose key the register no longer describes has no `VitalSpec`,
 * so the page passes `spec?.unit ?? 'count'`. That has to keep counting rather
 * than falling through to the chart's own default, which is money — a retired
 * counter suddenly reading "$7.00" is a wrong number, not a cosmetic one.
 */
test('an undefined unit counts rather than pricing', () => {
  assert.equal(formatVital(7, undefined), '7');
  assert.equal(formatVital(7, 'count'), formatVital(7, undefined));
});

/**
 * Every unit in the register is one the formatter handles.
 *
 * The union makes this true at compile time; this asserts it against the actual
 * data, so a vital added with a unit nobody implemented shows up as a failing
 * test rather than as a number silently formatted as a count.
 */
test('every unit used by a real vital is implemented', () => {
  const implemented = new Set(['gbp', 'count', 'percent', 'days']);
  const used = new Set(PROJECTS.flatMap((p) => p.vitals.map((v) => v.unit)));

  assert.ok(used.size > 0, 'no vitals found — has config/portfolio.ts changed shape?');
  for (const unit of used) {
    assert.ok(implemented.has(unit), `vital unit "${unit}" has no branch in formatVital`);
  }
});
