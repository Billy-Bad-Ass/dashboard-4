# BBA Network — Heartbeat

The instrument panel for the BBA Network portfolio. One site, one page per
project, live numbers: what each project earns, what it costs, whether anything
is actually being built, who is in the pipeline, and what the agent fleet did
about any of it.

```
Cloudflare Workers ($5/mo Paid plan)
  │
  ├── D1        projects · spend · revenue · clients · deals · metrics · agent runs
  ├── KV        hot cache in front of Stripe / GitHub / Cloudflare / Calendar
  ├── R2        report and export archive
  └── Cron      the heartbeat — every 10 minutes, hourly, daily
        │
        ▼
   Next.js 15 (App Router) via @opennextjs/cloudflare
```

## The one thing to understand first

**A number that is unknown renders as `—`. A number that was measured and is
zero renders as `0`.**

That distinction is the whole design. This portfolio currently earns nothing, so
a dashboard that collapsed "we checked and it is zero" into "nothing reported
this" would be indistinguishable from a broken one. Every tile, every ROI figure
and every vital honours it:

| Shown | Means |
| --- | --- |
| `£0.00` | Measured. Genuinely zero. |
| `—` | Nothing has reported this. Connector unconfigured, or metric never captured. |
| ROI `—` | Nothing has been spent, so the ratio is undefined — not zero. |
| ROI `-100%` | Money went out, none came back. A real and useful number. |

## Quick start

**No terminal? Read [docs/IPAD.md](docs/IPAD.md).** The whole setup runs from a
browser: two secrets into GitHub, then press one button in the Actions tab and a
runner does the command-line work. That is the supported path — this dashboard is
operated from an iPad.

With a terminal:

```bash
npm install
npm run setup             # creates the storage, loads your secrets, deploys
```

`npm run setup` is the whole first-time flow: it creates the D1 database, KV
namespace and R2 bucket, writes their ids into `wrangler.jsonc`, applies the
migrations, walks through each secret explaining where to get it, and offers to
deploy. It is idempotent — safe to re-run after a half-finished attempt.

To just look at it locally:

```bash
npm run build && npm start   # → http://localhost:3000
```

It runs with no configuration at all — every connector degrades to a clearly
labelled "not connected" state, and `/setup` shows what is missing. See
**[docs/RUNBOOK.md](docs/RUNBOOK.md)** for the manual sequence and
troubleshooting.

### What it costs to run

Cloudflare, GitHub Actions and the scheduled agents are all covered by things
already paid for — the $5/month Workers plan and, for the agents, a Claude Max
subscription via `CLAUDE_CODE_OAUTH_TOKEN`.

The `/ask` page is the exception: it is a deployed web app calling the Claude
API, which is billed separately from any Claude subscription. Roughly £0.09 a
question on the default model, or about a fifth of that with `ASK_MODEL` set to
`claude-haiku-4-5`. Leave `ANTHROPIC_API_KEY` unset and everything else still
works.

## How it fits together

| Path | What it is |
| --- | --- |
| `config/portfolio.ts` | **The register.** The one file you edit when a project is added, renamed or changes what it is trying to earn. Drives the nav, the routes, the pollers and the ROI maths. |
| `config/agents.ts` | The agent fleet, and which repository each agent actually runs from. |
| `db/migrations/` | D1 schema. Money is integer pence everywhere. |
| `lib/heartbeat.ts` | `pulse()` — assembles the entire dashboard state. Never throws. |
| `lib/finance.ts` | Recurring-spend expansion, overhead apportionment, ROI. |
| `lib/crm.ts` | Clients, deals, interactions. Prospects and clients share one table. |
| `lib/connectors/` | Stripe, GitHub, Cloudflare, Google Calendar. Each one survives being unconfigured. |
| `lib/cron.ts` | The scheduled tick: poll, snapshot, reconcile, prune. |
| `lib/ask.ts` | The chat brain. Gives Claude tools over the live data rather than a context dump. |
| `app/` | The dashboard. Server components throughout; client components only where something is genuinely interactive. |
| `.claude/` | Subagents, workflows and slash commands — see [docs/AGENTS.md](docs/AGENTS.md). |

## The pages

| Page | What it answers |
| --- | --- |
| `/` | Is anything alive, and is anything wrong? |
| `/ask` | Anything, in plain English — it queries the real data and shows what it looked up. |
| `/projects/[slug]` | For this project: what does it earn, what has it cost, and what is genuinely blocking its first pound? |
| `/finance` | Where every pound went, and what each project has to show for it. |
| `/clients` | Who is a client, who might become one, and who is going cold. |
| `/agents` | What runs automatically, and what it actually did. |
| `/calendar` | What is booked, and what the machines will do without being asked. |
| `/setup` | What is connected, what is not, and the exact command for each. |

## What the portfolio currently looks like

Four projects, registered in `config/portfolio.ts`:

- **Project 1 — pSEO Forge.** Programmatic-SEO affiliate engine. The code is
  finished and rebuilds daily on free CI. It earns nothing because
  `monetisationEnabled` is `false` and there are no affiliate accounts behind
  it. Its page leads with indexable pages and dataset freshness, not revenue.
- **Project 2 — BBA Network Store.** Four SKUs on Workers with Stripe Checkout
  and R2 delivery. Shipped, not earning: live-mode Stripe holds no products and
  has taken no payments.
- **Project 3.** Genuinely empty. On the dashboard so the slot stays visible
  and filling it stays a deliberate decision.
- **Project 4 — this dashboard.** Internal tooling. It will never earn directly
  and it costs real money to run, so its cost is counted *inside* the portfolio
  ROI rather than hidden outside it.

## Rules that are load-bearing

- **Money is integer pence, everywhere.** `500` is £5.00. One formatter, and it
  takes pence. Getting this wrong by 100x is the classic failure here, and the
  convention matches Project-2 deliberately.
- **Never invent a number.** A connector that is unconfigured reports unknown,
  not zero. `lib/heartbeat.ts` enforces this and the UI renders the difference.
- **Read-only on Stripe.** The dashboard never writes. Refunds and price changes
  are human decisions; the key it is given should be a restricted read key.
- **Read-only on the calendar.** Connected via the private iCal address. Booking
  stays in Google.
- **The gates live in code, not the database.** A gate you can tick off without
  a commit is a gate you will tick off without doing the work.
- **Overhead is apportioned, never hidden.** Portfolio-wide spend is split
  across projects by the `overhead_apportionment` setting, and every project
  page says when a figure includes an apportioned share.

## Checks

```bash
npm run typecheck        # strict, noUncheckedIndexedAccess
npm test                 # 47 tests, no build step
npm run workflows:check  # validates .claude/workflows/*.mjs
npm run check            # typecheck + test
```

## Licence and attribution

Icons are [Font Awesome Free](https://fontawesome.com) (CC BY 4.0), vendored
into `lib/icons.generated.ts` by `npm run icons:build`. See [NOTICE.md](NOTICE.md).
