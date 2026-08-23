/**
 * The money model.
 *
 * Every ROI, burn and runway figure on the dashboard comes from here, so the
 * arguable decisions are written down rather than scattered through components:
 *
 *  - **Recurring spend is expanded, not multiplied.** A $5/month row that
 *    started in August contributes one $5 occurrence per elapsed month, ending
 *    when `ended_on` says it did. Storing twelve rows a year would work too,
 *    but then cancelling something means editing history.
 *
 *  - **Overhead is apportioned, not hidden.** A Cloudflare bill covering the
 *    whole portfolio is not "Project 2's cost", but it is also not free. It is
 *    split across projects by the `overhead_apportionment` setting, and the
 *    project pages say when a number includes an apportioned share.
 *
 *  - **ROI is null before it is meaningful.** Spend of zero gives `null`, not a
 *    division by zero dressed up as ∞. A project that has spent money and
 *    earned nothing has an ROI of -100%, which is a real and useful number.
 *
 *  - **Revenue is net.** Gross minus refunds minus fees. The number that
 *    reaches a bank account is the only one worth putting on a tile.
 */

import { query, queryOne } from './db';
import { PROJECTS, type Project } from '@/config/portfolio';
import { addDays, isoDate, startOfMonth } from './dates';
import { roiPercent, type Pence } from './money';

export interface SpendRow {
  id: number;
  project_slug: string | null;
  incurred_on: string;
  amount_pence: number;
  currency: string;
  category: string;
  vendor: string;
  note: string | null;
  recurrence: 'once' | 'monthly' | 'yearly';
  ended_on: string | null;
}

export interface RevenueRow {
  id: number;
  project_slug: string;
  received_on: string;
  gross_pence: number;
  fees_pence: number;
  refunded_pence: number;
  currency: string;
  source: string;
  external_id: string | null;
  description: string | null;
}

/** One spend event on one date, after recurring rows have been expanded. */
export interface SpendOccurrence {
  projectSlug: string | null;
  date: string;
  amountPence: Pence;
  category: string;
  vendor: string;
  recurring: boolean;
}

/**
 * Expand a stored spend row into the occurrences that fall inside a window.
 *
 * A monthly row recurs on the same day-of-month as `incurred_on`. Months
 * without that day (the 31st of February) fall back to the last day of the
 * month rather than silently skipping — a subscription does not stop billing
 * because the calendar is awkward.
 */
export function expandSpend(row: SpendRow, from: Date, to: Date): SpendOccurrence[] {
  const start = new Date(row.incurred_on);
  const stop = row.ended_on ? new Date(row.ended_on) : to;
  const last = stop < to ? stop : to;

  const base = {
    projectSlug: row.project_slug,
    amountPence: row.amount_pence,
    category: row.category,
    vendor: row.vendor,
  };

  if (row.recurrence === 'once') {
    if (start < from || start > to) return [];
    return [{ ...base, date: row.incurred_on, recurring: false }];
  }

  const step = row.recurrence === 'yearly' ? 12 : 1;
  const anchorDay = start.getUTCDate();
  const out: SpendOccurrence[] = [];

  // Walk months from whichever is later: the subscription's start, or the
  // window's start. Anchoring the walk to `start` instead would mean a
  // long-running subscription burns the iteration cap on decades nobody asked
  // for and drops the recent charges that were actually wanted.
  const walkFrom = start > from ? start : from;
  let cursor = new Date(Date.UTC(walkFrom.getUTCFullYear(), walkFrom.getUTCMonth(), 1));

  // Capped so a corrupt date cannot spin. 1200 months is a century of billing,
  // which no realistic query window reaches.
  for (let i = 0; i < 1200; i += 1) {
    const daysInMonth = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const occurrence = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), Math.min(anchorDay, daysInMonth)),
    );

    if (occurrence > last) break;
    if (occurrence >= start && occurrence >= from) {
      out.push({ ...base, date: isoDate(occurrence), recurring: true });
    }
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + step, 1));
  }
  return out;
}

