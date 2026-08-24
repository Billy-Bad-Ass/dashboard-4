/**
 * The heartbeat.
 *
 * One function, `pulse()`, that assembles everything the dashboard shows: live
 * connector reads, the D1 ledger, the CRM, and the derived health verdict for
 * each project.
 *
 * Two properties it is built to have:
 *
 *  - **Never throws.** Every connector is already failure-tolerant; this layer
 *    additionally tolerates D1 being absent. A half-configured deployment
 *    renders a dashboard full of honest "not connected" states, which is the
 *    only version that is useful while you are still wiring it up.
 *
 *  - **Cheap enough to call on every request.** Live reads go through KV with a
 *    short TTL, so a page load costs one KV read rather than four third-party
 *    round trips. The cron trigger writes through that cache, so in normal
 *    operation the page is served from data that is at most ten minutes old and
 *    the API keys are never touched during a request.
 */

import { PROJECTS, projectForCharge, type Project, type Stage } from '@/config/portfolio';
import { getCache, query, execute, hasDatabase } from './db';
import { loadFinance, type PortfolioFinance, type ProjectFinance } from './finance';
import { loadPipeline, type PipelineSummary } from './crm';
import { fetchStripe, type StripeSnapshot } from './connectors/stripe';
import { fetchAllRepoPulses, type RepoPulse } from './connectors/github';
import { fetchCloudflare, type CloudflareSnapshot } from './connectors/cloudflare';
import { fetchCalendar, upcoming, type CalendarEvent } from './connectors/calendar';
import type { ConnectorResult, ConnectorStatus } from './connectors/types';
import { isoStamp } from './dates';

/** Per-repo results, keyed by `owner/name`. */
type RepoBundle = Record<string, ConnectorResult<RepoPulse>>;

/** How long a live read stays warm in KV. Shorter than the fast cron. */
const CACHE_TTL_SECONDS = 300;

export interface ConnectorHealth {
  name: string;
  status: ConnectorStatus;
  detail: string;
  latencyMs: number;
  checkedAt: string;
}

/** The traffic-light verdict for a project. */
export type Health = 'good' | 'watch' | 'stalled' | 'idle';

export interface ProjectPulse {
  project: Project;
  finance: ProjectFinance;
  repo: RepoPulse | null;
  repoStatus: ConnectorStatus;
  /** Values for the project's configured vitals, resolved from every source. */
  vitals: Record<string, number | null>;
  health: Health;
  /** Why the health is what it is. Shown under the badge — no mystery colours. */
  healthReason: string;
  events: CalendarEvent[];
}

export interface Pulse {
  generatedAt: string;
  configured: boolean;
  connectors: ConnectorHealth[];
  finance: PortfolioFinance;
  pipeline: PipelineSummary;
  projects: ProjectPulse[];
  stripe: StripeSnapshot | null;
  cloudflare: CloudflareSnapshot | null;
  events: CalendarEvent[];
  agentRuns: AgentRun[];
  /** Minutes since the cron last completed. Null when it has never run. */
  lastCronMinutes: number | null;
}

export interface AgentRun {
  id: number;
  agent: string;
  project_slug: string | null;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  summary: string | null;
  artifact_url: string | null;
}

/**
 * How long the last-known-good copy survives. Deliberately far longer than the
 * hot entry: its whole job is to still be there when a connector has been down
 * for a while, because week-old traffic numbers beat an error box.
 */
const STALE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** KV rejects an expirationTtl below this outright. It is not a soft floor. */
const KV_MIN_TTL_SECONDS = 60;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A KV read that treats an unreachable cache as a miss rather than a failure. */
async function readJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  try {
    return (await kv.get(key, 'json')) as T | null;
  } catch (error) {
    console.error(`cache read failed for ${key}`, describe(error));
    return null;
  }
}

/**
 * Read through KV, with a last-known-good fallback.
 *
 * Three things here were wrong for the entire life of this function, and every
 * one of them only bit on the cron path — which is why the dashboard looked
 * fine while nothing was being recorded:
 *
 *  - **`ttl === 0` meant "bypass the cache", and did the opposite.** The cron
 *    calls `pulse({ fresh: true })` to go and actually look. The old code still
 *    returned the cached value first, then tried to write with
 *    `expirationTtl: 0` — which KV rejects outright, its documented minimum
 *    being 60. So every connector on every tick threw.
 *  - **The stale key was never written.** The fallback read `${key}:last`,
 *    which nothing had ever put there. The stale-on-failure behaviour this
 *    dashboard claims in three places did not exist.
 *  - **A cache write could fail a successful load.** The `put` sat inside the
 *    try that catches loader errors, so a KV problem discarded good data and
 *    reported the connector as down.
 *
 * And the `catch {}` threw the real error away, which is why the symptom was
 * four identical "loader failed" lines naming no cause. Errors now carry it.
 */
