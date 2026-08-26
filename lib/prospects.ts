/**
 * Prospects, synced from the audit engine in sitecheck-1.
 *
 * Project 1's gate is "find prospects at a rate that outpaces the ones you
 * burn", and the finding machine for that already exists — it lives in
 * `Billy-Bad-Ass/sitecheck-1`, runs on GitHub Actions because discovery needs
 * the live network, and publishes its results to a branch called `live-data`.
 *
 * What it published sat in that branch for two days before anybody looked. That
 * is the problem this module solves: a prospect nobody can see is the same as
 * no prospect. The sync pulls each audit into the `clients` table as a real
 * CRM row, so it shows up on /clients, on Project 1's page, in the "People you
 * can email" card, and in anything /ask can answer.
 *
 * Deliberately one-directional. This writes prospects in; it never writes back
 * to sitecheck-1, and it never overwrites a row a human has since worked on.
 */

import { execute, query, queryOne } from './db';
import { isoDate } from './dates';

/** Where the audit engine publishes. A branch, not a release — it is replaced wholesale each run. */
const AUDITS_URL =
  'https://raw.githubusercontent.com/Billy-Bad-Ass/sitecheck-1/live-data/audits-all.json';

/** The shape sitecheck-1 writes. Only the fields this side actually uses. */
interface PublishedAudit {
  url: string;
  finalUrl?: string | null;
  error?: string | null;
  status?: number | null;
  loadMs?: number | null;
  healthScore?: number | null;
  opportunityScore?: number | null;
  findings?: { severity?: string; title?: string; message?: string }[];
}

export interface SyncResult {
  fetched: number;
  added: number;
  skipped: number;
  /** Why the sync could not run, when it could not. Never thrown — the cron must survive it. */
  problem: string | null;
}

/**
 * The host, lowercased, without `www.`.
 *
 * This is the identity of a prospect. Two audits of the same practice — one
 * before a redirect and one after — must not become two rows a human then
 * emails twice.
 */
export function hostKey(rawUrl: string): string | null {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return null;
  }
}

/**
 * Opportunity score to the CRM's 1–5 heat.
 *
 * The bands are coarse on purpose. `opportunityScore` is a number the audit
 * engine invented for ranking within one run; carrying its precision into a
 * field a human reads would imply the difference between 47 and 46 means
 * something.
 */
export function heatFor(opportunityScore: number | null | undefined): number {
  const score = opportunityScore ?? 0;
  if (score >= 60) return 3;
  if (score >= 40) return 2;
  return 1;
}

/**
 * The line that goes in the notes field.
 *
 * The whole pitch rests on naming one thing the owner can check on their own
 * phone in ten seconds, so the highest-severity finding leads and the rest
 * follow as context. An unauditable site says so plainly rather than arriving
 * as an empty row that looks like a clean bill of health.
 */
export function noteFor(audit: PublishedAudit): string {
  if (audit.error) {
    return `Unauditable: ${audit.error}. No findings, so there is no opener — a human has to look before this is worth an email.`;
  }
  if (audit.status && audit.status >= 400) {
    return `Unauditable: the site answered HTTP ${audit.status} to the audit engine. Working site, closed door — only a manual look would produce findings.`;
  }

  const findings = audit.findings ?? [];
  if (findings.length === 0) {
    return `Audited clean: no findings at all. Nothing to open an email with, which makes this a bad prospect rather than a good site.`;
  }

  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...findings].sort(
    (a, b) => (rank[a.severity ?? 'low'] ?? 2) - (rank[b.severity ?? 'low'] ?? 2),
  );
  const label = (f: { title?: string; message?: string }) => f.title ?? f.message ?? 'unnamed finding';
  const lead = sorted[0];
  const rest = sorted.slice(1).map(label);

  return [
    `Opportunity ${audit.opportunityScore ?? '—'} / health ${audit.healthScore ?? '—'}.`,
    lead ? `Opener: ${label(lead)}.` : '',
    rest.length > 0 ? `Also: ${rest.join('; ')}.` : '',
    `${findings.length} finding${findings.length === 1 ? '' : 's'}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Pull the published audits in and add the ones we have never seen.
 *
 * Never updates an existing row. Once a prospect is in the CRM a human may have
 * changed its status, added the address, or logged a call — and a nightly job
 * that overwrote that with a two-week-old audit would quietly undo real work.
 * Re-auditing an existing prospect is a separate job that does not exist yet.
 */
export async function syncProspects(
  fetchImpl: typeof fetch = fetch,
): Promise<SyncResult> {
  const empty: SyncResult = { fetched: 0, added: 0, skipped: 0, problem: null };

  let audits: PublishedAudit[];
  try {
    const response = await fetchImpl(AUDITS_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return { ...empty, problem: `audit feed answered HTTP ${response.status}` };
    }
    const parsed: unknown = await response.json();
    if (!Array.isArray(parsed)) return { ...empty, problem: 'audit feed was not a list' };
    audits = parsed as PublishedAudit[];
  } catch (caught) {
    // A branch that has not been published yet, a network blip, a rename — all
    // of them mean "no new prospects today", none of them mean the tick failed.
    return { ...empty, problem: caught instanceof Error ? caught.message : String(caught) };
  }

  let added = 0;
  let skipped = 0;

  for (const audit of audits) {
    const key = hostKey(audit.finalUrl || audit.url);
    if (!key) {
      skipped += 1;
      continue;
    }

    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM clients
        WHERE lower(replace(replace(replace(coalesce(website,''), 'https://', ''), 'http://', ''), 'www.', '')) LIKE ?
           OR lower(name) = ?`,
      [`${key}%`, key],
    );
    if (existing) {
      skipped += 1;
      continue;
    }

    // The business name is deliberately the host. sitecheck-1 keeps real names
    // and addresses in an access-controlled run artifact, not in the public
    // branch this reads, and inventing "All Heart Dental Care" from a domain is
    // exactly the kind of plausible-looking guess this dashboard does not make.
    await execute(
      `INSERT INTO clients (name, website, status, project_slug, source, heat, notes, next_action, next_action_on)
       VALUES (?,?,'prospect','project-1',?,?,?,?,?)`,
      [
        key,
        audit.finalUrl || audit.url,
        'sitecheck-1 audit feed',
        heatFor(audit.opportunityScore),
        noteFor(audit),
        audit.error || (audit.status ?? 200) >= 400
          ? 'Look at the site by hand — the engine could not read it'
          : 'Get the contact address, then send the audit',
        isoDate(),
      ],
    );
    added += 1;
  }

  return { fetched: audits.length, added, skipped, problem: null };
}

export interface ProspectRow {
  id: number;
  name: string;
  website: string | null;
  email: string | null;
  heat: number;
  status: string;
  notes: string | null;
  next_action: string | null;
}

/** Project 1's prospects, hottest first. What `/prospects` and the Ask page read. */
export async function listProspects(limit = 50): Promise<ProspectRow[]> {
  return query<ProspectRow>(
    `SELECT id, name, website, email, heat, status, notes, next_action
       FROM clients
      WHERE project_slug = 'project-1' AND status IN ('prospect','contacted')
      ORDER BY heat DESC, id ASC
      LIMIT ?`,
    [limit],
  );
}