export interface Totals {
  spentPence: Pence;
  grossPence: Pence;
  refundedPence: Pence;
  feesPence: Pence;
  /** Gross minus refunds minus fees. The bank-account number. */
  netPence: Pence;
  /** Net revenue minus spend. Negative until a project pays for itself. */
  profitPence: Pence;
  roi: number | null;
}

export interface ProjectFinance extends Totals {
  slug: string;
  /** Spend charged to this project directly, before overhead. */
  directSpendPence: Pence;
  /** This project's share of portfolio-wide overhead. */
  overheadPence: Pence;
  /** Days from project start to its first dollar of net revenue. Null if none. */
  daysToFirstRevenue: number | null;
}

export interface PortfolioFinance extends Totals {
  byProject: ProjectFinance[];
  /** Average monthly spend over the trailing window. */
  monthlyBurnPence: Pence;
  /** Spend since the first of this month. */
  monthToDateSpendPence: Pence;
  /** Net revenue since the first of this month. */
  monthToDateNetPence: Pence;
  /** Which projects the overhead was split across, for the UI to explain it. */
  overheadSharedBy: string[];
  overheadPence: Pence;
}

function emptyTotals(): Totals {
  return {
    spentPence: 0,
    grossPence: 0,
    refundedPence: 0,
    feesPence: 0,
    netPence: 0,
    profitPence: 0,
    roi: null,
  };
}

/**
 * Which projects carry a share of portfolio overhead.
 *
 *   even   — every project that is not paused
 *   active — every project past 'idea' (the default: an unstarted slot should
 *            not make a working project's ROI look worse)
 *   none   — nobody; overhead stays in the portfolio total only
 */
export function overheadBearers(rule: string, projects: Project[] = PROJECTS): Project[] {
  if (rule === 'none') return [];
  if (rule === 'even') return projects.filter((p) => p.stage !== 'paused');
  return projects.filter((p) => p.stage !== 'paused' && p.stage !== 'idea');
}

async function setting(key: string, fallback: string): Promise<string> {
  const row = await queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? fallback;
}

/**
 * The whole money picture, in one query pass.
 *
 * `windowDays` bounds the burn-rate calculation only — lifetime spend and
 * revenue are always lifetime, because a project's ROI does not reset because
 * you changed the date filter.
 */
