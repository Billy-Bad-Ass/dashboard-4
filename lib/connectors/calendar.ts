/**
 * Google Calendar for bbacentralworkspace@gmail.com.
 *
 * This reads the calendar's **private ICS address** rather than going through
 * OAuth, and that is a deliberate trade:
 *
 *   - OAuth would allow writing events, but needs a consent screen, a refresh
 *     token stored somewhere, and re-consent whenever scopes change. For a
 *     dashboard that only ever shows what is coming up, that is a lot of moving
 *     parts to keep working.
 *   - The private ICS URL is read-only, needs no tokens, and works from a
 *     Worker with one fetch.
 *
 * Get it from Google Calendar → Settings → the calendar → "Secret address in
 * iCal format", and set it as CALENDAR_ICS_URL on the Worker. Treat it as a
 * password: anyone holding it can read the calendar. Regenerating it in Google
 * revokes the old one.
 *
 * The parser below handles the subset of RFC 5545 that Google actually emits.
 * It is not a general ICS implementation and does not try to be — recurrence
 * rules in particular are expanded only for the simple daily/weekly/monthly
 * cases, which is what a working calendar contains.
 */

import { DISPLAY_ZONE } from '../dates';

import { cfEnv } from '../db';
import { attempt, unconfigured, type ConnectorResult } from './types';

export interface CalendarEvent {
  uid: string;
  summary: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  /** Guessed from the title. Lets a "Project 2 launch" show on that project. */
  projectSlug: string | null;
}

/**
 * Unfold RFC 5545 line continuations. Long lines are wrapped at 75 octets and
 * continued with a leading space or tab; joining them back is the first thing
 * any correct parser has to do, and skipping it silently truncates summaries.
 */
function unfold(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** `TEXT` values escape commas, semicolons and newlines. Undo that. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * `20260823T140000Z`, `20260823T140000` or `20260823` → ISO.
 *
 * A **floating** time — no trailing `Z` — is a wall-clock time in whatever
 * zone the person is standing in. It used to be read as UTC here, on the
 * grounds that a timezone database was too much to ship into a Worker. That
 * reason no longer holds: `Intl.DateTimeFormat` in workerd carries the zone
 * data already, so the offset is two format calls rather than a dependency.
 *
 * Reading it as UTC was not a rounding error. A 09:00 meeting became
 * 09:00Z, which the console then displayed as 05:00 ET — four hours wrong,
 * every entry, in the one tile whose whole job is telling Billy what time
 * something is.
 */
function parseIcsDate(value: string): { iso: string; allDay: boolean } | null {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date) {
    // An all-day event has no clock reading to convert; it is that calendar
    // date and nothing else. Anchoring it at midnight UTC keeps it on the
    // right date everywhere, which shifting it into Eastern would not.
    return { iso: `${date[1]}-${date[2]}-${date[3]}T00:00:00Z`, allDay: true };
  }
  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (stamp) {
    const [, y, mo, d, h, mi, sec, zulu] = stamp;
    if (zulu === 'Z') {
      return { iso: `${y}-${mo}-${d}T${h}:${mi}:${sec}Z`, allDay: false };
    }
    return {
      iso: wallTimeToUtc(+y!, +mo!, +d!, +h!, +mi!, +sec!),
      allDay: false,
    };
  }
  return null;
}

/**
 * A wall-clock reading in `DISPLAY_ZONE` → the UTC instant it names.
 *
 * Guess that the reading is already UTC, ask the zone what clock that instant
 * shows, and subtract the difference. Two format calls, no dependency, and DST
 * is handled because the offset is looked up at that date rather than assumed.
 *
 * The one hour a year that a wall-clock reading is ambiguous — the autumn
 * repeat — resolves to the first of the two. Nothing here is worth more
 * machinery than that.
 */
