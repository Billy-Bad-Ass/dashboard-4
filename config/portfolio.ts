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

export const CURRENCY = 'gbp' as const;

/**
 * Money is stored and passed around in pence, everywhere, always. `500` is
 * £5.00. Project-2 uses the same convention; the classic failure in this
 * codebase is a 100x error, so there is one formatter and it takes pence.
 */
export const MONEY_UNIT = 'pence' as const;

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
      'Point a real domain at it — a github.io subpath will not rank',
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
    name: 'Project 3',
    tagline: 'Unstarted. Repository exists, nothing in it but a README.',
    repo: 'Billy-Bad-Ass/Project-3',
    stage: 'idea',
    revenueModel: 'none',
    accent: '#8B93A3',
    icon: 'seedling',
    startedOn: '2026-08-23',
    reality:
      'Genuinely empty — one README, one line. It is on the dashboard so the slot is visible ' +
      'and the decision to fill it stays deliberate. Give it a revenue model in ' +
      'config/portfolio.ts and its page reshapes itself around it.',
    gates: [
      'Decide what it is',
      'Pick a revenue model and set it in config/portfolio.ts',
      'Ship something reachable',
    ],
    vitals: [
      {
        key: 'commits',
        label: 'Commits',
        source: 'github',
        unit: 'count',
        target: null,
        hint: 'Any movement at all. Right now this is the only signal it has.',
      },
      {
        key: 'days_since_commit',
        label: 'Days since commit',
        source: 'github',
        unit: 'days',
        lowerIsBetter: true,
        target: 14,
        hint: 'How long the slot has been sitting idle.',
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
    startedOn: '2026-08-23',
    reality:
      'Internal tooling — it will never earn a penny directly, and it costs real money to run. ' +
      'It earns its keep by making the other projects’ numbers impossible to avoid looking at. ' +
      'It is listed here so its own running cost stays inside the portfolio ROI rather than ' +
      'hiding outside it.',
    gates: [
      'Create the D1 database and KV namespace, fill the ids into wrangler.jsonc',
      'Set the Stripe, GitHub and calendar secrets',
      'Deploy to Workers and confirm the cron heartbeat is ticking',
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
