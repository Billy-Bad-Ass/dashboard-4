/**
 * GitHub — the "is anything actually being built" signal.
 *
 * For a pre-revenue portfolio this is the most honest connector on the
 * dashboard. Revenue is zero everywhere; commit cadence and CI colour are what
 * separate a project that is alive from one that has quietly stopped.
 *
 * Works unauthenticated against public repos (60 requests/hour, which the
 * ten-minute cron stays well inside). A token raises that to 5000 and is the
 * only way to see private repos.
 */

import { cfEnv } from '../db';
import { attempt, type ConnectorResult } from './types';

export interface RepoPulse {
  repo: string;
  exists: boolean;
  defaultBranch: string;
  /** Commits in the trailing window. */
  commitCount: number;
  lastCommitAt: string | null;
  lastCommitMessage: string | null;
  openIssues: number;
  openPulls: number;
  /** Conclusion of the most recent CI run: success | failure | null. */
  ciStatus: string | null;
  ciUrl: string | null;
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
  commit: { message: string; author: { date: string } };
}

interface RunsResponse {
  workflow_runs: { conclusion: string | null; status: string; html_url: string }[];
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
        lastCommitAt: null,
        lastCommitMessage: null,
        openIssues: 0,
        openPulls: 0,
        ciStatus: null,
        ciUrl: null,
        sizeKb: 0,
        language: null,
        pushedAt: null,
      } satisfies RepoPulse;
    }

    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
    const [commits, pulls, runs] = await Promise.all([
      gh<CommitResponse[]>(`/repos/${repo}/commits?since=${since}&per_page=100`),
      gh<unknown[]>(`/repos/${repo}/pulls?state=open&per_page=100`),
      gh<RunsResponse>(`/repos/${repo}/actions/runs?per_page=1`),
    ]);

    const latest = commits?.[0];
    const run = runs?.workflow_runs?.[0];
    const pullCount = pulls?.length ?? 0;

    return {
      repo,
      exists: true,
      defaultBranch: meta.default_branch,
      commitCount: commits?.length ?? 0,
      lastCommitAt: latest?.commit.author.date ?? null,
      lastCommitMessage: latest?.commit.message.split('\n')[0] ?? null,
      // GitHub's open_issues_count includes pull requests. Subtracting them is
      // the only way to get the number a human means by "open issues".
      openIssues: Math.max(0, meta.open_issues_count - pullCount),
      openPulls: pullCount,
      ciStatus: run ? (run.conclusion ?? run.status) : null,
      ciUrl: run?.html_url ?? null,
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
