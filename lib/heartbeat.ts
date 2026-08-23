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

import { PROJECTS, type Project, type Stage } from '@/config/portfolio';
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
 * Read through KV. On a cache miss the loader runs and the result is stored;
 * on a loader failure the stale cached value is returned if there is one,
 * because week-old traffic numbers beat an error box.
 */
async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const kv = getCache();
  if (!kv) return load();

  const hit = await kv.get(key, 'json');
  if (hit !== null) return hit as T;

  try {
    const fresh = await load();
    await kv.put(key, JSON.stringify(fresh), { expirationTtl: ttl });
    return fresh;
  } catch {
    const stale = await kv.get(`${key}:last`, 'json');
    if (stale !== null) return stale as T;
    throw new Error(`cache miss and loader failed for ${key}`);
  }
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

  const daysSinceCommit = repo.lastCommitAt
    ? Math.floor((Date.now() - new Date(repo.lastCommitAt).getTime()) / 86_400_000)
    : null;

  if (repo.ciStatus === 'failure') {
    return { health: 'stalled', reason: 'CI is red on the default branch.' };
  }
  if (daysSinceCommit === null || daysSinceCommit > 21) {
    return {
      health: 'stalled',
      reason:
        daysSinceCommit === null
          ? 'No commits in the last 30 days.'
          : `No commits for ${daysSinceCommit} days.`,
    };
  }
  // Earning projects are held to a harder standard: money in means the thing
  // is real, so a dip in activity matters more, not less.
  if (project.stage === 'earning' && finance.netPence <= 0) {
    return { health: 'watch', reason: 'Marked as earning but net revenue is not positive.' };
  }
  if (daysSinceCommit > 7) {
    return { health: 'watch', reason: `Last commit ${daysSinceCommit} days ago.` };
  }
  return { health: 'good', reason: `Active — last commit ${daysSinceCommit} days ago.` };
}

/** Resolve a project's configured vitals from whichever source each names. */
function resolveVitals(
  project: Project,
  repo: RepoPulse | null,
  finance: ProjectFinance,
  stripe: StripeSnapshot | null,
  stored: Map<string, number>,
  lastCronMinutes: number | null,
  connectorsLive: number,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const daysSinceCommit = repo?.lastCommitAt
    ? Math.floor((Date.now() - new Date(repo.lastCommitAt).getTime()) / 86_400_000)
    : null;

  for (const vital of project.vitals) {
    switch (vital.key) {
      case 'revenue':
        out[vital.key] = project.revenueModel === 'stripe' ? (stripe?.netPence ?? 0) : finance.netPence;
        break;
      case 'units':
        out[vital.key] = stripe?.units ?? 0;
        break;
      case 'refund_rate':
        out[vital.key] =
          stripe && stripe.grossPence > 0
            ? (stripe.refundedPence / stripe.grossPence) * 100
            : 0;
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
        // Stripe revenue belongs to whichever project actually sells through it.
        project.revenueModel === 'stripe' ? stripeResult.data : null,
        scopedStored,
        lastCronMinutes,
        connectorsLive,
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
