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
| `link-warden` | Project-6 | Every business the register calls `live` is reachable. |
| `redirect-guard` | Project-6 | The legacy apex paths carrying paying customers to downloads. |

Project 6's two are the first agents here that are **not** GitHub Actions: both
run as Cloudflare Cron Triggers on the `bba-network-hub` Worker. The register
carries a `platform` field for exactly this reason — the console used to build
an Actions URL from the workflow filename for every agent, and a link to a page
that does not exist is worse than no link. See `docs/DECISIONS.md` for why most
of the agents in *this* repository cannot follow them onto a Worker.

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
ran rather than what the YAML claims would run. Use the composite action rather
than a hand-rolled curl:

```yaml
- name: Report the outcome
  if: always()
  uses: ./.github/actions/report-run
  with:
    agent: portfolio-analyst          # must match a name in config/agents.ts
    status: ${{ steps.review.outcome == 'failure' && 'failed' || 'ok' }}
    started_at: ${{ steps.start.outputs.started }}
    summary: Weekly portfolio review.
    artifact_url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
    dashboard_url: ${{ secrets.DASHBOARD_URL }}
    dashboard_token: ${{ secrets.DASHBOARD_TOKEN }}
    access_client_id: ${{ secrets.CF_ACCESS_CLIENT_ID }}
    access_client_secret: ${{ secrets.CF_ACCESS_CLIENT_SECRET }}
```

Valid `status`: `queued`, `running`, `ok`, `failed`, `skipped`.
Valid `trigger`: `cron`, `manual`, `github`, `webhook`.

**Two rules that pull against each other, and both hold.** A reporting problem
must never fail the run — losing a log entry is a much smaller loss than losing
the review the run just produced. And a reporting problem must never look like
success.

Every reporting step used to end in `|| true`, which satisfied the first rule
by abandoning the second. With `DASHBOARD_URL` unset that posts nothing, prints
nothing and exits 0, so four workflows reported nothing for their entire lives
while the console showed no failures. The action exits 0 always and annotates
loudly on anything that is not a 2xx.

**A 3xx is not a success.** `curl -f` does not fail on a redirect, so a POST
that Cloudflare Access answers with a `302` to its login page reads as a
success to `curl -sf`. The action reads the status code and requires a 2xx.
Project 6 shipped the naive version of this fix first and logged
`Reported to ...` over exactly that redirect.

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

| Secret | Used by | Missing means |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | every agent workflow | see below |
| `ANTHROPIC_API_KEY` | every agent workflow, and `/ask` | see below |
| `DASHBOARD_URL` | every agent workflow | nothing is reported, and the console shows every agent as never having run |
| `DASHBOARD_TOKEN` | the run-reporting steps | a 401 from the write endpoints, once the Worker has one set |
| `CF_ACCESS_CLIENT_ID` | the run-reporting steps | a 302 to the Access login page, once `DASHBOARD_URL` is set |
| `CF_ACCESS_CLIENT_SECRET` | the run-reporting steps | as above |

`GITHUB_TOKEN` is provided automatically by Actions.

**A Claude credential is optional, and every workflow is built that way.** With
neither `CLAUDE_CODE_OAUTH_TOKEN` nor `ANTHROPIC_API_KEY` set,
`claude-code-action` fails and takes the whole job red — which in the watchdog
meant the deterministic probe had *already* found the answer and had it buried
inside a job marked failed. A red run meaning "no credential" is
indistinguishable from a red run meaning "the dashboard is down", so the run's
colour stopped carrying information.

Every workflow now gates the agent step on `./.github/actions/investigator` and
emits a `::warning` in its place. You lose the investigation and the issue. You
do not lose the fact.

Prefer `CLAUDE_CODE_OAUTH_TOKEN`: on a Max plan those runs cost nothing, where
an API key bills per token. The action gives the API key precedence when both
are present, which is why the key is deliberately blanked in the YAML when a
subscription token exists.

**Cloudflare Access fronts the Worker at *Worker* scope**, not hostname scope,
so it covers `/api/agent-runs` on every hostname routed there. Once
`DASHBOARD_URL` is set, CI posting to it needs an Access **service token** plus
a **Service Auth** policy on the application — *alongside* the existing
"Only me" policy, not replacing it.

## Silence is a finding

`config/agents.ts` says what should run; `agent_runs` says what reported. The
gap between them is computed in `lib/fleet.ts` and shown on `/agents`.

This exists because the console once displayed `RUNS RECORDED: 1` and
`FAILURES: 0 — Nothing failing` while seven of eight scheduled agents had never
reported once. Both numbers were true. Together they were a lie: nothing was
failing because nothing was reporting.

Every scheduled agent carries a cron expression, so the time it should last
have fired is arithmetic, and an agent that missed it is a finding with a
timestamp rather than an empty cell. The states:

| State | Means |
| --- | --- |
| `reporting` | reported at or since its last scheduled fire |
| `overdue` | ran before, nothing since the fire it should have reported |
| `never reported` | scheduled, and no run has ever been recorded |
| `stalled` | a start posted and no finish ever did |
| `unreadable schedule` | the registered cron could not be parsed |
| `on demand` | event-triggered; there is no schedule to be late for |

`overdue` and `never reported` are rendered in the same red as a failed run, on
purpose. A failed run is a run — it reported. Silence did not.

One consequence worth stating plainly: a schedule in the register that the
agent does not really keep will read as permanently overdue. That is the
correct outcome. Fix the schedule, not the display.
