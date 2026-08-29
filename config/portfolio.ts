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

import type { VitalUnit } from '@/lib/vitals';

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
  /**
   * How to recognise this project's charges in Stripe.
   *
   * Needed from the moment a second project started selling. Before that the
   * reconciler took "the first project whose revenueModel is stripe", which was
   * fine with one seller and silently wrong with two — a $100 audit would have
   * landed on the store's ROI.
   *
   * Matched case-insensitively against the charge's statement descriptor and
   * description. A charge that matches nothing is NOT guessed at: it is
   * recorded as unattributed and shown as such.
   */
  stripeMatch?: {
    descriptors?: string[];
    products?: string[];
  };
  /**
   * The Cloudflare Worker this project's public traffic runs on.
   *
   * Without it a `cloudflare`-sourced vital has nowhere to read from: the
   * connector returns per-script counts and nothing knows which script belongs
   * to whom. Omit it for a project with no Worker of its own — that renders as
   * unknown, which is the truth, rather than borrowing another project's
   * traffic.
   */
  cloudflareScript?: string;
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
  /**
   * Declared in `lib/vitals.ts`, beside the formatter that reads it, so a chart
   * can import the union without importing this register. The note there says
   * why that separation matters: a client component may import a unit, but it
   * must never be handed a formatter.
   */
  unit: VitalUnit;
  /** Higher is better, unless this is set. */
  lowerIsBetter?: boolean;
  /** What a healthy value looks like. Null when there is no meaningful target yet. */
  target: number | null;
  hint: string;
}

/** Re-exported so there is exactly one place the currency is decided. */
export { DEFAULT_CURRENCY as CURRENCY } from '@/lib/money';
export type { VitalUnit } from '@/lib/vitals';

/**
 * Money is stored and passed around in minor units, everywhere, always. `500`
 * is $5.00. network-store-2 uses the same convention; the classic failure in this
 * codebase is a 100x error, so there is one formatter and it takes minor units.
 */
export const MONEY_UNIT = 'minor' as const;