export async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const kv = getCache();
  if (!kv) return load();

  // ttl 0 is the caller saying "go and look". Skip the read, not just the write.
  if (ttl > 0) {
    const hit = await readJson<T>(kv, key);
    if (hit !== null) return hit;
  }

  let fresh: T;
  try {
    fresh = await load();
  } catch (error) {
    const stale = await readJson<T>(kv, `${key}:last`);
    if (stale !== null) return stale;
    throw new Error(`cache miss and loader failed for ${key}: ${describe(error)}`);
  }

  // Caching is an optimisation. It must never turn a load that worked into a
  // connector that reads as down, so its failures are logged and swallowed.
  const body = JSON.stringify(fresh);
  try {
    if (ttl >= KV_MIN_TTL_SECONDS) {
      await kv.put(key, body, { expirationTtl: ttl });
    }
    await kv.put(`${key}:last`, body, { expirationTtl: STALE_TTL_SECONDS });
  } catch (error) {
    console.error(`cache write failed for ${key}`, describe(error));
  }

  return fresh;
}

function health(result: ConnectorResult<unknown>, name: string): ConnectorHealth {
  return {
    name,
    status: result.status,
    detail: result.detail,
    latencyMs: result.latencyMs,
    checkedAt: result.checkedAt,
  };
}

/**
 * Decide whether a project is healthy.
 *
 * The rules are stage-aware on purpose. Judging an unstarted idea by its commit
 * cadence produces a red light on a slot that is red by definition, and a
 * dashboard where everything is red is a dashboard nobody reads.
 */
export function assessHealth(
  project: Project,
  repo: RepoPulse | null,
  finance: ProjectFinance,
): { health: Health; reason: string } {
  if (project.stage === 'paused') {
    return { health: 'idle', reason: 'Paused deliberately.' };
  }
  if (project.stage === 'idea') {
    return { health: 'idle', reason: 'Not started. Nothing to measure yet.' };
  }
  if (!repo || !repo.exists) {
    return { health: 'watch', reason: 'Repository not readable — check the token or the name.' };
  }

  // repo.lastCommitAt is the last commit BY A PERSON. That distinction is the
  // whole point of this check: a project with a cron committing state every few
  // hours would otherwise reset its own clock forever and could never be
  // reported stalled, however long ago its author walked away.
  const daysSinceCommit = repo.lastCommitAt
    ? Math.floor((Date.now() - new Date(repo.lastCommitAt).getTime()) / 86_400_000)
    : null;

  // Said out loud wherever a verdict is given, because "no commits for 40 days"
  // on a repository a bot touched an hour ago reads as a broken check.
  const automated =
    repo.botCommitCount > 0 ? ` Its automation is still running (${repo.botCommitCount} commits).` : '';

  if (repo.ciStatus === 'failure') {
    return { health: 'stalled', reason: 'CI is red on the default branch.' };
  }
  if (daysSinceCommit === null || daysSinceCommit > 21) {
    return {
      health: 'stalled',
      reason:
        (daysSinceCommit === null
          ? 'Nobody has committed in the last 30 days.'
          : `Nobody has committed for ${daysSinceCommit} days.`) + automated,
    };
  }
  // Earning projects are held to a harder standard: money in means the thing
  // is real, so a dip in activity matters more, not less.
  if (project.stage === 'earning' && finance.netPence <= 0) {
    return { health: 'watch', reason: 'Marked as earning but net revenue is not positive.' };
  }
  if (daysSinceCommit > 7) {
    return { health: 'watch', reason: `Last commit by a person ${daysSinceCommit} days ago.${automated}` };
  }
  return { health: 'good', reason: `Active — last commit by a person ${daysSinceCommit} days ago.` };
}

