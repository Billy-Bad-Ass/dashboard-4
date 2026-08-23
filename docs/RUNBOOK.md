# Runbook

Everything needed to take this from a repository to a live dashboard, and what
to do when a part of it stops.

## First deploy

> **Working from an iPad or a phone?** [docs/IPAD.md](IPAD.md) is the same thing
> without a terminal — two secrets into GitHub, then one button in the Actions
> tab. This page assumes a command line.

### The short version

```bash
npm install
npm run setup
```

`npm run setup` does steps 1 to 4 below interactively — creates the storage,
writes the ids into `wrangler.jsonc`, applies the migrations, walks through each
secret explaining where to get it, writes `.dev.vars`, and offers to deploy. It
is idempotent, so a half-finished run can just be re-run.

The rest of this section is what it does, for when you want to do it by hand or
something goes wrong part way.

### 1. Create the storage

```bash
wrangler d1 create bba-heartbeat
wrangler kv namespace create CACHE
wrangler r2 bucket create bba-heartbeat-archive
```

Each prints an id. Paste them into `wrangler.jsonc`, replacing the
`REPLACE_WITH_...` placeholders. **This is the step that gets skipped** — the
dashboard runs perfectly well without a database and shows every stored figure
as empty, so a missing binding looks like a quiet business rather than a
misconfiguration. `/setup` says which it is.

### 2. Apply the schema

```bash
npm run db:migrate:local  && npm run db:seed:local     # local dev
npm run db:migrate:remote && npm run db:seed:remote    # production
```

The seed inserts exactly one row: the £5/month Cloudflare subscription. There
are no example clients and no sample revenue — an empty CRM that says "empty" is
more useful than one full of invented people you then have to remember are fake.

### 3. Set the secrets

```bash
wrangler secret put STRIPE_SECRET_KEY      # restricted key, READ scopes only
wrangler secret put GITHUB_TOKEN           # fine-grained PAT, read-only
wrangler secret put CLOUDFLARE_API_TOKEN   # Account Analytics: Read
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put CALENDAR_ICS_URL       # the private iCal address
wrangler secret put DASHBOARD_TOKEN        # openssl rand -hex 32
```

For local development put the same names in `.dev.vars`, which is gitignored.

Where each comes from:

| Secret | Where |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → **restricted key**. Grant read on Charges, Balance, Products, Disputes. Nothing else. |
| `GITHUB_TOKEN` | GitHub → Settings → Developer settings → fine-grained PAT. Read-only on contents, metadata and actions for the four repos. Optional for public repos (60 req/hour unauthenticated is enough for a 10-minute cron); required for private ones. |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create custom token → **Account Analytics: Read** only. |
| `CLOUDFLARE_ACCOUNT_ID` | The hex string in your Cloudflare dashboard URL. |
| `CALENDAR_ICS_URL` | Google Calendar → Settings → the calendar → **Secret address in iCal format**. Treat it as a password: anyone holding it can read the calendar. Regenerating it in Google revokes the old one. |
| `DASHBOARD_TOKEN` | Any long random string. Guards every write endpoint. |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys. Powers the `/ask` page and every scheduled agent. |

### 4. Deploy

```bash
npm run cf:deploy
```

The cron triggers in `wrangler.jsonc` start firing on the first successful
deploy. Verify with:

```bash
curl -H "Authorization: Bearer $DASHBOARD_TOKEN" \
     "https://<your-worker>/api/cron?cadence=fast"
```

That returns a step-by-step report of the tick. Do not wait ten minutes to find
out whether it works.

### 5. Let the agents report in

In **each** project repository's GitHub settings → Secrets and variables →
Actions:

```
DASHBOARD_URL   = https://bba-heartbeat.<your-subdomain>.workers.dev
DASHBOARD_TOKEN = the same value as above
ANTHROPIC_API_KEY = your key
```

Without these the scheduled workflows still run — their results just never reach
the agents console, which then correctly reports that nothing has run.

## Security

