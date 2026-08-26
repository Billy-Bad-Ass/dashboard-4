import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, guessProject, upcoming } from '../lib/connectors/calendar.ts';

/** A feed shaped the way Google actually emits one. */
const FEED = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
BEGIN:VEVENT
DTSTART:20260901T140000Z
DTEND:20260901T150000Z
UID:abc123@google.com
SUMMARY:Project 2 launch review
LOCATION:Zoom
DESCRIPTION:Check the Stripe products are live\\nand the PDFs are in R2
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260905
DTEND;VALUE=DATE:20260906
UID:allday@google.com
SUMMARY:Invoicing day
END:VEVENT
BEGIN:VEVENT
DTSTART:20260910T090000Z
UID:cancelled@google.com
SUMMARY:Cancelled thing
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
DTSTART:20260912T100000Z
UID:folded@google.com
SUMMARY:A summary long enough that Google wraps it at seventy-five octets and c
 ontinues it on the next line
END:VEVENT
END:VCALENDAR`;

test('parses timed events into ISO stamps', () => {
  const events = parseIcs(FEED);
  const launch = events.find((e) => e.uid === 'abc123@google.com');
  assert.ok(launch);
  assert.equal(launch.startsAt, '2026-09-01T14:00:00Z');
  assert.equal(launch.endsAt, '2026-09-01T15:00:00Z');
  assert.equal(launch.allDay, false);
  assert.equal(launch.location, 'Zoom');
});

test('unescapes newlines in TEXT values', () => {
  const launch = parseIcs(FEED).find((e) => e.uid === 'abc123@google.com');
  assert.ok(launch?.description?.includes('\n'));
  assert.ok(!launch?.description?.includes('\\n'));
});

test('recognises all-day events from VALUE=DATE', () => {
  const day = parseIcs(FEED).find((e) => e.uid === 'allday@google.com');
  assert.ok(day);
  assert.equal(day.allDay, true);
  assert.equal(day.startsAt, '2026-09-05T00:00:00Z');
});

test('drops cancelled events', () => {
  // Cancelled entries stay in the feed. Showing one as upcoming is worse than
  // showing nothing at all.
  const events = parseIcs(FEED);
  assert.equal(events.find((e) => e.uid === 'cancelled@google.com'), undefined);
});

test('unfolds continuation lines', () => {
  // RFC 5545 wraps long lines and continues them with a leading space. Not
  // rejoining them silently truncates the summary at 75 characters.
  const folded = parseIcs(FEED).find((e) => e.uid === 'folded@google.com');
  assert.ok(folded);
  assert.ok(folded.summary.endsWith('continues it on the next line'));
  assert.ok(!folded.summary.includes('\n'));
});

test('returns events sorted by start time', () => {
  const events = parseIcs(FEED);
  const starts = events.map((e) => e.startsAt);
  assert.deepEqual(starts, [...starts].sort());
});

test('an empty or malformed feed yields no events rather than throwing', () => {
  assert.deepEqual(parseIcs(''), []);
  assert.deepEqual(parseIcs('not an ics file at all'), []);
  assert.deepEqual(parseIcs('BEGIN:VEVENT\nSUMMARY:No start date\nEND:VEVENT'), []);
});

test('guessProject maps titles onto project slugs', () => {
  assert.equal(guessProject('Project 2 launch review'), 'project-2');
  assert.equal(guessProject('project-3 kickoff'), 'project-3');
  assert.equal(guessProject('pSEO Forge dataset check'), 'project-1');
  assert.equal(guessProject('Storefront copy pass'), 'project-2');
  assert.equal(guessProject('Heartbeat dashboard review'), 'project-4');
  assert.equal(guessProject('Dentist'), null);
});

test('upcoming filters to the window and keeps events still in progress', () => {
  const now = new Date('2026-09-01T14:30:00Z');
  const events = parseIcs(FEED);
  const next = upcoming(events, 30, now);

  // The launch started half an hour ago but has not ended — still "upcoming".
  assert.ok(next.some((e) => e.uid === 'abc123@google.com'));
  assert.ok(next.some((e) => e.uid === 'allday@google.com'));

  // Nothing beyond the horizon.
  const narrow = upcoming(events, 2, now);
  assert.ok(!narrow.some((e) => e.uid === 'folded@google.com'));
});

/**
 * A floating DTSTART — no trailing Z — is a wall-clock reading in Billy's own
 * zone, not UTC. Reading it as UTC put every such event four hours early on
 * the one tile whose job is saying what time something is.
 */
const FLOATING_FEED = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20260826T090000
UID:floating-summer@google.com
SUMMARY:Nine in the morning, in August
END:VEVENT
BEGIN:VEVENT
DTSTART:20261215T090000
UID:floating-winter@google.com
SUMMARY:Nine in the morning, in December
END:VEVENT
END:VCALENDAR`;

test('a floating time is Eastern, not UTC — summer', () => {
  const [event] = parseIcs(FLOATING_FEED);
  // 09:00 EDT is 13:00Z. Read as UTC it would have been 09:00Z, which the
  // console renders as 05:00 ET.
  assert.equal(event?.startsAt, '2026-08-26T13:00:00Z');
  assert.equal(event?.allDay, false);
});

test('a floating time follows the DST change — winter', () => {
  const event = parseIcs(FLOATING_FEED)[1];
  // 09:00 EST is 14:00Z. A fixed -4 offset would have got this an hour wrong.
  assert.equal(event?.startsAt, '2026-12-15T14:00:00Z');
});

test('an explicit Z is still absolute and is not shifted', () => {
  const [event] = parseIcs(FEED);
  assert.equal(event?.startsAt, '2026-09-01T14:00:00Z');
});

test('an all-day event keeps its date rather than being shifted into a zone', () => {
  const allDay = parseIcs(FEED).find((e) => e.allDay);
  assert.equal(allDay?.startsAt.slice(0, 10), '2026-09-05');
});