export const PROJECTS: Project[] = [
  {
    slug: 'project-1',
    name: 'Website Health Check',
    tagline: 'A plain-English website audit, delivered within a working day. $100.',
    repo: 'Billy-Bad-Ass/sitecheck-1',
    stage: 'shipped',
    revenueModel: 'stripe',
    accent: '#2B5CE6',
    icon: 'magnifying-glass-chart',
    startedOn: '2026-08-22',
    stripeMatch: {
      descriptors: ['BBA NETWORK AUDIT'],
      products: ['prod_V7tZMsJQTM8AMG'],
    },
    reality:
      'The first thing in this portfolio that a stranger can actually buy. Live in Stripe at ' +
      '$100 one-time, sold through a Payment Link with no webhook — fulfilment polls Stripe ' +
      'when you run it, which is why there is no server to keep online and no signing secret to ' +
      'leak. Delivery is promised within a working day, so a human still has to run the ' +
      'command; nothing here is passive income. ' +
      'The repository also still contains pSEO Forge, the programmatic-SEO affiliate engine ' +
      'this project started as. That engine is finished but unmonetised, and the audit is what ' +
      'is being sold — the README has not caught up.',
    gates: [
      'Sell one. Everything else here is theory until a stranger pays $100',
      'Time the fulfilment run end to end — "within a working day" is a promise you have made',
      'Find prospects at a rate that outpaces the ones you burn',
      'Decide whether the pSEO engine in src/ is still worth carrying, or is dead weight',
    ],
    vitals: [
      {
        key: 'revenue',
        label: 'Revenue',
        source: 'stripe',
        unit: 'gbp',
        target: null,
        hint: 'Net of refunds, matched to this project by its Stripe statement descriptor.',
      },
      {
        key: 'units',
        label: 'Audits sold',
        source: 'stripe',
        unit: 'count',
        target: null,
        hint: 'Paid charges. Each one is a report a human has to actually write and send.',
      },
      {
        key: 'refund_rate',
        label: 'Refund rate',
        source: 'stripe',
        unit: 'percent',
        lowerIsBetter: true,
        target: 5,
        hint: 'On a delivered service a refund means the report missed. Read it as feedback.',
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
  {
    slug: 'project-2',
    name: 'BBA Network Store',
    tagline: 'Printable reference guides sold as digital downloads.',
    repo: 'Billy-Bad-Ass/network-store-2',
    cloudflareScript: 'bba-network-store',
    stage: 'shipped',
    revenueModel: 'stripe',
    accent: '#12A150',
    icon: 'credit-card',
    liveUrl: 'https://bba-network-store.bbacentralworkspace.workers.dev',
    startedOn: '2026-08-23',
    stripeMatch: {
      descriptors: ['BBA NETWORK', 'BBA NETWORK STORE'],
    },
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
        key: 'visitors',
        label: 'Visitors',
        source: 'cloudflare',
        unit: 'count',
        target: null,
        hint:
          'Requests to the storefront Worker over the last 7 days. Zero sales with zero ' +
          'visitors is a distribution problem; zero sales with visitors is a page problem.',
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
    repo: 'Billy-Bad-Ass/trading-3',
    stage: 'building',
    revenueModel: 'none',
    accent: '#B5179E',
    icon: 'chart-line',
    startedOn: '2026-08-23',
    reality:
      'Research, not a trading system. Nothing in the repository can place an order, send, ' +
      'publish or spend — verified in the repository, not taken on trust: no broker, no ' +
      'credential, no account, and a watchman check that flags any live trade lacking a risk ' +
      'PASS. Topstep also bars remote servers from placing orders in its own terms, so on that ' +
      'venue the block is the counterparty\'s as well as ours. It is back on Cloudflare as of ' +
      '2026-08-23 — bba-trading-runner and bba-trading-watchman, both with a wrangler.toml and ' +
      'a deploy-workers workflow. The earlier "moved off on 2026-08-21" note is superseded. ' +
      '🔴 As of 2026-08-23 it has NO SURVIVING STRATEGY: both engines triggered on a close ' +
      'beyond a level and then filled AT that level, buying the wick with the close\'s ' +
      'hindsight. Fair fills killed the reversal outright (+2.82 to -6.92 points a trade) and ' +
      'dropped ORB from +10.68 to +3.03, failing three gates. That is the system working. The ' +
      'only unrefuted variant is a limit-order fill model that has not been built. Its ' +
      'revenue model is deliberately ' +
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
    repo: 'Billy-Bad-Ass/dashboard-4',
    cloudflareScript: 'bba-heartbeat',
    stage: 'building',
    revenueModel: 'none',
    accent: '#7C5CE6',
    icon: 'heart-pulse',
    liveUrl: 'https://heartbeat.bbanetwork.org',
    startedOn: '2026-08-23',
    reality:
      'Live at heartbeat.bbanetwork.org since 2026-08-24, ticking every ten minutes, with ' +
      'Stripe, GitHub and Cloudflare all reporting measured numbers. Internal tooling — it ' +
      'will never earn a penny directly, and it costs real money to run. It earns its keep by making the other projects’ numbers ' +
      'impossible to avoid looking at, and it is listed here so its own running cost stays ' +
      'inside the portfolio ROI rather than hiding outside it.',
    gates: [
      // Access is per-hostname. A policy on the workers.dev name does not
      // follow the site to heartbeat.bbanetwork.org, and this page shows
      // revenue, spend and the client list to anyone who reaches it.
      'Confirm Cloudflare Access covers heartbeat.bbanetwork.org, not only the workers.dev name',
      'Decide whether the workers.dev hostname stays reachable — right now it is a second door',
      'Set CALENDAR_ICS_URL, or drop the calendar tile rather than leave it permanently grey',
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
    repo: 'Billy-Bad-Ass/growth-os-5',
    cloudflareScript: 'bba-growth-os',
    stage: 'building',
    revenueModel: 'none',
    accent: '#C2610A',
    icon: 'tower-broadcast',
    startedOn: '2026-08-23',
    liveUrl: 'https://bba-growth-os.bbacentralworkspace.workers.dev',
    reality:
      'Deployed on 2026-08-23 and connected to nothing. Two blockers cleared in sequence: the ' +
      'wrangler.toml placeholders were replaced with the real D1, KV and R2 ids, and then the ' +
      'repository had no CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID at all, so every run ' +
      'died at the migration step before touching Cloudflare. Both fixed; the Worker is live. ' +
      'What it does NOT have is a single ad or social platform connected, which is the whole ' +
      'product — so treat "deployed" as the start of the work, not the end of it. This is the ' +
      'only project that deliberately SPENDS to make the others earn: ads on five platforms, ' +
      'organic posting to nine, and Stripe revenue joined back to ad spend so the number ' +
      'driving decisions is return on ad spend rather than clicks. Its revenue model is "none" ' +
      'because it earns nothing itself — its cost is the point, and the thing to watch is ' +
      'whether that cost turns into revenue somewhere else in this portfolio.',
    gates: [
      'Confirm its cron triggers actually registered — a deployed Worker is not a running one',
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
  {
    slug: 'project-6',
    name: 'BBA Network Web',
    tagline: 'The public face — brand hub, storefront and audit service across subdomains.',
    repo: 'Billy-Bad-Ass/web-6',
    cloudflareScript: 'bba-network-hub',
    stage: 'building',
    revenueModel: 'none',
    accent: '#0E7490',
    icon: 'circle-nodes',
    startedOn: '2026-08-23',
    liveUrl: 'https://bba-network-hub.bbacentralworkspace.workers.dev',
    reality:
      'Deployed as bba-network-hub on 2026-08-23. The shopfront, not a business. It earns ' +
      'a visitor who buys an audit is ' +
      'revenue for project-1 and one who buys a guide is revenue for project-2, and attributing ' +
      'a sale here would double-count it. What it owns is whether a stranger who lands on ' +
      'bbanetwork.org understands what is on offer and gets to the right place — which is ' +
      'currently the binding constraint on both of the projects that DO earn, since neither has ' +
      'ever been put in front of anyone.',
    gates: [
      'Put the brand hub on the apex, with each business one click away',
      'Point guides. and audit. at the storefront and the audit service',
      'Get one stranger to the audit page who did not come from you',
      'Make the audit page good enough that arriving and paying is one decision',
    ],
    vitals: [
      {
        key: 'commits',
        label: 'Commits',
        source: 'github',
        unit: 'count',
        target: null,
        hint: 'Build activity. It has no revenue signal of its own by design.',
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
      {
        key: 'visitors',
        label: 'Visitors',
        source: 'cloudflare',
        unit: 'count',
        target: null,
        hint: 'Traffic to the public site. Unknown until it is deployed and the token is set.',
      },
    ],
  },
];

/** What a Stripe charge needs to expose for attribution. */
export interface ChargeIdentity {
  statementDescriptor?: string | null;
  description?: string | null;
  productIds?: string[];
}

/**
 * Which project earned a charge.
 *
 * Returns null rather than guessing. An unattributed charge is a real state
 * with a real answer — "we do not know which business this was" — and inventing
 * one puts money on the wrong project's ROI permanently.
 *
 * Specificity wins. "BBA NETWORK" and "BBA NETWORK AUDIT" both match a charge
 * descriptored the latter, so candidates are tried longest-first: the audit
 * takes its own charges and the store keeps the rest. Getting this backwards is
 * the exact bug this function exists to prevent.
 */
export function projectForCharge(
  charge: ChargeIdentity,
  projects: Project[] = PROJECTS,
): Project | null {
  // A product id is unambiguous, so it is checked before any text.
  if (charge.productIds?.length) {
    for (const project of projects) {
      const owned = project.stripeMatch?.products ?? [];
      if (owned.some((id) => charge.productIds!.includes(id))) return project;
    }
  }

  const haystack = `${charge.statementDescriptor ?? ''} ${charge.description ?? ''}`
    .toLowerCase()
    .trim();
  if (!haystack) return null;

  const candidates = projects.flatMap((project) =>
    (project.stripeMatch?.descriptors ?? []).map((descriptor) => ({
      project,
      descriptor: descriptor.toLowerCase(),
    })),
  );
  // Longest descriptor first — specificity beats declaration order.
  candidates.sort((a, b) => b.descriptor.length - a.descriptor.length);

  return candidates.find(({ descriptor }) => haystack.includes(descriptor))?.project ?? null;
}

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