/** Resolve a project's configured vitals from whichever source each names. */
export function resolveVitals(
  project: Project,
  repo: RepoPulse | null,
  finance: ProjectFinance,
  stripe: StripeSnapshot | null,
  stored: Map<string, number>,
  lastCronMinutes: number | null,
  connectorsLive: number,
  cloudflare: CloudflareSnapshot | null = null,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const daysSinceCommit = repo?.lastCommitAt
    ? Math.floor((Date.now() - new Date(repo.lastCommitAt).getTime()) / 86_400_000)
    : null;

  for (const vital of project.vitals) {
    switch (vital.key) {
      // The three below all used to fall back to 0, which is the one thing
      // this codebase is built not to do. With Stripe unconfigured they wrote
      // "$0.00 revenue, 0 units, 0% refunds" — measured-looking figures for an
      // API that had never been contacted. `stripe` being non-null is the test:
      // present means Stripe answered and a zero is real; absent means unknown.
      case 'revenue':
        out[vital.key] =
          project.revenueModel === 'stripe' ? (stripe?.netPence ?? null) : finance.netPence;
        break;
      case 'units':
        out[vital.key] = stripe?.units ?? null;
        break;
      case 'refund_rate':
        // Two distinct unknowns hid behind that 0. No Stripe is one. Stripe
        // with nothing sold yet is the other: a refund rate of 0/0 is
        // undefined, exactly as roiPercent() is undefined on zero spend.
        out[vital.key] =
          stripe && stripe.grossPence > 0
            ? (stripe.refundedPence / stripe.grossPence) * 100
            : null;
        break;
      case 'undelivered':
        // Requires reconciling Stripe sessions against delivery, which lives in
        // Project-2. Until that job reports in, this is unknown, not zero.
        out[vital.key] = stored.get(vital.key) ?? null;
        break;
      case 'commits':
        out[vital.key] = repo?.commitCount ?? null;
        break;
      case 'days_since_commit':
      case 'dataset_age_days':
        out[vital.key] = daysSinceCommit;
        break;
      case 'heartbeat_age_minutes':
        out[vital.key] = lastCronMinutes;
        break;
      case 'connectors_live':
        out[vital.key] = connectorsLive;
        break;
      case 'visitors':
        // Per-script, never the account total: two projects sharing one number
        // would each be shown the other's traffic. A project with no Worker of
        // its own has no answer here, and says so.
        out[vital.key] = project.cloudflareScript
          ? (cloudflare?.byScript.find((s) => s.script === project.cloudflareScript)?.requests ??
            null)
          : null;
        break;
      case 'run_cost':
        out[vital.key] = finance.spentPence;
        break;
      case 'affiliate_revenue':
        out[vital.key] = finance.netPence;
        break;
      default:
        // Anything else comes from the metrics table, written by whatever job
        // owns it. Absent means "nobody has reported this yet".
        out[vital.key] = stored.get(vital.key) ?? null;
    }
  }
  return out;
}

/**
 * The subset of a Stripe snapshot that belongs to one project.
 *
 * With one seller "the whole account" and "this project" were the same thing.
 * With two they are not, and handing the full snapshot to both would show each
 * of them the other's money.
 */
function sliceForProject(
  snapshot: StripeSnapshot | null,
  project: Project,
): StripeSnapshot | null {
  if (!snapshot) return null;

  const mine = snapshot.charges.filter(
    (charge) =>
      projectForCharge({
        statementDescriptor: charge.statementDescriptor,
        description: charge.description,
      })?.slug === project.slug,
  );

  const gross = mine.reduce((a, c) => a + c.amountPence, 0);
  const refunded = mine.reduce((a, c) => a + c.refundedPence, 0);
  const fees = mine.reduce((a, c) => a + c.feePence, 0);

  return {
    ...snapshot,
    charges: mine,
    units: mine.length,
    grossPence: gross,
    refundedPence: refunded,
    feesPence: fees,
    netPence: gross - refunded - fees,
    refundCount: mine.filter((c) => c.refundedPence > 0).length,
  };
}

/** Latest stored value for every metric, keyed `slug:metric`. */
async function latestMetrics(): Promise<Map<string, number>> {
  const rows = await query<{ project_slug: string; metric_key: string; value_num: number }>(
    `SELECT m.project_slug, m.metric_key, m.value_num
       FROM metrics m
       JOIN (SELECT project_slug, metric_key, MAX(captured_at) AS newest
               FROM metrics GROUP BY project_slug, metric_key) latest
         ON m.project_slug = latest.project_slug
        AND m.metric_key = latest.metric_key
        AND m.captured_at = latest.newest`,
  );
  return new Map(rows.map((r) => [`${r.project_slug}:${r.metric_key}`, r.value_num]));
}

/**
 * GitHub returns one result per repo, but the dashboard needs a single
 * connector light beside "GitHub". This wraps the per-repo map in one
 * ConnectorResult whose status is the worst case across the repos, so a single
 * unreadable repo shows as degraded rather than taking the whole light down.
 */
async function githubBundle(): Promise<ConnectorResult<RepoBundle>> {
  const started = Date.now();
  const byRepo = await fetchAllRepoPulses(PROJECTS.map((p) => p.repo));
  const results = Object.values(byRepo);
  const failures = results.filter((r) => r.status === 'failed');

  const status: ConnectorStatus =
    failures.length === 0 ? 'ok' : failures.length === results.length ? 'failed' : 'degraded';

  // Four repos hitting the same wall produce four identical messages. Showing
  // the distinct causes once each keeps the connector line readable, which is
  // the whole reason anyone looks at it.
  const causes = [...new Set(failures.map((f) => f.detail.replace(/^GitHub \S+: /, '')))];

  return {
    status,
    data: byRepo,
    detail:
      failures.length === 0
        ? `${results.length} repositories polled.`
        : `${failures.length} of ${results.length} unreadable — ${causes.join('; ')}`,
    latencyMs: Date.now() - started,
    checkedAt: new Date().toISOString(),
  };
}

