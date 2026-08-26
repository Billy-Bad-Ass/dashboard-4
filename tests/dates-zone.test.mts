import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatTime, DISPLAY_ZONE, DISPLAY_ZONE_LABEL } from '../lib/dates.ts';

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