export async function loadFinance(windowDays = 90): Promise<PortfolioFinance> {
  const now = new Date();
  const epoch = new Date('2000-01-01T00:00:00Z');

  const [spendRows, revenueRows, rule] = await Promise.all([
    query<SpendRow>('SELECT * FROM spend ORDER BY incurred_on'),
    query<RevenueRow>('SELECT * FROM revenue ORDER BY received_on'),
    setting('overhead_apportionment', 'active'),
  ]);

  const occurrences = spendRows.flatMap((row) => expandSpend(row, epoch, now));

  const direct = new Map<string, Pence>();
  let overheadTotal = 0;
  for (const occ of occurrences) {
    if (occ.projectSlug === null) {
      overheadTotal += occ.amountPence;
    } else {
      direct.set(occ.projectSlug, (direct.get(occ.projectSlug) ?? 0) + occ.amountPence);
    }
  }

  const bearers = overheadBearers(rule);
  // Integer split. The remainder goes to the first bearer rather than being
  // dropped, so the per-project shares always add back up to the total.
  const share = bearers.length > 0 ? Math.floor(overheadTotal / bearers.length) : 0;
  const remainder = bearers.length > 0 ? overheadTotal - share * bearers.length : 0;
  const overheadFor = new Map<string, Pence>();
  bearers.forEach((p, i) => overheadFor.set(p.slug, share + (i === 0 ? remainder : 0)));

  const revenueBy = new Map<string, RevenueRow[]>();
  for (const row of revenueRows) {
    const list = revenueBy.get(row.project_slug) ?? [];
    list.push(row);
    revenueBy.set(row.project_slug, list);
  }

  const byProject: ProjectFinance[] = PROJECTS.map((project) => {
    const directSpend = direct.get(project.slug) ?? 0;
    const overhead = overheadFor.get(project.slug) ?? 0;
    const spent = directSpend + overhead;

    const rows = revenueBy.get(project.slug) ?? [];
    const gross = sum(rows, (r) => r.gross_pence);
    const refunded = sum(rows, (r) => r.refunded_pence);
    const fees = sum(rows, (r) => r.fees_pence);
    const net = gross - refunded - fees;

    return {
      slug: project.slug,
      directSpendPence: directSpend,
      overheadPence: overhead,
      spentPence: spent,
      grossPence: gross,
      refundedPence: refunded,
      feesPence: fees,
      netPence: net,
      profitPence: net - spent,
      roi: roiPercent(net, spent),
      daysToFirstRevenue: firstRevenueDays(project, rows),
    };
  });

  const totals = byProject.reduce<Totals>((acc, p) => {
    acc.grossPence += p.grossPence;
    acc.refundedPence += p.refundedPence;
    acc.feesPence += p.feesPence;
    return acc;
  }, emptyTotals());

  // Portfolio spend is the raw occurrence total. Summing the per-project
  // figures would double-count nothing but would silently drop overhead when
  // the rule is 'none', which is exactly when you most want to see it.
  totals.spentPence = occurrences.reduce((a, o) => a + o.amountPence, 0);
  totals.netPence = totals.grossPence - totals.refundedPence - totals.feesPence;
  totals.profitPence = totals.netPence - totals.spentPence;
  totals.roi = roiPercent(totals.netPence, totals.spentPence);

  const windowStart = addDays(now, -windowDays);
  const inWindow = occurrences.filter((o) => new Date(o.date) >= windowStart);
  const windowSpend = inWindow.reduce((a, o) => a + o.amountPence, 0);
  const monthlyBurn = Math.round((windowSpend / windowDays) * 30.44);

  const monthStart = isoDate(startOfMonth(now));
  const mtdSpend = occurrences
    .filter((o) => o.date >= monthStart)
    .reduce((a, o) => a + o.amountPence, 0);
  const mtdNet = revenueRows
    .filter((r) => r.received_on >= monthStart)
    .reduce((a, r) => a + r.gross_pence - r.refunded_pence - r.fees_pence, 0);

  return {
    ...totals,
    byProject,
    monthlyBurnPence: monthlyBurn,
    monthToDateSpendPence: mtdSpend,
    monthToDateNetPence: mtdNet,
    overheadSharedBy: bearers.map((b) => b.slug),
    overheadPence: overheadTotal,
  };
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((acc, row) => acc + pick(row), 0);
}

function firstRevenueDays(project: Project, rows: RevenueRow[]): number | null {
  const earning = rows
    .filter((r) => r.gross_pence - r.refunded_pence > 0)
    .map((r) => r.received_on)
    .sort();
  const first = earning[0];
  if (!first) return null;
  const days = Math.floor(
    (new Date(first).getTime() - new Date(project.startedOn).getTime()) / 86_400_000,
  );
  return Math.max(0, days);
}

/** Net revenue per day over a window, for the portfolio sparkline. */
export async function revenueSeries(days = 30): Promise<{ date: string; netPence: number }[]> {
  const from = isoDate(addDays(new Date(), -days));
  const rows = await query<{ received_on: string; net: number }>(
    `SELECT received_on, SUM(gross_pence - refunded_pence - fees_pence) AS net
       FROM revenue WHERE received_on >= ?
      GROUP BY received_on ORDER BY received_on`,
    [from],
  );
  const byDate = new Map(rows.map((r) => [r.received_on, r.net]));

  const out: { date: string; netPence: number }[] = [];
  for (let i = days; i >= 0; i -= 1) {
    const date = isoDate(addDays(new Date(), -i));
    out.push({ date, netPence: byDate.get(date) ?? 0 });
  }
  return out;
}
