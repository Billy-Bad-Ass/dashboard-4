/**
 * The portfolio register.
 *
 * This is the one file you edit when a project is added, renamed, killed or
 * changes what it is trying to earn. Everything else — the nav, the per-project
 * pages, the pollers, the ROI maths — reads from here.
 *
 * What is deliberately NOT here: any number that changes on its own. Revenue
 * comes from Stripe, commits from GitHub, spend from the D1 ledger. A number
 * hardcoded in this file is a number that will be wrong by Thursday.
 */

/** How a project is supposed to make money. Drives which panels its page shows. */
export type RevenueModel =
  | 'stripe' // direct sales — Stripe is the order record
  | 'affiliate' // outbound commission — no Stripe, tracked via clicks
  | 'services' // client work — invoiced, tracked through the CRM
  | 'none'; // internal tooling, not expected to earn

export type Stage =
  | 'idea' // nothing built
  | 'building' // code exists, nothing shipped
  | 'shipped' // live and reachable
  | 'earning' // has taken real money
  | 'paused';

export interface Project {
  /** URL segment. Stable — changing it breaks bookmarks and the D1 rows keyed on it. */
  slug: string;
  name: string;
  /** One line. What it is, not what you hope it becomes. */
  tagline: string;
  repo: string;
  stage: Stage;
  revenueModel: RevenueModel;
  /** Accent used for this project's charts and badges. */
  accent: string;
  icon: string;
  /** Live URL, once there is one. */
  liveUrl?: string;
  /** ISO date the work started. Used for burn-rate and time-to-first-pound. */
  startedOn: string;
  /**
   * The metrics that actually tell you whether this project is alive, in the
   * order they should be read. Pre-revenue projects lead with leading
   * indicators; a revenue tile on a project with no product is theatre.
   */
  vitals: VitalSpec[];
  /** What has to be true before this project can earn. Shown as a checklist. */
  gates: string[];
  /** Honest note about the current state. Shown on the project page. */
  reality: string;
}

/** A single metric tile on a project page. */
export interface VitalSpec {
  key: string;
  label: string;
  /** Where the number comes from. `manual` means the D1 ledger or a form. */
  source: 'stripe' | 'github' | 'cloudflare' | 'ledger' | 'manual';
  unit: 'gbp' | 'count' | 'percent' | 'days';
  /** Higher is better, unless this is set. */
  lowerIsBetter?: boolean;
  /** What a healthy value looks like. Null when there is no meaningful target yet. */
  target: number | null;
  hint: string;
}

/** Re-exported so there is exactly one place the currency is decided. */
export { DEFAULT_CURRENCY as CURRENCY } from '@/lib/money';

/**
 * Money is stored and passed around in minor units, everywhere, always. `500`
 * is $5.00. Project-2 uses the same convention; the classic failure in this
 * codebase is a 100x error, so there is one formatter and it takes minor units.
 */
export const MONEY_UNIT = 'minor' as const;

