/**
 * When was an agent last *supposed* to run, and did it?
 *
 * The dashboard could always show what an agent reported. It could not show
 * what an agent failed to report, so seven agents sat at "LAST RUN: never"
 * next to a tile reading "FAILURES: 0 — Nothing failing". Both statements were
 * true and together they were a lie: nothing was failing because nothing was
 * reporting.
 *
 * Every scheduled agent carries a cron expression, so the time it should last
 * have fired is arithmetic. Once that is computable, silence stops being an
 * absence of data and becomes a finding with a timestamp on it.
 *
 * The cron dialect here is the one GitHub Actions and Cloudflare accept: five
 * space-separated fields, wildcards, ranges, comma lists and step syntax
 * (see `parsePart` for the grammar — spelling it out here would close this
 * comment early, which is its own small lesson about stripping types).
 * Everything is UTC, like every other stamp in this codebase. Unparseable is
 * `null` — never a guessed schedule, because a wrong "next run" reads exactly
 * like a right one.
 */

export interface CronSpec {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  /** Whether the day-of-month field was narrowed from `*`. */
  domRestricted: boolean;
  /** Whether the day-of-week field was narrowed from `*`. */
  dowRestricted: boolean;
}

interface FieldRange {
  min: number;
  max: number;
}

const MINUTE: FieldRange = { min: 0, max: 59 };
const HOUR: FieldRange = { min: 0, max: 23 };
const DOM: FieldRange = { min: 1, max: 31 };
const MONTH: FieldRange = { min: 1, max: 12 };
const DOW: FieldRange = { min: 0, max: 7 };

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * How far the search walks before giving up. A yearly cron
 * (`0 0 1 1 *`) needs a full year plus a leap day; beyond that the
 * expression is doing something this dashboard should not pretend to model.
 */
const LOOKBACK_DAYS = 400;

/**
 * Grace before a missed fire is called overdue.
 *
 * GitHub's scheduled runs are explicitly best-effort — they queue behind the
 * whole platform and are routinely minutes late, occasionally much later. An
 * hour absorbs that without absorbing a genuinely dead schedule. It is also
 * capped at half the gap between fires below, so a frequent schedule cannot
 * have a grace period longer than its own interval and go unflagged forever.
 */
export const OVERDUE_GRACE_MS = 60 * MS_PER_MINUTE;

/**
 * How long a run may sit in `queued` or `running` before it is treated as
 * stalled rather than in flight. The longest agent timeout in
 * `.github/workflows` is 25 minutes, so anything past an hour is a start that
 * posted and a finish that never did.
 */
export const STALLED_AFTER_MS = 60 * MS_PER_MINUTE;

/** Statuses that mean the run reached an end, whatever the outcome. */
const TERMINAL = new Set(['ok', 'failed', 'skipped']);

/**
 * Parse a five-field cron expression. Returns null for anything this dialect
 * does not cover, including the `@daily` style aliases and the non-standard
 * seconds field — a schedule we cannot read is reported as unreadable.
 */
export function parseCron(expression: string): CronSpec | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];

  const minutes = parseField(minute, MINUTE);
  const hours = parseField(hour, HOUR);
  const daysOfMonth = parseField(dom, DOM);
  const months = parseField(month, MONTH);
  const rawDaysOfWeek = parseField(dow, DOW);
  if (!minutes || !hours || !daysOfMonth || !months || !rawDaysOfWeek) return null;

  // Cron accepts both 0 and 7 for Sunday. JavaScript only knows 0.
  const daysOfWeek = unique(rawDaysOfWeek.map((d) => (d === 7 ? 0 : d)));

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    domRestricted: dom !== '*',
    dowRestricted: dow !== '*',
  };
}

function parseField(field: string, range: FieldRange): number[] | null {
  const values: number[] = [];

  for (const part of field.split(',')) {
    const parsed = parsePart(part, range);
    if (!parsed) return null;
    values.push(...parsed);
  }

  return values.length > 0 ? unique(values) : null;
}

