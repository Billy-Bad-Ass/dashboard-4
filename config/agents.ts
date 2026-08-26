/**
 * The agent fleet register.
 *
 * Two kinds of thing live here and they are genuinely different:
 *
 *  - **Portfolio agents** run out of THIS repository, against the whole
 *    portfolio. They are defined in `.claude/agents/` and scheduled by
 *    `.github/workflows/agent-*.yml` here.
 *  - **Project agents** run out of an individual project's own repository.
 *    network-store-2 already has nine of them. This dashboard does not schedule
 *    those — it shows their runs, because they report in to /api/agent-runs.
 *
 * Keeping the distinction visible matters: a scheduled job you think this repo
 * owns but that actually lives elsewhere is a job nobody maintains.
 *
 * The `schedule` field is not decoration. `lib/fleet.ts` reads it to work out
 * when each agent should last have fired, which is the only reason the console
 * can tell "nothing is wrong" apart from "nobody has said anything". An agent
 * registered with a schedule it does not really keep will read as permanently
 * overdue, and that is the correct outcome — fix the schedule, not the display.
 */

export type AgentScope = 'portfolio' | 'project';

/**
 * What actually executes the agent.
 *
 * This started as an assumption rather than a field — every agent had a
 * `.github/workflows/*.yml` and the console built an Actions URL from it.
 * Project 6's two checks run as Cloudflare Cron Triggers on a Worker, so the
 * assumption now has exceptions and they have to be visible: a link to an
 * Actions page that does not exist is worse than no link.
 */
export type AgentPlatform = 'github-actions' | 'cloudflare-cron';

export interface AgentSpec {
  name: string;
  scope: AgentScope;
  /** Which repo the agent runs from. */
  repo: string;
  /** Project it acts on, or null for portfolio-wide. */
  projectSlug: string | null;
  owns: string;
  /** Cron schedule in UTC, or null for event-triggered agents. */
  schedule: string | null;
  scheduleHuman: string;
  trigger: string;
  /** What runs it. Only `github-actions` agents have an Actions page. */
  platform: AgentPlatform;
  /** The file that defines it: a workflow, or the wrangler config for a Worker cron. */
  workflow: string;
  icon: string;
}

