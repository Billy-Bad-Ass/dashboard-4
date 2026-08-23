import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMoney,
  formatMoneyCompact,
  parseMoney,
  roiPercent,
  formatPercent,
} from '../lib/money.ts';

test('formatMoney renders minor units as major with two decimals', () => {
  // USD is the default: the storefront prices in dollars and Cloudflare bills
  // in dollars, so that is what the business transacts in.
  assert.equal(formatMoney(500), '$5.00');
  assert.equal(formatMoney(1400), '$14.00');
  assert.equal(formatMoney(0), '$0.00');
  assert.equal(formatMoney(1), '$0.01');
  assert.equal(formatMoney(-250), '-$2.50');
});

test('formatMoney honours an explicit currency', () => {
  // Stripe reports the currency of each charge. A GBP charge must not render
  // with a dollar sign just because the default changed.
  assert.equal(formatMoney(500, 'gbp'), '£5.00');
  assert.equal(formatMoney(500, 'eur'), '€5.00');
  // An unknown currency falls back to its code rather than a wrong symbol.
  assert.equal(formatMoney(500, 'jpy'), 'JPY 5.00');
});

test('formatMoneyCompact keeps small amounts exact', () => {
  // Below $1000 every dollar is worth seeing in full at this stage.
  assert.equal(formatMoneyCompact(500), '$5.00');
  assert.equal(formatMoneyCompact(99_999), '$999.99');
  assert.equal(formatMoneyCompact(150_000), '$1.5k');
  assert.equal(formatMoneyCompact(1_200_000), '$12k');
  assert.equal(formatMoneyCompact(500_000_000), '$5m');
});

test('parseMoney handles the ways a human types an amount', () => {
  assert.equal(parseMoney('5'), 500);
  assert.equal(parseMoney('5.00'), 500);
  assert.equal(parseMoney('$12.50'), 1250);
  assert.equal(parseMoney('£12.50'), 1250);
  assert.equal(parseMoney('1,200'), 120_000);
  assert.equal(parseMoney(' 7.99 '), 799);
});

test('parseMoney avoids the binary-float rounding trap', () => {
  // 19.99 * 100 is 1998.9999999999998 in IEEE 754. A naive implementation
  // truncates this to 1998 and loses a penny on every entry.
  assert.equal(parseMoney('19.99'), 1999);
  assert.equal(parseMoney('0.29'), 29);

  // A sub-penny input is not a representable amount of money. 1.005 is stored
  // as 1.00499999... so it rounds down to £1.00. Either answer is defensible;
  // this pins which one happens so it cannot change silently.
  assert.equal(parseMoney('1.005'), 100);
});

test('parseMoney rejects rubbish rather than guessing', () => {
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney('5.0.0'), null);
});

test('roiPercent is null when nothing has been spent', () => {
  // "No ROI yet" and "0% ROI" are different statements. Returning 0 or Infinity
  // here would put a confident wrong number on the dashboard.
  assert.equal(roiPercent(0, 0), null);
  assert.equal(roiPercent(5000, 0), null);
  assert.equal(roiPercent(0, -100), null);
});

test('roiPercent computes the real ratio once there is spend', () => {
  assert.equal(roiPercent(0, 1000), -100);
  assert.equal(roiPercent(1000, 1000), 0);
  assert.equal(roiPercent(2000, 1000), 100);
  assert.equal(roiPercent(500, 1000), -50);
});

test('formatPercent shows a dash for unknown and a sign for known', () => {
  assert.equal(formatPercent(null), '—');
  assert.equal(formatPercent(Infinity), '—');
  assert.equal(formatPercent(-100), '-100%');
  assert.equal(formatPercent(25), '+25%');
  assert.equal(formatPercent(0), '0%');
});
