# Agent orchestration

This portfolio is built to be operated by agents as well as by hand. This is the
map: who owns what, what runs automatically, and where the guardrails are.

## The four layers

```
  Worker cron                    wrangler.jsonc triggers
  (every 10 min / hourly / daily) polls connectors, snapshots metrics, prunes
             │                    milliseconds of CPU — no thinking
             ▼
  Scheduled orchestration        .github/workflows/agent-*.yml
  (GitHub Actions, on a cron)    runs Claude Code headless, opens issues and PRs
             │                    minutes of wall time — this is where analysis happens
             ▼
  Deterministic workflows        .claude/workflows/*.mjs
  (Workflow tool)                fan out, verify adversarially, synthesise
             │
             ▼
  Specialist subagents           .claude/agents/*.md
  (Agent tool)                   one job each, with the house rules baked in
```

The split between the top two layers is the important one. A Worker has a CPU
budget measured in milliseconds; an agent run takes minutes. The cron keeps the
numbers fresh, the Actions agents do the thinking, and they never do each
other's job.

## Portfolio agents

These run from **this** repository, against the whole portfolio.

| Agent | Owns | Runs |
| --- | --- | --- |
| `portfolio-analyst` | The weekly review. What moved, what did not, and one recommendation. | Mondays 07:00 UTC |
| `spend-auditor` | Reconciles the ledger against reality — dead subscriptions, unrecorded costs. | 1st of the month |
| `pipeline-nudge` | Actions due, relationships going cold. Reports; never contacts anybody. | Weekdays 08:00 UTC |
| `heartbeat-watchdog` | Checks the dashboard itself is alive. | Every 6 hours |
| `mention-router` | Routes an `@claude` mention here to the right specialist. | On mention |

## Project agents

These run from their **own** repositories. This dashboard does not schedule
them — it shows their runs, because they report to `/api/agent-runs`.

| Agent | Repository | Owns |
| --- | --- | --- |
| `revenue-analyst` | Project-2 | The store's Stripe digest. |
| `market-researcher` | Project-2 | Demand signals, competitor pricing, keyword gaps. |
| `listing-copywriter` | Project-2 | Titles, descriptions, marketplace copy. |
| `release-qa` | Project-2 | Go/no-go before a deploy. |
| `dataset-refresh` | Project-1 | Rebuilds the pSEO dataset daily. |

Keeping the distinction visible matters: a scheduled job you believe this repo
owns, but which actually lives elsewhere, is a job nobody maintains.

## Workflows

Run with the Workflow tool, or via their slash command.

| Workflow | Command | Shape |
| --- | --- | --- |
| `portfolio-review` | `/portfolio-review` | one analyst per project in parallel → adversarial verification of every finding → one ranked action |
| `gate-check` | `/gate-check <slug>` | one agent per gate, reading the actual code → ranked by what unblocks the most |

Both verify their findings before reporting them. That is deliberate: a
plausible-but-wrong reading of a pre-revenue portfolio ("Project 2 is earning")
leads to exactly the wrong decision, and it is cheap to check against an API
that returns the real number.

Validate them after editing:

```bash
npm run workflows:check
```

Workflow scripts run as an async function body with `agent`, `parallel`,
`pipeline`, `phase`, `log`, `args` and `budget` injected. They have **no
filesystem or Node API access**, and `Date.now()`, `Math.random()` and argless
`new Date()` throw — the checker enforces all of that, so a broken workflow
fails at commit time rather than twenty minutes into a scheduled run.

## How an agent reads the portfolio

Not from the repository. From the dashboard's own API:

```bash
curl -s "$DASHBOARD_URL/api/pulse" | jq .
```

That single document holds live finance, per-project health, connector status,
agent runs and the pipeline. Reading the code to work out whether Project 2 is
earning is both slower and wrong — the code says what it could do, the API says
what happened.

## Reporting a run

Every scheduled workflow POSTs its outcome so the console shows what actually
ran rather than what the YAML claims would run:

```bash
curl -sf -X POST "$DASHBOARD_URL/api/agent-runs" \
  -H "Authorization: Bearer $DASHBOARD_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"agent":"portfolio-analyst","trigger":"cron","status":"ok",
       "summary":"Weekly review.","artifact_url":"https://github.com/.../runs/123"}'
```

Every reporting step ends in `|| true`. The dashboard being down must not fail
an agent run — losing the log entry is a much smaller problem than losing the
review.

Valid `status`: `queued`, `running`, `ok`, `failed`, `skipped`.
Valid `trigger`: `cron`, `manual`, `github`, `webhook`.

## Guardrails

These are in the agent definitions and they are not negotiable:

- **No agent writes to Stripe.** Refunds and price changes are human decisions.
- **No agent contacts a client.** `pipeline-nudge` reports who needs contacting
  and stops there. It has no standing to speak to anybody on your behalf.
- **No agent edits the spend ledger.** It is a financial record. Agents propose
  with the exact command; a human applies.
- **No agent invents a number.** An unconfigured connector means the metric is
  unknown, and "unknown" is the finding.
- **Silence is a valid output.** `heartbeat-watchdog` writes nothing when
  everything is fine; `pipeline-nudge` opens no issue on a clean week. An agent
  that reports "all good" four times a day is an agent whose issues nobody
  reads.

## Secrets these need

In this repository's Actions secrets:

| Secret | Used by |
| --- | --- |
| `ANTHROPIC_API_KEY` | every agent workflow |
| `DASHBOARD_URL` | every agent workflow |
| `DASHBOARD_TOKEN` | the run-reporting steps |

`GITHUB_TOKEN` is provided automatically by Actions.
