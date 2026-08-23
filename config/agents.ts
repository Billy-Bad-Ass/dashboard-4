/**
 * The agent fleet register.
 *
 * Two kinds of thing live here and they are genuinely different:
 *
 *  - **Portfolio agents** run out of THIS repository, against the whole
 *    portfolio. They are defined in `.claude/agents/` and scheduled by
 *    `.github/workflows/agent-*.yml` here.
 *  - **Project agents** run out of an individual project's own repository.
 *    Project-2 already has nine of them. This dashboard does not schedule
 *    those — it shows their runs, because they report in to /api/agent-runs.
 *
 * Keeping the distinction visible matters: a scheduled job you think this repo
 * owns but that actually lives elsewhere is a job nobody maintains.
 */

export type AgentScope = 'portfolio' | 'project';

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
  /** The workflow file that runs it. */
  workflow: string;
  icon: string;
}

export const AGENTS: AgentSpec[] = [
  {
    name: 'portfolio-analyst',
    scope: 'portfolio',
    repo: 'Billy-Bad-Ass/Project-4',
    projectSlug: null,
    owns:
      'The Monday portfolio review. Reads the live pulse, compares against last week, and opens ' +
      'one issue naming the single highest-value thing to do next.',
    schedule: '0 7 * * 1',
    scheduleHuman: 'Mondays 07:00 UTC',
    trigger: 'cron',
    workflow: 'agent-portfolio-review.yml',
    icon: 'magnifying-glass-chart',
  },
  {
    name: 'spend-auditor',
    scope: 'portfolio',
    repo: 'Billy-Bad-Ass/Project-4',
    projectSlug: null,
    owns:
      'Reconciles the ledger against reality once a month: subscriptions still running that ' +
      'nothing uses, and costs that appear on a card statement but never in the ledger.',
    schedule: '0 9 1 * *',
    scheduleHuman: '1st of the month, 09:00 UTC',
    trigger: 'cron',
    workflow: 'agent-spend-audit.yml',
    icon: 'file-invoice-dollar',
  },
  {
    name: 'pipeline-nudge',
    scope: 'portfolio',
    repo: 'Billy-Bad-Ass/Project-4',
    projectSlug: null,
    owns:
      'Reads the CRM for actions due and contacts going cold, and opens one issue listing them. ' +
      'It never contacts anybody — outreach is a human decision.',
    schedule: '0 8 * * 1-5',
    scheduleHuman: 'Weekdays 08:00 UTC',
    trigger: 'cron',
    workflow: 'agent-pipeline-nudge.yml',
    icon: 'handshake',
  },
  {
    name: 'heartbeat-watchdog',
    scope: 'portfolio',
    repo: 'Billy-Bad-Ass/Project-4',
    projectSlug: null,
    owns:
      'Checks that the cron heartbeat is actually ticking and the connectors are live. Opens an ' +
      'issue when the dashboard itself has gone quiet — the one failure nothing else would catch.',
    schedule: '30 */6 * * *',
    scheduleHuman: 'Every 6 hours',
    trigger: 'cron',
    workflow: 'agent-heartbeat-watchdog.yml',
    icon: 'tower-broadcast',
  },
  {
    name: 'mention-router',
    scope: 'portfolio',
    repo: 'Billy-Bad-Ass/Project-4',
    projectSlug: null,
    owns: 'Routes an @claude mention on any issue or PR here to the right specialist.',
    schedule: null,
    scheduleHuman: 'On @claude mention',
    trigger: 'github',
    workflow: 'agent-mention.yml',
    icon: 'robot',
  },
  {
    name: 'revenue-analyst',
    scope: 'project',
    repo: 'Billy-Bad-Ass/Project-2',
    projectSlug: 'project-2',
    owns: 'The store’s Stripe digest. Leads with problems, not the headline.',
    schedule: '0 8 * * 1',
    scheduleHuman: 'Mondays 08:00 UTC',
    trigger: 'cron',
    workflow: 'agent-revenue-digest.yml',
    icon: 'brand-stripe',
  },
  {
    name: 'market-researcher',
    scope: 'project',
    repo: 'Billy-Bad-Ass/Project-2',
    projectSlug: 'project-2',
    owns: 'Demand signals, competitor pricing and keyword gaps for the storefront.',
    schedule: '0 7 * * 1',
    scheduleHuman: 'Mondays 07:00 UTC',
    trigger: 'cron',
    workflow: 'agent-market-intel.yml',
    icon: 'magnifying-glass-chart',
  },
  {
    name: 'listing-copywriter',
    scope: 'project',
    repo: 'Billy-Bad-Ass/Project-2',
    projectSlug: 'project-2',
    owns: 'Monthly listing refresh — and an issue instead of a PR when copy overclaims.',
    schedule: '0 6 1 * *',
    scheduleHuman: '1st of the month',
    trigger: 'cron',
    workflow: 'agent-listing-refresh.yml',
    icon: 'pen',
  },
  {
    name: 'release-qa',
    scope: 'project',
    repo: 'Billy-Bad-Ass/Project-2',
    projectSlug: 'project-2',
    owns: 'Go/no-go before a store deploy. Reports, never fixes.',
    schedule: null,
    scheduleHuman: 'On v* tags',
    trigger: 'github',
    workflow: 'agent-release-check.yml',
    icon: 'shield-halved',
  },
  {
    name: 'dataset-refresh',
    scope: 'project',
    repo: 'Billy-Bad-Ass/Project-1',
    projectSlug: 'project-1',
    owns: 'Rebuilds the pSEO dataset from live APIs and redeploys.',
    schedule: '15 4 * * *',
    scheduleHuman: 'Daily 04:15 UTC',
    trigger: 'cron',
    workflow: 'refresh.yml',
    icon: 'rotate',
  },
];

export function agentsFor(projectSlug: string): AgentSpec[] {
  return AGENTS.filter((a) => a.projectSlug === projectSlug);
}
