/**
 * GitHub — the "is anything actually being built" signal.
 *
 * For a pre-revenue portfolio this is the most honest connector on the
 * dashboard. Revenue is zero everywhere; commit cadence and CI colour are what
 * separate a project that is alive from one that has quietly stopped.
 *
 * GITHUB_TOKEN is effectively required, despite every repo here being public.
 * A full poll costs four calls per repo — metadata, commits, pulls, runs — so
 * six repos on a ten-minute cron is 24 calls a tick and 144 an hour, against an
 * unauthenticated ceiling of 60. It does not nearly fit, and it will not fit by
 * adding a repo either. A token raises the ceiling to 5000, which does, and is
 * also the only way to see a private repo.
 *
 * Unauthenticated still works for a single manual page load. It is the cron
 * that cannot live there.
 */

import { cfEnv } from '../db';
import { attempt, type ConnectorResult } from './types';

export interface RepoPulse {
  repo: string;
  exists: boolean;
  defaultBranch: string;
  /**
   * Commits in the trailing window BY A PERSON. Automated commits are counted
   * separately and deliberately excluded here — see `isAutomated`.
   */
  commitCount: number;
  /** Automated commits in the same window. Real activity; not evidence of a person. */
  botCommitCount: number;
  /** The last commit by a person. This is the clock a staleness check must use. */
  lastCommitAt: string | null;
  lastCommitMessage: string | null;
  /** The last commit of any kind, automated included. Shown as context, never judged on. */
  lastAnyCommitAt: string | null;
  openIssues: number;
  openPulls: number;
  /**
   * The default branch's own verdict: the conclusion of the runs a push to it
   * produced, at its head commit. success | failure | null, plus whatever else
   * GitHub concludes. Null means no push has built the branch — unknown, which
   * is not the same as green.
   */
  ciStatus: string | null;
  ciUrl: string | null;
  /** Which workflow that verdict came from. Said out loud wherever it is used. */
  ciWorkflow: string | null;
  /** Bytes. A repo of a few hundred bytes is a README and nothing else. */
  sizeKb: number;
  language: string | null;
  pushedAt: string | null;
}

const API = 'https://api.github.com';

function headers(): Record<string, string> {
  const token = cfEnv()?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
  const base: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub rejects API requests with no User-Agent.
    'User-Agent': 'bba-heartbeat',
  };
  if (token) base.Authorization = `Bearer ${token}`;
  return base;
}

async function gh<T>(path: string): Promise<T | null> {
  const response = await fetch(`${API}${path}`, { headers: headers() });
  // 404 on a repo that exists means the token cannot see it; 404 on one that
  // does not is the same response. Either way there is nothing to report, and
  // that is different from an outage, so it is null rather than a throw.
  if (response.status === 404) return null;

  // 401 means a token was sent and rejected. Worth its own message, because the
  // fix (rotate the token, or unset it for public repos) is nothing like the
  // fix for a rate limit, and the generic status code sends you the wrong way.
  if (response.status === 401) {
    throw new Error('GITHUB_TOKEN was rejected — rotate it, or unset it entirely for public repos');
  }

  // A 403 is only a rate limit when the remaining count says so. GitHub also
  // returns 403 for a token missing a scope, and a corporate egress proxy
  // returns it for a request that never reached GitHub at all.
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining === '0' || response.status === 429) {
      const reset = response.headers.get('x-ratelimit-reset');
      throw new Error(
        `rate limited${reset ? ` until ${new Date(Number(reset) * 1000).toISOString()}` : ''}. ` +
          'Set GITHUB_TOKEN to raise the limit from 60/hour to 5000/hour.',
      );
    }
    throw new Error(
      '403 from the GitHub API and not a rate limit — either the token is missing a scope, ' +
        'or something between here and GitHub blocked the request',
    );
  }

  if (!response.ok) throw new Error(`${response.status} on ${path}`);
  return (await response.json()) as T;
}

interface RepoResponse {
  default_branch: string;
  open_issues_count: number;
  size: number;
  language: string | null;
  pushed_at: string | null;
}

interface CommitResponse {
  commit: { message: string; author: { date: string; email?: string; name?: string } };
  /** The GitHub account, when the commit maps to one. `type` is 'Bot' for apps. */
  author: { login?: string; type?: string } | null;
}

/**
 * Was this commit written by a machine?
 *
 * Three independent signals, because any one of them can be absent: GitHub
 * types the account as a Bot, the login carries the `[bot]` suffix, or the
 * commit is attributed to the shared github-actions noreply address. Hardstop
 * writes as `runner[bot]` and `watchman[bot]` over that shared address, so in
 * practice the last one does most of the work.
 *
 * Deliberately conservative: an unrecognised author counts as a person. Over-
 * counting humans makes a project look more alive than it is, which is the
 * safer direction to be wrong in — the opposite would hide a real commit.
 */
function isAutomated(c: CommitResponse): boolean {
  if (c.author?.type === 'Bot') return true;
  if (c.author?.login?.endsWith('[bot]')) return true;
  const email = c.commit.author.email ?? '';
  const name = c.commit.author.name ?? '';
  return /users\.noreply\.github\.com$/.test(email) && /\[bot\]$/.test(name)
    ? true
    : /github-actions\[bot\]@/.test(email) || /\[bot\]$/.test(name);
}

