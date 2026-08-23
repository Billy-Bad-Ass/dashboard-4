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
 * A floating time (no Z, no TZID handling) is treated as UTC. For a one-person
 * business running on one calendar that is close enough; the alternative is
 * shipping a timezone database into a Worker.
 */
function parseIcsDate(value: string): { iso: string; allDay: boolean } | null {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date) {
    return { iso: `${date[1]}-${date[2]}-${date[3]}T00:00:00Z`, allDay: true };
  }
  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(value);
  if (stamp) {
    return {
      iso: `${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:${stamp[6]}Z`,
      allDay: false,
    };
  }
  return null;
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
