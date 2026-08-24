# Decisions

Why this is built the way it is. Read before changing architecture — most of
these look arbitrary until you hit the thing they were avoiding.

## Unknown is not zero

**Decision.** Every metric can be `null`, and `null` renders as `—` while `0`
renders as `0`.

**Why.** This portfolio earns nothing. A dashboard that rendered "no Stripe key
configured" and "measured, and it is zero" identically would be a screen of
zeroes indistinguishable from a broken one — and the wrong reading is the
comfortable one ("nothing's connected, that's why it's empty") exactly when the
uncomfortable one is true.

**Cost.** Every metric path carries a nullable, and `resolveVitals` has an
explicit case per key rather than a lookup table.

## Money is integer minor units

**Decision.** Every amount, in D1 and in TypeScript, is an integer of minor
units. `500` is $5.00.

**Why.** Matches Project-2, so moving between repos does not mean switching
convention. Floats in SQLite store 5.00 as 4.999999. And the failure mode of
getting it wrong is a 100x error on a number you then make decisions from.

**Cost.** Every display goes through `formatMoney()`. `parseMoney()` has to do
`toFixed(2)` before multiplying, because `19.99 * 100` is `1998.9999999999998`.

## Recurring spend is expanded, not duplicated

**Decision.** A `$5/month` row is one row with `recurrence: 'monthly'`, expanded
into occurrences at read time. Cancelling sets `ended_on`.

**Why.** Storing twelve rows a year would work, but then cancelling means
editing history, and last quarter's ROI silently changes.

**Cost.** `expandSpend()` has to handle month-end anchoring (a subscription
billing on the 31st must not skip February) and is capped at 1200 iterations. An
early version anchored the walk to the subscription's start date, which meant a
long-running subscription burned the cap on decades nobody asked for and dropped
the recent charges — `tests/finance.test.mts` pins that.

## Overhead is apportioned, not hidden

**Decision.** Spend with no `project_slug` is split across projects by the
`overhead_apportionment` setting. Default `active`: everything past the `idea`
stage.

**Why.** The Cloudflare bill is not "Project 2's cost", but it is not free
either. `active` rather than `even` because an empty repository absorbing a
share of the bill drags down a working project's ROI for no reason.

**Cost.** Two spend numbers per project (direct and total) and a UI that has to
explain which is which. The integer split assigns its remainder to the first
bearer so per-project shares always add back to the total.

## Cloudflare Workers, D1, KV, R2 — not a VPS or a managed database

**Decision.** Everything on the $5/month Workers Paid plan.

**Why.** It is already being paid for. D1 gives 5 GB (this uses megabytes), R2
egress is free, and the Paid plan is what allows a 10-minute cron at all. It is
also the same stack as Project-2, so operational knowledge transfers.

**Cost.** No Node filesystem, no long-running processes, a CPU budget in
milliseconds. That is what forced the split between the Worker cron (polls) and
GitHub Actions (thinks).

## The calendar is read through the private iCal address, not OAuth

**Decision.** `CALENDAR_ICS_URL`, read-only, one fetch.

**Why.** OAuth would allow writing events but needs a consent screen, a stored
refresh token, and re-consent whenever scopes change. For a dashboard that only
ever shows what is coming up, that is a lot of moving parts to keep working.

**Cost.** Cannot create or move events — booking stays in Google. The URL is a
bearer credential: anyone holding it can read the calendar. It is stored as a
Worker secret and never rendered.

**Consequence.** A hand-written ICS parser, covering the subset Google actually
emits. It handles line unfolding, `VALUE=DATE` all-day events, `TEXT` escaping
and `STATUS:CANCELLED`. It does not expand recurrence rules.

## One shared bearer token, not a user system

**Decision.** `DASHBOARD_TOKEN` guards every write endpoint. Unset means writes
are open.

**Why.** One operator. A session/user system would be more code to maintain than
the thing it protects.

**Cost.** Failing *open* when unset is a real risk, mitigated by loud banners on
`/setup` and the overview. The documented answer for real protection is
Cloudflare Access in front of the Worker — included in the plan already paid
for.

## Prospects and clients share one table

**Decision.** One `clients` table; `status` distinguishes them.

**Why.** When a prospect signs, its row changes status and keeps every
interaction that led there. Two tables would mean copying the history or losing
it, and the history is the part that tells you which outreach works.

**Cost.** Queries filter on status constantly. Worth it.

## Interactions are append-only

**Decision.** `interactions` rows are inserted, never updated. Logging one also
advances the client's `last_contact_on`, in the same repository function.

**Why.** An editable history is a history that gets tidied. And a CRM where you
can log a call and still show as cold is a CRM you stop believing — so the two
writes are never separated.