export interface WorkflowRun {
  /** Identifies the workflow, not the run. Two runs sharing it are re-runs. */
  workflow_id: number;
  name: string | null;
  head_sha: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

interface RunsResponse {
  workflow_runs: WorkflowRun[];
}

/**
 * Conclusions that mean the branch did not build. Used only to decide which
 * run to report when several ran against the same commit — the conclusion
 * itself is passed through untouched, so the dashboard shows `timed_out`
 * rather than flattening it to `failure`.
 */
const RED = new Set(['failure', 'timed_out', 'startup_failure']);

export interface CiVerdict {
  status: string | null;
  url: string | null;
  workflow: string | null;
}

/**
 * Reduce a branch's push runs to one verdict.
 *
 * Expects the runs GitHub returns for `?branch=<default>&event=push`, newest
 * first. Three rules, in order:
 *
 *  1. Only the head commit counts. A red run against a commit two pushes ago
 *     was either fixed or already reported, and judging on it would keep a
 *     project red past the push that repaired it.
 *  2. Per workflow, the newest run wins. A re-run is the author saying the
 *     earlier attempt does not stand.
 *  3. Red beats amber beats green. If anything failed at that commit the
 *     branch is red, whichever workflow got there last.
 */
export function assessCi(runs: WorkflowRun[] | null | undefined): CiVerdict {
  const newest = runs?.[0];
  if (!newest) return { status: null, url: null, workflow: null };

  const current = new Map<number, WorkflowRun>();
  for (const run of runs!) {
    if (run.head_sha !== newest.head_sha) continue;
    if (!current.has(run.workflow_id)) current.set(run.workflow_id, run);
  }

  const at = [...current.values()];
  const failed = at.find((r) => r.conclusion !== null && RED.has(r.conclusion));
  if (failed) return { status: failed.conclusion, url: failed.html_url, workflow: failed.name };

  const running = at.find((r) => r.status !== 'completed');
  if (running) return { status: running.status, url: running.html_url, workflow: running.name };

  return {
    status: newest.conclusion ?? newest.status,
    url: newest.html_url,
    workflow: newest.name,
  };
}

export async function fetchRepoPulse(
  repo: string,
  sinceDays = 30,
): Promise<ConnectorResult<RepoPulse>> {
  return attempt(`GitHub ${repo}`, async () => {
    const meta = await gh<RepoResponse>(`/repos/${repo}`);
    if (!meta) {
      return {
        repo,
        exists: false,
        defaultBranch: 'main',
        commitCount: 0,
        botCommitCount: 0,
        lastCommitAt: null,
        lastCommitMessage: null,
        lastAnyCommitAt: null,
        openIssues: 0,
        openPulls: 0,
        ciStatus: null,
        ciUrl: null,
        ciWorkflow: null,
        sizeKb: 0,
        language: null,
        pushedAt: null,
      } satisfies RepoPulse;
    }

    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
    const [commits, pulls, runs] = await Promise.all([
      gh<CommitResponse[]>(`/repos/${repo}/commits?since=${since}&per_page=100`),
      gh<unknown[]>(`/repos/${repo}/pulls?state=open&per_page=100`),
      // Scoped to the default branch, and to the runs a push to it produced.
      // Both halves are load-bearing. This was `?per_page=1` — the newest run
      // in the repo, any workflow, any branch — so a Monday-morning scheduled
      // agent job or a run on somebody's pull request branch could report a
      // project stalled while its default branch built clean. Project-2 spent
      // a morning red for exactly that reason, under a verdict that read "CI
      // is red on the default branch" when CI was green.
      //
      // 20 rather than 1 because a commit can trigger several workflows, and
      // one of them failing is what matters, not which finished last.
      gh<RunsResponse>(
        `/repos/${repo}/actions/runs` +
          `?branch=${encodeURIComponent(meta.default_branch)}&event=push&per_page=20`,
      ),
    ]);

    // Split the window before anything reads a count. A project whose cron
    // commits every few hours would otherwise never age past zero days, and
    // assessHealth's 21-day staleness rule could never fire on it.
    const human = (commits ?? []).filter((c) => !isAutomated(c));
    const bots = (commits ?? []).length - human.length;
    const latest = human[0];
    const ci = assessCi(runs?.workflow_runs);
    const pullCount = pulls?.length ?? 0;

    return {
      repo,
      exists: true,
      defaultBranch: meta.default_branch,
      commitCount: human.length,
      botCommitCount: bots,
      lastCommitAt: latest?.commit.author.date ?? null,
      lastCommitMessage: latest?.commit.message.split('\n')[0] ?? null,
      lastAnyCommitAt: commits?.[0]?.commit.author.date ?? null,
      // GitHub's open_issues_count includes pull requests. Subtracting them is
      // the only way to get the number a human means by "open issues".
      openIssues: Math.max(0, meta.open_issues_count - pullCount),
      openPulls: pullCount,
      ciStatus: ci.status,
      ciUrl: ci.url,
      ciWorkflow: ci.workflow,
      sizeKb: meta.size,
      language: meta.language,
      pushedAt: meta.pushed_at,
    } satisfies RepoPulse;
  });
}

/** Poll several repos at once. One failing repo does not sink the others. */
export async function fetchAllRepoPulses(
  repos: string[],
  sinceDays = 30,
): Promise<Record<string, ConnectorResult<RepoPulse>>> {
  const results = await Promise.all(repos.map((repo) => fetchRepoPulse(repo, sinceDays)));
  return Object.fromEntries(repos.map((repo, i) => [repo, results[i]!]));
}
