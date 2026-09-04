/**
 * BBA Production's enquiry funnel.
 *
 * The one thing on this dashboard that reads from a database it does not own.
 * The public site and the enquiry form at production.bbanetwork.org are a
 * separate Worker with its own D1 (`bba-production`), and the alternative to
 * reading it here was to have that Worker post its counts in — a second
 * credential to distribute, rotate and eventually lose, for a number it is
 * cheaper to go and fetch. A read-only second binding has no secret in it.
 *
 * The binding is optional, and that is deliberate rather than lax: `npm run
 * dev`, a CI typecheck and a preview build all run without it, and none of them
 * should show BBA Production's tiles as zero. Absent binding means unknown, and
 * `null` is how this file says so. A binding that answers with no rows means
 * nobody has enquired yet, which is a measurement, and that one really is zero.
 */

import { cfEnv } from './db';

export interface EnquirySnapshot {
  /** Everything the form has ever taken. */
  total: number;
  /**
   * Still marked NEW — nobody has replied.
   *
   * This is the number the tile exists for. An enquiry is somebody asking to
   * buy something; one sitting unread is the whole funnel stopped, and until
   * now the only way to find out was to query the database by hand.
   */
  unanswered: number;
  /** UTC stamp of the most recent enquiry, or null when there are none. */
  lastAt: string | null;
}

interface CountRow {
  total: number;
  unanswered: number | null;
  last_at: string | null;
}

/** Read the funnel, or null when there is no binding to read it through. */
export async function loadEnquiries(): Promise<EnquirySnapshot | null> {
  const db = cfEnv()?.PRODUCTION_DB ?? null;
  if (!db) return null;

  const { results } = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'NEW' THEN 1 ELSE 0 END) AS unanswered,
              MAX(created_at) AS last_at
         FROM enquiries`,
    )
    .all<CountRow>();

  const row = results?.[0];
  if (!row) return null;

  return {
    total: row.total,
    // SUM over no rows is NULL in SQLite, not 0. COUNT already told us the
    // table is empty, so this coalesces rather than reporting unknown.
    unanswered: row.unanswered ?? 0,
    lastAt: row.last_at,
  };
}
