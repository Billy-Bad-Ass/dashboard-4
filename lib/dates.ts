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

/** Human date for display: `23 Aug 2026`. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
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
