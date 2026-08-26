/**
 * Date handling. Everything stored is an ISO-8601 UTC string; everything
 * displayed is Eastern. These helpers are the only place that conversion
 * happens, which is what makes the rule enforceable rather than aspirational.
 *
 * The two halves are deliberate and must not be collapsed:
 *
 *  - **Stored UTC.** `isoDate` and `isoStamp` stay UTC because cron
 *    expressions, GitHub Actions, Cloudflare triggers and every timestamp in
 *    D1 are UTC. Rewriting stored values into a zone that shifts twice a year
 *    is how a ledger silently gains and loses an hour.
 *  - **Displayed Eastern.** Billy is in the United States, Eastern. A time on
 *    screen with no zone attached is a time somebody will act on at the wrong
 *    hour, so `formatTime` names the zone rather than leaving it implied.
 */

/** The one timezone anything on screen is allowed to be in. */
export const DISPLAY_ZONE = 'America/New_York';

/** Shown next to a time so nobody has to guess. */
export const DISPLAY_ZONE_LABEL = 'ET';

/** What clock `DISPLAY_ZONE` shows at a given instant. */
export function zoneParts(at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // en-US with hour12:false renders midnight as 24; Date.UTC wants 0.
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

/**
 * The Eastern calendar date an instant falls on: `2026-08-26T01:00:00Z` →
 * `2026-08-25`, because 01:00Z is nine in the evening the day before.
 *
 * Slicing the first ten characters off an ISO string gives the *UTC* date, and
 * for the five hours a night when those two disagree it files an evening event
 * under tomorrow and pre-fills a form with a day that has not started.
 */
export function easternDate(input: string | Date = new Date()): string {
  const at = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(at.getTime())) return '';
  const p = zoneParts(at);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * A wall-clock reading in `DISPLAY_ZONE` → the UTC instant it names.
 *
 * Guess that the reading is already UTC, ask the zone what clock that instant
 * shows, and subtract the difference. Two format calls, no dependency, and DST
 * is handled because the offset is looked up at that date rather than assumed.
 *
 * The one hour a year a wall-clock reading is ambiguous — the autumn repeat —
 * resolves to the first of the two.
 */
export function wallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): string {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const shown = zoneParts(new Date(asUtc));
  const shownAsUtc = Date.UTC(
    shown.year,
    shown.month - 1,
    shown.day,
    shown.hour,
    shown.minute,
    shown.second,
  );
  return new Date(asUtc - (shownAsUtc - asUtc)).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** `2026-08-23T14:07:00Z` → `2026-08-23`. */
export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function isoStamp(d: Date = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export function startOfMonth(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * "2 hours ago", "in 3 days". Returns "just now" inside a minute rather than
 * "0 minutes ago", and never says "in 0 days".
 */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'never';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'unknown';

  const deltaMs = then.getTime() - now.getTime();
  const future = deltaMs > 0;
  const abs = Math.abs(deltaMs);

  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [86_400_000 * 365, 'year'],
    [86_400_000 * 30, 'month'],
    [86_400_000 * 7, 'week'],
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
  ];

  if (abs < 60_000) return future ? 'in a moment' : 'just now';

  for (const [ms, unit] of units) {
    if (abs >= ms) {
      const value = Math.round(abs / ms);
      return future ? `in ${value} ${plural(unit, value)}` : `${value} ${plural(unit, value)} ago`;
    }
  }
  return future ? 'soon' : 'just now';
}

function plural(unit: string, n: number): string {
  return n === 1 ? unit : `${unit}s`;
}

/**
 * Human date for display: `23 Aug 2026`.
 *
 * Two different things arrive here and they must not be treated alike:
 *
 *  - **An instant** (`2026-08-26T01:00:00Z`) is a moment in time, and the day
 *    it falls on depends on where you are standing. Converted to Eastern.
 *  - **A calendar date** (`2026-08-26`) is a ledger date, an invoice date, a
 *    next-action date. It names a day and carries no clock reading, so there
 *    is nothing to convert — and converting it anyway moves it. `new Date()`
 *    reads a bare date as midnight UTC, which in Eastern is 8pm the evening
 *    before, so every stored date would render a day early.
 *
 * That second case is not hypothetical: it shipped, and put every row on the
 * finance page one day back.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';

  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (bare) {
    // Render the day it names, in no zone at all.
    const named = new Date(Date.UTC(+bare[1]!, +bare[2]! - 1, +bare[3]!));
    return named.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: DISPLAY_ZONE,
  });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const clock = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: DISPLAY_ZONE,
  });
  return `${clock} ${DISPLAY_ZONE_LABEL}`;
}