export const PROJECTS: Project[] = [
  {
    slug: 'project-1',
    name: 'pSEO Forge',
    tagline: 'Programmatic-SEO affiliate engine running on free-tier APIs.',
    repo: 'Billy-Bad-Ass/Project-1',
    stage: 'building',
    revenueModel: 'affiliate',
    accent: '#2B5CE6',
    icon: 'magnifying-glass-chart',
    startedOn: '2026-08-22',
    reality:
      'The engine is finished and rebuilds itself daily on free CI. It earns nothing because ' +
      'monetisationEnabled is false — there are no affiliate accounts behind it yet. Until that ' +
      'flips, every "revenue" number on this page is correctly zero and the numbers worth ' +
      'watching are indexable pages and dataset health.',
    gates: [
      'Hold an approved affiliate account (Amazon Associates, CJ, or similar)',
      'Set monetisationEnabled = true in config/site.config.ts',
      'Give it its own domain — NOT a bbanetwork.org subdomain (see docs/DOMAINS.md)',
      'Submit the sitemap and get pages indexed',
    ],
    vitals: [
      {
        key: 'indexable_pages',
        label: 'Indexable pages',
        source: 'manual',
        unit: 'count',
        target: 400,
        hint: 'Items with at least one offer. Thin pages are suppressed, not published.',
      },
      {
        key: 'suppressed_ratio',
        label: 'Suppressed',
        source: 'manual',
        unit: 'percent',
        lowerIsBetter: true,
        target: 15,
        hint: 'A spike here usually means an upstream API changed shape.',
      },
      {
        key: 'dataset_age_days',
        label: 'Dataset age',
        source: 'github',
        unit: 'days',
        lowerIsBetter: true,
        target: 2,
        hint: 'Days since the refresh workflow last committed a dataset.',
      },
      {
        key: 'affiliate_revenue',
        label: 'Affiliate revenue',
        source: 'ledger',
        unit: 'gbp',
        target: null,
        hint: 'Entered manually from network dashboards — affiliates have no usable live API.',
      },
    ],
  },
  {
    slug: 'project-2',
    name: 'BBA Network Store',
    tagline: 'Printable reference guides sold as digital downloads.',
    repo: 'Billy-Bad-Ass/Project-2',
    stage: 'shipped',
    revenueModel: 'stripe',
    accent: '#12A150',
    icon: 'credit-card',
    liveUrl: 'https://bba-network-store.bbacentralworkspace.workers.dev',
    startedOn: '2026-08-23',
    reality:
      'Four SKUs built, on Workers with Stripe Checkout and R2 delivery. Live-mode Stripe ' +
      'currently holds no products and has taken no payments, so this is shipped but not yet ' +
      'earning. The gap between those two words is the whole job right now.',
    gates: [
      'Push the catalogue to live-mode Stripe (npm run stripe:sync -- --apply)',
      'Upload the PDFs to the production R2 bucket',
      'Take one real payment end to end and confirm the download lands',
      'Point bbanetwork.org at it — a workers.dev URL does not read as a shop',
      'Fix supportEmail: it says support@bba.network, a domain you do not own',
      'Put the storefront in front of an audience that is not you',
    ],
    vitals: [
      {
        key: 'revenue',
        label: 'Revenue',
        source: 'stripe',
        unit: 'gbp',
        target: null,
        hint: 'Net of refunds. Straight from Stripe, live mode.',
      },
      {
        key: 'units',
        label: 'Units sold',
        source: 'stripe',
        unit: 'count',
        target: null,
        hint: 'Paid Checkout Sessions. The bundle counts as one unit.',
      },
      {
        key: 'refund_rate',
        label: 'Refund rate',
        source: 'stripe',
        unit: 'percent',
        lowerIsBetter: true,
        target: 5,
        hint: 'Above 5% is a product problem, not a payments problem.',
      },
      {
        key: 'undelivered',
        label: 'Undelivered orders',
        source: 'stripe',
        unit: 'count',
        lowerIsBetter: true,
        target: 0,
        hint: 'Paid sessions with no matching download. Silent to the buyer until they email.',
      },
    ],
  },
  {
    slug: 'project-3',
    name: 'Hardstop',
    tagline: 'Automated trading research. Refuses to risk money until a strategy survives testing.',
    repo: 'Billy-Bad-Ass/Project-3',
    stage: 'building',
    revenueModel: 'none',
    accent: '#B5179E',
    icon: 'chart-line',
    startedOn: '2026-08-23',
    reality:
      'Research, not a trading system. Nothing in the repository can place an order, send, ' +
      'publish or spend — that is structural rather than policy. It moved off Cloudflare on ' +
      '2026-08-21: the D1 database and both Workers were deleted and the same code now runs on ' +
      'GitHub Actions through a D1-over-node:sqlite adapter. Its revenue model is deliberately ' +
      '"none" — a strategy that has not survived honest testing is a liability, not an asset, ' +
      'and putting a revenue tile on it would invite exactly the impatience it is built against.',
    gates: [
      'Find a strategy that survives out-of-sample testing without curve-fitting',
      'Establish the null result honestly — most candidates should fail, and be seen to',
      'Decide what evidence would justify risking real money, before there is any',
      'Only then: a broker, a position size, and a human who presses the button',
    ],
    vitals: [
      {
        key: 'commits',
        label: 'Commits',
        source: 'github',
        unit: 'count',
        target: null,
        hint: 'Research cadence. This project has no revenue signal by design.',
      },
      {
        key: 'days_since_commit',
        label: 'Days since commit',
        source: 'github',
        unit: 'days',
        lowerIsBetter: true,
        target: 14,
        hint: 'Research that has stopped is research that has quietly been abandoned.',
      },
      {
        key: 'ci_status',
        label: 'Test suite',
        source: 'github',
        unit: 'count',
        target: null,
        hint: 'The fences are enforced by tests. A red suite means a fence may be down.',
      },
    ],
  },
  {
    slug: 'project-4',
    name: 'Heartbeat',
    tagline: 'This dashboard. The instrument panel for everything else.',
    repo: 'Billy-Bad-Ass/Project-4',
    stage: 'building',
    revenueModel: 'none',
    accent: '#7C5CE6',
    icon: 'heart-pulse',
    liveUrl: 'https://bba-heartbeat.bbacentralworkspace.workers.dev',
    startedOn: '2026-08-23',
    reality:
      'Deployed and ticking. Internal tooling — it will never earn a penny directly, and it ' +
      'costs real money to run. It earns its keep by making the other projects’ numbers ' +
      'impossible to avoid looking at, and it is listed here so its own running cost stays ' +
      'inside the portfolio ROI rather than hiding outside it.',
    gates: [
      'Put Cloudflare Access in front of it — until then the URL is the only thing protecting it',
      'Add the connector secrets so the tiles show measured numbers rather than dashes',
      'Move it to heartbeat.bbanetwork.org and extend Access to the new hostname',
    ],
    vitals: [
      {
        key: 'heartbeat_age_minutes',
        label: 'Last heartbeat',
        source: 'ledger',
        unit: 'count',
        lowerIsBetter: true,
        target: 15,
        hint: 'Minutes since the cron trigger last completed a full poll.',
      },
      {
        key: 'connectors_live',
        label: 'Connectors live',
        source: 'ledger',
        unit: 'count',
        target: 4,
        hint: 'Stripe, GitHub, Cloudflare, Calendar.',
      },
      {
        key: 'run_cost',
        label: 'Running cost',
        source: 'ledger',
        unit: 'gbp',
        target: null,
        hint: 'Its share of the Cloudflare bill. Counted against the portfolio, not excluded.',
      },
    ],
  },
  {
    slug: 'project-5',
    name: 'Growth OS',
    tagline: 'Agent-run paid ads and organic publishing, with a human approving every spend.',
    repo: 'Billy-Bad-Ass/Project-5',
    stage: 'building',
    revenueModel: 'none',
    accent: '#C2610A',
    icon: 'tower-broadcast',
    startedOn: '2026-08-23',
    reality:
      'Half-deployed, and stuck on one line. Its D1 database exists and is fully migrated — 17 ' +
      'tables including spend_ledger and revenue_events — and its R2 media bucket exists. But ' +
      'there is no bba-growth-os Worker, because wrangler.toml still reads ' +
      'REPLACE_WITH_D1_DATABASE_ID and a binding pointing at a placeholder fails the deploy ' +
      'outright. Exactly the trap Project 4 hit. When it does run, this is the only project ' +
      'that deliberately SPENDS to make the others earn: ads on five platforms, organic posting ' +
      'to nine, and Stripe revenue joined back to ad spend so the number driving decisions is ' +
      'return on ad spend rather than clicks. Its revenue model is "none" because it earns ' +
      'nothing itself — its cost is the point, and the thing to watch is whether that cost ' +
      'turns into revenue somewhere else in this portfolio.',
    gates: [
      'Paste the real D1 id into wrangler.toml — the database is already there and migrated',
      'Deploy the Worker, and confirm its cron triggers registered',
      'Connect at least one ad platform and one social platform for real',
      'Prove the approval gate holds: nothing spends or publishes without a human',
      'Get one campaign to a measurable ROAS, positive or negative — either is information',
    ],
    vitals: [
      {
        key: 'ad_spend',
        label: 'Ad spend',
        source: 'ledger',
        unit: 'gbp',
        target: null,
        hint: 'Money out through the ad platforms. Reported in minor units like everything else.',
      },
      {
        key: 'roas',
        label: 'Return on ad spend',
        source: 'manual',
        unit: 'percent',
        target: 100,
        hint: 'Stripe revenue attributed back to spend. Below 100% is losing money to buy data.',
      },
      {
        key: 'pending_approvals',
        label: 'Awaiting approval',
        source: 'manual',
        unit: 'count',
        lowerIsBetter: true,
        target: 5,
        hint: 'Drafts and budgets queued for a human. A growing queue is the bottleneck.',
      },
      {
        key: 'days_since_commit',
        label: 'Days since commit',
        source: 'github',
        unit: 'days',
        lowerIsBetter: true,
        target: 14,
        hint: 'Days since the repository last moved.',
      },
    ],
  },
];

export function projectBySlug(slug: string): Project | undefined {
  return PROJECTS.find((p) => p.slug === slug);
}

/** Repo full-names the GitHub poller should watch. */
export function watchedRepos(): string[] {
  return PROJECTS.map((p) => p.repo);
}

export const STAGE_LABEL: Record<Stage, string> = {
  idea: 'Idea',
  building: 'Building',
  shipped: 'Shipped',
  earning: 'Earning',
  paused: 'Paused',
};

/** Stage ordering, for sorting the portfolio by how far along things are. */
export const STAGE_RANK: Record<Stage, number> = {
  earning: 0,
  shipped: 1,
  building: 2,
  idea: 3,
  paused: 4,
};