## Icons are vendored, not linked

**Decision.** ~60 Font Awesome paths extracted into `lib/icons.generated.ts`.

**Why.** A CDN link is a third-party request on every page load; the npm package
is two thousand icons for the sixty used. Inline SVG has no webfont flash and no
network.

**Cost.** `npm run icons:build` when a new icon is needed, and the CC BY 4.0
attribution in `NOTICE.md` is a licence obligation. CI checks the generated file
has not been hand-edited.

## Gates live in code

**Decision.** Each project's "what has to be true before this earns" list is in
`config/portfolio.ts`, not the database, and has no UI to tick items off.

**Why.** A gate you can tick off in a web form without a commit is a gate you
will tick off without doing the work.

**Cost.** Updating a gate needs a commit. That is the feature.

## The project pages are dynamic, with no `generateStaticParams`

**Decision.** Deliberately absent.

**Why.** Adding it makes Next prerender the four project pages at build time,
and a prerendered page on a live dashboard serves whatever the numbers were when
the deploy ran — which looks exactly like a working page. This was caught in the
build output during development, not by a user.

## No chart library

**Decision.** Sparklines and bars are hand-rolled inline SVG.

**Why.** The entire need is one polyline and a filled area. A charting
dependency would be larger than the rest of the app's JavaScript.

**Cost.** The flat-line case had to be handled explicitly — every value being
zero (the current state of every revenue series here) must draw a visible line
along the bottom rather than dividing by zero and producing `NaN` in the path.

## Silence is a state, not an empty cell

**Decision.** `lib/fleet.ts` computes each scheduled agent's last expected fire
from its cron expression and compares it against `agent_runs`. `overdue` and
`never reported` render in the same red as a failed run.

**Why.** The Agents page once showed `RUNS RECORDED: 1` beside
`FAILURES: 0 — Nothing failing`, while seven of eight scheduled agents read
`LAST RUN: never`. Both numbers were true and together they were a lie: nothing
was failing because nothing was reporting. `heartbeat-watchdog` — the agent
whose entire job is noticing that the dashboard has gone quiet — had been
silent since it was created, and the console reported that as health.

This is the same rule as "unknown is not zero", one level up. There, a missing
metric must not render as `0`. Here, a missing *run* must not render as an
absence. Both failures are comfortable in the same direction: they make a
broken system look like a working one with nothing to report.

**Cost.** A cron parser this repo would otherwise not need, and a grace period
that has to be tuned — an hour, capped at half the interval between fires, to
absorb GitHub's best-effort scheduling without absorbing a dead schedule. An
agent registered with a schedule it does not really keep now reads as
permanently overdue; that is intended, and the fix is the schedule.

## Most of these agents cannot move to Cloudflare Cron Triggers

**Decision.** The scheduled agents in this repository stay on GitHub Actions.
Project 6's `link-warden` and `redirect-guard` run as Worker cron triggers and
are registered here as an explicit exception.

**Why.** The migration is attractive — Workers Builds replaces the deploy
workflow, `triggers.crons` replaces the scheduled ones, and
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` can then be deleted from the
repository's Actions secrets. Project 6 did it in a day and it went cleanly.

It went cleanly because both of its checks are pure `fetch`-and-compare: no
model in the loop and no GitHub API call. Every agent here is the opposite.
`portfolio-analyst`, `spend-auditor`, `pipeline-nudge` and `heartbeat-watchdog`
all call Claude and open GitHub issues, and a Worker can do neither without
holding an Anthropic key and a GitHub token as Worker secrets. The credentials
do not disappear in the move; they relocate, from a secret store with an audit
log and an OIDC story into one that has neither. Paying that to delete two
secrets is a bad trade.

There is a second cost, learned from Project 6: Workers Builds has no
post-deploy hook, so its deploy no longer smoke-tests the live site. A bad
deploy is now caught by a daily cron instead of within two minutes. Acceptable
for a site with no sales; not acceptable for the dashboard the other projects
are judged from.

**Cost.** The deploy workflow and the four scheduled workflows stay, and so do
their Cloudflare secrets. What is worth taking from Project 6 is the *shape* —
a deterministic check that reports its finding whether or not an agent is
available to interpret it — and that has been taken, in
`.github/actions/report-run` and the watchdog's probe step.

**Revisit when.** An agent here stops needing a model or the GitHub API. The
deterministic half of `heartbeat-watchdog` — probe the pulse endpoint, compare
`lastCronMinutes` against a threshold — is already exactly Project 6's shape and
could move on its own, leaving the issue-opening half behind. That split is
worth doing if the Actions minutes ever matter; today they do not.