function parsePart(part: string, range: FieldRange): number[] | null {
  const [spec, stepText, ...extra] = part.split('/');
  if (spec === undefined || extra.length > 0) return null;

  let step = 1;
  if (stepText !== undefined) {
    if (!/^\d+$/.test(stepText)) return null;
    step = Number(stepText);
    if (step < 1) return null;
  }

  let from: number;
  let to: number;

  if (spec === '*') {
    from = range.min;
    to = range.max;
  } else if (/^\d+$/.test(spec)) {
    from = Number(spec);
    // `5/10` means "from 5 to the end of the field, every 10" — a bare number
    // with no step is a single value.
    to = stepText === undefined ? from : range.max;
  } else {
    const bounds = spec.split('-');
    if (bounds.length !== 2) return null;
    const [low, high] = bounds as [string, string];
    if (!/^\d+$/.test(low) || !/^\d+$/.test(high)) return null;
    from = Number(low);
    to = Number(high);
  }

  if (from < range.min || to > range.max || from > to) return null;

  const values: number[] = [];
  for (let value = from; value <= to; value += step) values.push(value);
  return values;
}

function unique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * Does this cron match a given UTC day?
 *
 * The one genuinely surprising rule in cron: when *both* day-of-month and
 * day-of-week are narrowed, they are OR'd rather than AND'd, so
 * `0 0 1 * 1` fires on the 1st **and** on every Monday. When only one is
 * narrowed the other is a wildcard and the distinction does not arise.
 */
function dayMatches(spec: CronSpec, date: Date): boolean {
  if (!spec.months.includes(date.getUTCMonth() + 1)) return false;

  const domHit = spec.daysOfMonth.includes(date.getUTCDate());
  const dowHit = spec.daysOfWeek.includes(date.getUTCDay());

  if (spec.domRestricted && spec.dowRestricted) return domHit || dowHit;
  return domHit && dowHit;
}

/**
 * The most recent time this schedule should have fired, at or before `now`.
 * Null when the expression is unreadable or has no match inside the lookback.
 */
export function previousFire(expression: string, now: Date = new Date()): Date | null {
  const spec = parseCron(expression);
  if (!spec) return null;

  const cutoff = floorToMinute(now);

  for (let back = 0; back <= LOOKBACK_DAYS; back += 1) {
    const day = new Date(cutoff.getTime() - back * MS_PER_DAY);
    if (!dayMatches(spec, day)) continue;

    for (let h = spec.hours.length - 1; h >= 0; h -= 1) {
      for (let m = spec.minutes.length - 1; m >= 0; m -= 1) {
        const candidate = atTime(day, spec.hours[h] as number, spec.minutes[m] as number);
        if (candidate.getTime() <= cutoff.getTime()) return candidate;
      }
    }
  }

  return null;
}

/** The next time this schedule fires, strictly after `now`. */
export function nextFire(expression: string, now: Date = new Date()): Date | null {
  const spec = parseCron(expression);
  if (!spec) return null;

  const cutoff = floorToMinute(now);

  for (let ahead = 0; ahead <= LOOKBACK_DAYS; ahead += 1) {
    const day = new Date(cutoff.getTime() + ahead * MS_PER_DAY);
    if (!dayMatches(spec, day)) continue;

    for (const h of spec.hours) {
      for (const m of spec.minutes) {
        const candidate = atTime(day, h, m);
        if (candidate.getTime() > cutoff.getTime()) return candidate;
      }
    }
  }

  return null;
}

function floorToMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE);
}

function atTime(day: Date, hour: number, minute: number): Date {
  return new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute),
  );
}

/**
 * The grace this schedule gets before a missed fire counts.
 *
 * An hour, or half the interval between fires, whichever is smaller. Without
 * the cap a hypothetical every-30-minutes agent would have a grace period
 * twice its own interval and could never be flagged at all.
 */
export function graceFor(expression: string, now: Date = new Date()): number {
  const previous = previousFire(expression, now);
  const next = nextFire(expression, previous ?? now);
  if (!previous || !next) return OVERDUE_GRACE_MS;
  return Math.min(OVERDUE_GRACE_MS, Math.max(MS_PER_MINUTE, (next.getTime() - previous.getTime()) / 2));
}
