import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatTime, easternDate, DISPLAY_ZONE, DISPLAY_ZONE_LABEL } from '../lib/dates.ts';

test('the display zone is Eastern and nothing else', () => {
  assert.equal(DISPLAY_ZONE, 'America/New_York');
  assert.equal(DISPLAY_ZONE_LABEL, 'ET');
});

test('a time is rendered in Eastern and says so', () => {
  // 13:00Z on an August day is 09:00 EDT.
  assert.equal(formatTime('2026-08-26T13:00:00Z'), '09:00 ET');
});

test('a time follows the DST change rather than assuming an offset', () => {
  // 14:00Z in December is 09:00 EST.
  assert.equal(formatTime('2026-12-15T14:00:00Z'), '09:00 ET');
});

test('a date late in the UTC day is shown as the Eastern date, not the UTC one', () => {
  // 02:00Z on the 26th is still the evening of the 25th in Eastern. Showing
  // "26 Aug" for something that happened on Billy's 25th is the whole reason
  // this conversion exists.
  assert.equal(formatDate('2026-08-26T02:00:00Z'), '25 Aug 2026');
});

test('an empty value stays a dash rather than becoming an epoch date', () => {
  assert.equal(formatDate(null), '—');
  assert.equal(formatTime(null), '');
});

/**
 * The regression this file exists for after the first attempt: a stored
 * calendar date is not an instant, and converting it into Eastern moved every
 * ledger row a day back.
 */
test('a stored calendar date renders the day it names, not a day earlier', () => {
  assert.equal(formatDate('2026-08-25'), '25 Aug 2026');
  assert.equal(formatDate('2026-01-01'), '1 Jan 2026');
  assert.equal(formatDate('2026-12-31'), '31 Dec 2026');
});

test('a timestamp is still read as an instant and shown as the Eastern day', () => {
  // 01:00Z on the 26th is nine in the evening on the 25th, in Eastern.
  assert.equal(formatDate('2026-08-26T01:00:00Z'), '25 Aug 2026');
});

test('easternDate gives the day Billy is actually in', () => {
  assert.equal(easternDate('2026-08-26T01:00:00Z'), '2026-08-25');
  assert.equal(easternDate('2026-08-26T13:00:00Z'), '2026-08-26');
  // Winter, where the offset is five rather than four.
  assert.equal(easternDate('2026-12-15T04:30:00Z'), '2026-12-14');
});

test('a grouping key round-trips through formatDate unchanged', () => {
  const key = easternDate('2026-08-26T01:00:00Z');
  assert.equal(formatDate(key), '25 Aug 2026');
});