export const AGENTS: AgentSpec[] = [
  {
    name: 'portfolio-analyst',
    scope: 'portfolio',
    repo: 'Billy-Bad-Ass/dashboard-4',
    projectSlug: null,
    owns:
      'The Monday portfolio review. Reads the live pulse, compares against last week, and opens ' +
      'one issue naming the single highest-value thing to do next.',
    schedule: '0 7 * * 1',
    scheduleHuman: 'Mondays 07:00 UTC',
    trigger: 'cron',
    platform: 'github-actions',
    workflow: 'agent-portfolio-review.yml',
    icon: 'magnifying-glass-chart',
  },
  {
    name: 'spend-auditor',
    scope: 'portfolio',
    repo: 'Billy-Bad-Ass/dashboard-4',
    projectSlug: null,
    owns:
      'Reconciles the ledger against reality once a month: subscriptions still running that ' +
      'nothing uses, and costs that appear on a card statement but never in the ledger.',
    schedule: '0 9 1 * *',
    scheduleHuman: '1st of the month, 09:00 UTC',
    trigger: 'cron',
    platform: 'github-actions',
    workflow: 'agent-spend-audit.yml',
    icon: 'file-invoice-dollar',
  },
  {
    name: 'pipeline-nudge',
    scope: 'portfolio',
    repo: 'Billy-Bad-Ass/dashboard-4',
    projectSlug: null,
    owns:
      'Reads the CRM for actions due and contacts going cold, and opens one issue listing them. ' +
      'It never contacts anybody — outreach is a human decision.',
    schedule: '0 8 * * 1-5',
    scheduleHuman: 'Weekdays 08:00 UTC',
    trigger: 'cron',
    platform: 'github-actions',
    workflow: 'agent-pipeline-nudge.yml',
    icon: 'handshake',
  },
  {
    name: 'heartbeat-watchdog',
    scope: 'portfolio',
    repo: 'Billy-Bad-Ass/dashboard-4',
    projectSlug: null,
    owns:
      'Checks that the cron heartbeat is actually ticking and the connectors are live. Opens an ' +
      'issue when the dashboard itself has gone quiet — the one failure nothing else would catch.',
    schedule: '30 */6 * * *',
    scheduleHuman: 'Every 6 hours',
    trigger: 'cron',
    platform: 'github-actions',
    workflow: 'agent-heartbeat-watchdog.yml',
    icon: 'tower-broadcast',
  },
  {
    name: 'mention-router',
    scope: 'portfolio',
    repo: 'Billy-Bad-Ass/dashboard-4',
    projectSlug: null,
    owns: 'Routes an @claude mention on any issue or PR here to the right specialist.',
    schedule: null,
    scheduleHuman: 'On @claude mention',
    trigger: 'github',
    platform: 'github-actions',
    workflow: 'agent-mention.yml',
    icon: 'robot',
  },
  {
    name: 'revenue-analyst',
    scope: 'project',
    repo: 'Billy-Bad-Ass/network-store-2',
    projectSlug: 'project-2',
    owns: 'The store’s Stripe digest. Leads with problems, not the headline.',
    schedule: '0 8 * * 1',
    scheduleHuman: 'Mondays 08:00 UTC',
    trigger: 'cron',
    platform: 'github-actions',
    workflow: 'agent-revenue-digest.yml',
    icon: 'brand-stripe',
  },
  {
    name: 'market-researcher',
    scope: 'project',
    repo: 'Billy-Bad-Ass/network-store-2',
    projectSlug: 'project-2',
    owns: 'Demand signals, competitor pricing and keyword gaps for the storefront.',
    schedule: '0 7 * * 1',
    scheduleHuman: 'Mondays 07:00 UTC',
    trigger: 'cron',
    platform: 'github-actions',
    workflow: 'agent-market-intel.yml',
    icon: 'magnifying-glass-chart',
  },
  {
    name: 'listing-copywriter',
    scope: 'project',
    repo: 'Billy-Bad-Ass/network-store-2',
    projectSlug: 'project-2',
    owns: 'Monthly listing refresh — and an issue instead of a PR when copy overclaims.',
    // Was '0 6 1 * *' here while agent-listing-refresh.yml has always said
    // '0 9 1 * *'. Three hours of phantom overdue on the 1st of every month.
    schedule: '0 9 1 * *',
    scheduleHuman: '1st of the month, 09:00 UTC',
    trigger: 'cron',
    platform: 'github-actions',
    workflow: 'agent-listing-refresh.yml',
    icon: 'pen',
  },
  {
    name: 'release-qa',
    scope: 'project',
    repo: 'Billy-Bad-Ass/network-store-2',
    projectSlug: 'project-2',
    owns: 'Go/no-go before a store deploy. Reports, never fixes.',
    schedule: null,
    scheduleHuman: 'On v* tags',
    trigger: 'github',
    platform: 'github-actions',
    workflow: 'agent-release-check.yml',
    icon: 'shield-halved',
  },
  {
    name: 'dataset-refresh',
    scope: 'project',
    repo: 'Billy-Bad-Ass/sitecheck-1',
    projectSlug: 'project-1',
    owns: 'Rebuilds the pSEO dataset from live APIs and redeploys.',
    schedule: '15 4 * * *',
    scheduleHuman: 'Daily 04:15 UTC',
    trigger: 'cron',
    platform: 'github-actions',
    workflow: 'refresh.yml',
    icon: 'rotate',
  },
  // Project 6's two checks are Cloudflare Cron Triggers on the bba-network-hub
  // Worker rather than GitHub Actions — the first agents in this register with
  // no workflow file and no Actions page. They got away with being a Worker
  // because both are pure fetch-and-compare: no model in the loop and no
  // GitHub API call, so neither needs a credential a Worker cannot safely
  // hold. See docs/DECISIONS.md for why most of Project 4's cannot follow.
  {
    name: 'link-warden',
    scope: 'project',
    repo: 'Billy-Bad-Ass/web-6',
    projectSlug: 'project-6',
    owns:
      'Every business the register calls `live` is actually reachable. A brand hub pointing at ' +
      'a dead subdomain costs more than one that admits the business is not up yet.',
    schedule: '20 7 * * *',
    scheduleHuman: 'Daily 07:20 UTC',
    trigger: 'cron',
    platform: 'cloudflare-cron',
    workflow: 'wrangler.jsonc',
    icon: 'link',
  },
  {
    name: 'redirect-guard',
    scope: 'project',
    repo: 'Billy-Bad-Ass/web-6',
    projectSlug: 'project-6',
    owns:
      'The legacy apex paths that carry paying customers to their downloads. These are the only ' +
      'URLs in the portfolio a real buyer already holds, so a broken one loses a sale nobody sees.',
    schedule: '40 7 * * *',
    scheduleHuman: 'Daily 07:40 UTC',
    trigger: 'cron',
    platform: 'cloudflare-cron',
    workflow: 'wrangler.jsonc',
    icon: 'shield-halved',
  },
];

export function agentsFor(projectSlug: string): AgentSpec[] {
  return AGENTS.filter((a) => a.projectSlug === projectSlug);
}