**Set `DASHBOARD_TOKEN` before the Worker is reachable from the internet.** With
it unset the write endpoints are open, which is correct for `wrangler dev` and
wrong for anything deployed. `/setup` shows a red banner while it is unset.

The token stops a stray request. It does not stop a determined one — put
**Cloudflare Access** in front of the Worker (Zero Trust → Access → Applications
→ Self-hosted, restricted to your Google account) for real protection. It is
included on the plan you are already paying for.

## When something stops

### The dashboard shows all zeroes

Check `/setup` first. Either there is no D1 binding (every stored number is
empty rather than measured) or the connectors are unconfigured. The banner on
the overview says which.

### `lastCronMinutes` is null or climbing

The heartbeat has stopped. Nothing breaks visibly — the dashboard keeps serving
the last numbers it saw and looks entirely healthy. This is the failure the
`heartbeat-watchdog` agent exists to catch, and it opens an `ops` issue.

Check in order:

1. `wrangler tail` — are the cron invocations arriving at all?
2. `curl -H "Authorization: Bearer $DASHBOARD_TOKEN" "<worker>/api/cron?cadence=fast"`
   — does a manual tick succeed? The response names the failing step.
3. Cloudflare dashboard → Workers → your worker → Triggers. Confirm the cron
   entries exist. They are created from `wrangler.jsonc` on deploy, and a deploy
   that failed part-way can leave them missing.

### GitHub connector says the token was rejected

A 401 means a token was sent and refused: rotate it, or unset it entirely — the
four repositories are public and work unauthenticated.

A 403 that is *not* a rate limit means either the token is missing a scope or
something between the Worker and GitHub blocked the request. The two are
reported differently on purpose; the fixes are unrelated.

### Stripe shows revenue the dashboard does not

The daily tick reconciles Stripe charges into the `revenue` table. It is
idempotent — the unique index on `(source, external_id)` means re-running it
updates rows rather than double-counting. Force one:

```bash
curl -H "Authorization: Bearer $DASHBOARD_TOKEN" "<worker>/api/cron?cadence=daily"
```

Check the key is in **live mode** if you expect live revenue. A test-mode key
reports test-mode charges perfectly happily, and they look real.

### The Ask page says the key is missing but it is set

Secrets set with `wrangler secret put` only reach a Worker that has been
deployed at least once. If you set it before the first deploy, run
`npm run cf:deploy` and then set it again.

Locally, `/ask` reads `.dev.vars`, not your shell environment — an exported
`ANTHROPIC_API_KEY` in your terminal will not be picked up by `wrangler dev`.

### Ask gives an answer that looks wrong

Every answer shows what it looked up — expand the reasoning and read the tool
lines. The most common cause of a surprising number is a question that a raw
`SELECT SUM(amount_pence) FROM spend` answers differently from the dashboard,
because that query does not expand recurring subscriptions. The model is told to
use the finance tool for totals for exactly this reason, but a narrowly-worded
question can still steer it to raw SQL.

It cannot write anything, so a wrong answer is never a wrong change.

### Calendar feed returns 404

The secret address was regenerated in Google. Get the new one and
`wrangler secret put CALENDAR_ICS_URL` again.

## Routine operations

### Recording spend

Use the form on `/finance` or any project page. Or:

```bash
curl -X POST "<worker>/api/spend" \
  -H "Authorization: Bearer $DASHBOARD_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"amount_pence":500,"vendor":"Cloudflare","category":"infra",
       "recurrence":"monthly","note":"Workers Paid plan"}'
```

A bare number is **always pence**. Pass `"amount": "5.00"` instead if you have a
typed string.

### Cancelling a subscription

Do not delete the row — set `ended_on`. Deleting it rewrites history and makes
last quarter's ROI wrong. The expansion in `lib/finance.ts` stops generating
occurrences after that date.

### Adding a project

Edit `config/portfolio.ts`. Nav, route, pollers and ROI row all follow. Nothing
else needs touching.

### Changing the schema

Add a new file to `db/migrations/`. Never edit one that has been applied — D1
tracks which have run, and an edited migration is silently skipped in production
while working fine locally.