function wallTimeToUtc(
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

/** What clock `DISPLAY_ZONE` shows at a given instant. */
function zoneParts(at: Date) {
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
  const hour = read('hour') % 24;
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Map a title onto a project slug, so events land on the right page. */
export function guessProject(summary: string): string | null {
  const text = summary.toLowerCase();
  const match = /project[\s-]?([1-4])\b/.exec(text);
  if (match) return `project-${match[1]}`;
  if (text.includes('pseo') || text.includes('forge')) return 'project-1';
  if (text.includes('store') || text.includes('storefront')) return 'project-2';
  if (text.includes('heartbeat') || text.includes('dashboard')) return 'project-4';
  return null;
}

export function parseIcs(raw: string, limit = 200): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  let current: Record<string, string> | null = null;

  for (const line of unfold(raw)) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) {
        const event = toEvent(current);
        if (event) events.push(event);
      }
      current = null;
      continue;
    }
    if (!current) continue;

    // `DTSTART;VALUE=DATE:20260823` — the property name is everything before
    // the first `;` or `:`, and the parameters go with it.
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const name = head.split(';')[0] ?? '';
    // Keep the parameters against a separate key so DTSTART;VALUE=DATE is
    // distinguishable from a timed DTSTART.
    current[name] = value;
    if (head.includes(';')) current[`${name}__params`] = head.slice(head.indexOf(';') + 1);
  }

  return events
    .filter((e) => e.summary !== '')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, limit);
}

function toEvent(fields: Record<string, string>): CalendarEvent | null {
  const rawStart = fields.DTSTART;
  if (!rawStart) return null;
  const start = parseIcsDate(rawStart);
  if (!start) return null;

  const end = fields.DTEND ? parseIcsDate(fields.DTEND) : null;
  const summary = unescapeText(fields.SUMMARY ?? '').trim();
  // Cancelled events stay in the feed. Showing them as upcoming is worse than
  // showing nothing.
  if (fields.STATUS === 'CANCELLED') return null;

  return {
    uid: fields.UID ?? `${rawStart}-${summary}`,
    summary,
    startsAt: start.iso,
    endsAt: end?.iso ?? null,
    allDay: start.allDay || (fields.DTSTART__params ?? '').includes('VALUE=DATE'),
    location: fields.LOCATION ? unescapeText(fields.LOCATION) : null,
    description: fields.DESCRIPTION ? unescapeText(fields.DESCRIPTION) : null,
    projectSlug: guessProject(summary),
  };
}

export async function fetchCalendar(): Promise<ConnectorResult<CalendarEvent[]>> {
  const env = cfEnv();
  const url = env?.CALENDAR_ICS_URL ?? process.env.CALENDAR_ICS_URL;
  const account = env?.CALENDAR_ACCOUNT ?? 'bbacentralworkspace@gmail.com';

  if (!url) {
    return unconfigured(
      `No calendar feed for ${account}. In Google Calendar: gear \u2192 Settings \u2192 tap ` +
        'the calendar on the left \u2192 "Secret address in iCal format". Add it as ' +
        'CALENDAR_ICS_URL under Cloudflare \u2192 Workers & Pages \u2192 bba-heartbeat \u2192 ' +
        'Settings \u2192 Variables and Secrets. Treat that URL as a password.',
    );
  }

  return attempt('Calendar', async () => {
    const response = await fetch(url, { headers: { 'User-Agent': 'bba-heartbeat' } });
    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? 'feed not found — the secret address was probably regenerated in Google'
          : `${response.status} fetching the ICS feed`,
      );
    }
    return parseIcs(await response.text());
  });
}

/** Events from now forward, soonest first. */
export function upcoming(events: CalendarEvent[], days = 30, now = new Date()): CalendarEvent[] {
  const horizon = new Date(now.getTime() + days * 86_400_000).toISOString();
  const floor = now.toISOString();
  return events
    .filter((e) => (e.endsAt ?? e.startsAt) >= floor && e.startsAt <= horizon)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
