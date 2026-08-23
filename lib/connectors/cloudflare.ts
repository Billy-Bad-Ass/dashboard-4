/**
 * Cloudflare — traffic, and what the £5/month is actually buying.
 *
 * Uses the GraphQL analytics API, which is the only endpoint that returns
 * Workers request counts without a per-zone subscription. The token needs
 * `Account Analytics: Read`; anything wider is more access than this needs.
 *
 * Without a token this returns `unconfigured` and the dashboard shows the plan
 * cost from the ledger with no traffic beside it, which is still useful.
 */

import { cfEnv } from '../db';
import { attempt, unconfigured, type ConnectorResult } from './types';

export interface CloudflareSnapshot {
  /** Worker invocations over the window. */
  requests: number;
  errors: number;
  /** Median CPU time in microseconds. The number that decides the bill. */
  cpuMedianUs: number | null;
  /** Per-script breakdown, so each project's share of the plan is visible. */
  byScript: { script: string; requests: number; errors: number }[];
  windowDays: number;
}

const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';

const QUERY = `
  query Workers($accountTag: String!, $since: Date!, $until: Date!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        workersInvocationsAdaptive(
          limit: 100
          filter: { date_geq: $since, date_leq: $until }
        ) {
          sum { requests errors }
          quantiles { cpuTimeP50 }
          dimensions { scriptName }
        }
      }
    }
  }
`;

interface GraphQLResponse {
  errors?: { message: string }[];
  data?: {
    viewer: {
      accounts: {
        workersInvocationsAdaptive: {
          sum: { requests: number; errors: number };
          quantiles: { cpuTimeP50: number } | null;
          dimensions: { scriptName: string };
        }[];
      }[];
    };
  };
}

export async function fetchCloudflare(windowDays = 7): Promise<ConnectorResult<CloudflareSnapshot>> {
  const env = cfEnv();
  const token = env?.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN;
  const account = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!token || !account) {
    return unconfigured(
      'No CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID. Create a token with ' +
        '"Account Analytics: Read", then add both under Cloudflare \u2192 Workers & Pages ' +
        '\u2192 bba-heartbeat \u2192 Settings \u2192 Variables and Secrets.',
    );
  }

  return attempt('Cloudflare', async () => {
    const until = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);

    const response = await fetch(GRAPHQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'bba-heartbeat',
      },
      body: JSON.stringify({ query: QUERY, variables: { accountTag: account, since, until } }),
    });

    if (!response.ok) throw new Error(`${response.status} from the analytics API`);
    const body = (await response.json()) as GraphQLResponse;
    // GraphQL returns 200 with an errors array on auth failures, so checking
    // response.ok alone reports a broken token as healthy.
    if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));

    const rows = body.data?.viewer.accounts[0]?.workersInvocationsAdaptive ?? [];
    const byScript = rows.map((row) => ({
      script: row.dimensions.scriptName,
      requests: row.sum.requests,
      errors: row.sum.errors,
    }));

    const p50s = rows.map((r) => r.quantiles?.cpuTimeP50).filter((n): n is number => n != null);

    return {
      requests: byScript.reduce((a, r) => a + r.requests, 0),
      errors: byScript.reduce((a, r) => a + r.errors, 0),
      cpuMedianUs: p50s.length ? Math.round(p50s.reduce((a, b) => a + b, 0) / p50s.length) : null,
      byScript: byScript.sort((a, b) => b.requests - a.requests),
      windowDays,
    };
  });
}