export async function pulse(options: { fresh?: boolean } = {}): Promise<Pulse> {
  const ttl = options.fresh ? 0 : CACHE_TTL_SECONDS;

  const [stripeResult, repoResults, cloudflareResult, calendarResult] = await Promise.all([
    safe(() => cached('stripe', ttl, () => fetchStripe()), 'Stripe'),
    safe(() => cached('github', ttl, githubBundle), 'GitHub'),
    safe(() => cached('cloudflare', ttl, () => fetchCloudflare()), 'Cloudflare'),
    safe(() => cached('calendar', ttl, () => fetchCalendar()), 'Calendar'),
  ]);

  const [finance, pipeline, stored, agentRuns, lastCron] = await Promise.all([
    loadFinance(),
    loadPipeline(),
    latestMetrics(),
    query<AgentRun>('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 25'),
    query<{ checked_at: string }>(
      'SELECT checked_at FROM heartbeats ORDER BY checked_at DESC LIMIT 1',
    ),
  ]);

  const connectors: ConnectorHealth[] = [
    health(stripeResult, 'Stripe'),
    health(repoResults, 'GitHub'),
    health(cloudflareResult, 'Cloudflare'),
    health(calendarResult, 'Calendar'),
  ];
  const connectorsLive = connectors.filter((c) => c.status === 'ok').length;

  const lastCronAt = lastCron[0]?.checked_at ?? null;
  const lastCronMinutes = lastCronAt
    ? Math.floor((Date.now() - new Date(lastCronAt).getTime()) / 60_000)
    : null;

  const events = calendarResult.data ? upcoming(calendarResult.data) : [];
  const financeBySlug = new Map(finance.byProject.map((f) => [f.slug, f]));

  const projects: ProjectPulse[] = PROJECTS.map((project) => {
    const repoResult = repoResults.data?.[project.repo];
    const repo = repoResult?.data ?? null;
    const projectFinance = financeBySlug.get(project.slug)!;
    const verdict = assessHealth(project, repo, projectFinance);

    const scopedStored = new Map(
      [...stored.entries()]
        .filter(([key]) => key.startsWith(`${project.slug}:`))
        .map(([key, value]) => [key.slice(project.slug.length + 1), value]),
    );

    return {
      project,
      finance: projectFinance,
      repo,
      repoStatus: repoResult?.status ?? 'failed',
      vitals: resolveVitals(
        project,
        repo,
        projectFinance,
        // Only this project's charges — see sliceForProject.
        project.revenueModel === 'stripe'
          ? sliceForProject(stripeResult.data, project)
          : null,
        scopedStored,
        lastCronMinutes,
        connectorsLive,
        cloudflareResult.data,
      ),
      health: verdict.health,
      healthReason: verdict.reason,
      events: events.filter((e) => e.projectSlug === project.slug),
    };
  });

  return {
    generatedAt: isoStamp(),
    configured: hasDatabase(),
    connectors,
    finance,
    pipeline,
    projects,
    stripe: stripeResult.data,
    cloudflare: cloudflareResult.data,
    events,
    agentRuns,
    lastCronMinutes,
  };
}

/** Last line of defence: turn any throw into a failed connector result. */
async function safe<T>(
  load: () => Promise<ConnectorResult<T>>,
  label: string,
): Promise<ConnectorResult<T>> {
  try {
    return await load();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'failed',
      data: null,
      detail: `${label}: ${message}`,
      latencyMs: 0,
      checkedAt: new Date().toISOString(),
    };
  }
}

/** Record one connector check. Called by the cron, read by the overview. */
export async function recordHeartbeat(c: ConnectorHealth): Promise<void> {
  await execute(
    'INSERT INTO heartbeats (connector, status, latency_ms, detail, checked_at) VALUES (?,?,?,?,?)',
    [c.name.toLowerCase(), c.status, c.latencyMs, c.detail, c.checkedAt],
  );
}

/** Snapshot a metric so the sparklines have something to draw. */
export async function recordMetric(
  projectSlug: string,
  key: string,
  value: number,
  source: string,
): Promise<void> {
  await execute(
    'INSERT INTO metrics (project_slug, metric_key, value_num, captured_at, source) VALUES (?,?,?,?,?)',
    [projectSlug, key, value, isoStamp(), source],
  );
}

export const STAGE_ORDER: Stage[] = ['earning', 'shipped', 'building', 'idea', 'paused'];
