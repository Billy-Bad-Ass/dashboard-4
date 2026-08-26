# Going live — the human-only steps

Every item on this page is blocked on a **credential, a DNS record, a payment,
or a decision**. None of it is blocked on code. An agent cannot do any of it,
because each one needs either a secret nobody should hand an agent or a
judgement nobody should delegate.

`trading-3` is deliberately absent. It is being worked separately and has no
live-money step to take — its own `SETUP.md` is down to two items, the
Databento account and an optional research token.

**Start here.** Two token grants unblock most of what follows, and one of them
is the fleet blocker below: `notes/2026-08-26-ops-tokens.md` in
`Billy-Bad-Ass/Code`. Neither token is ever handed to an assistant — both live
as repository secrets and are used by a workflow that can be read before it
runs.

## The rails, first

These are not preferences. Anything that changes one of them is a defect, not a
configuration choice.

| Rail | Where | Why it exists |
| --- | --- | --- |
| `DRY_RUN` stays `true` | growth-os-5 | The allocator can propose spend. It must not be able to place it. |
| `REQUIRE_HUMAN_APPROVAL` stays `true` | growth-os-5 | The approval gate is the only thing between an agent and a card. |
| `DAILY_SPEND_CAP_CENTS` = `2500` | growth-os-5 | $25/day. A ceiling only ever moves down. |
| Stripe key is read-only | dashboard-4, sitecheck-1 | Refunds and price changes are human decisions. A write scope here is a design error. |
| Calendar is read-only | dashboard-4 | Connected by private iCal address, which is read-only by construction. Keep it that way. |
| No secrets, customer emails, delivered reports or `fulfilled.json` in a repo | all | Every one of these repositories is public. |

## sitecheck-1 — the $100 audit

1. Add `STRIPE_SECRET_KEY` as a repo secret. Live key, **restricted, read
   scopes only**. Fulfilment reads sessions; it never writes.
2. Add `RESEND_API_KEY` as a repo secret, so a delivered report actually leaves
   the machine.
3. **Decide whether the pSEO engine in `src/` stays or goes.** It is finished
   and unmonetised, and the audit is what is being sold. This is a keep-or-cut
   call on working code — do not let it be made by deletion.
4. Run one **test-mode** purchase end to end before the schedule points at live
   money. The idempotency store is the thing being tested: run it twice and
   confirm the second run sends nothing.

## network-store-2 — the store

1. Push the catalogue to live Stripe, dry run first:
   ```bash
   npm run stripe:sync
   STRIPE_SYNC_CONFIRM=yes npm run stripe:sync -- --apply
   ```
2. ✅ **Done — `pdf:upload` is enforced by CI.** `deploy.yml` runs
   `pdf:build` → `pdf:check` → `pdf:upload` → `verify-r2-downloads` on every
   deploy, so the failure this step warned about — taking the money and then
   500ing on the download — cannot happen by forgetting. Verified 2026-08-26.
   Kept as a closed item so nobody re-adds it as a manual chore.
3. Create the live webhook at `https://guides.bbanetwork.org/api/stripe/webhook`
   and set `STRIPE_WEBHOOK_SECRET` to that endpoint's secret. The secret is
   per-endpoint; the test-mode one will not work.
4. Set `NEXT_PUBLIC_SITE_URL`, and a fresh `DOWNLOAD_SIGNING_SECRET`:
   ```bash
   openssl rand -base64 32
   ```
5. Make the tax decision — whether Stripe Tax collects, and for which regions.
6. Point `guides.bbanetwork.org` at the store Worker, and add the
   `support@bbanetwork.org` email route.
7. One live £5 purchase, and one refund, by a human, with eyes on it.

**Left deliberately undone:** the miniature speedpaint recipe tables. That SKU
stays `status: needs-content`. Invented paint recipes on a product someone pays
for is the worst kind of made-up number — it is one a customer acts on.

## dashboard-4 — this dashboard

1. ✅ **Done — `DASHBOARD_TOKEN` is set.** Verified 2026-08-26 from a runner
   log: `DASHBOARD_URL`, `DASHBOARD_TOKEN`, `CF_ACCESS_CLIENT_ID` and
   `CF_ACCESS_CLIENT_SECRET` are all present as repository secrets, and the
   service token's shape checks out (39 and 64 characters, id ending
   `.access`). Regenerating one, if ever needed:
   ```bash
   openssl rand -hex 32
   ```
2. Then the read-only credentials: `STRIPE_SECRET_KEY` (restricted, read),
   `GITHUB_TOKEN` (fine-grained, read-only), `CLOUDFLARE_API_TOKEN` (Account
   Analytics: Read), `CLOUDFLARE_ACCOUNT_ID`.
3. Optional: `CALENDAR_ICS_URL` (the private iCal address), and
   `ANTHROPIC_API_KEY` for `/ask`. Unset means the tile says so honestly.
4. ✅ **Done — the fleet can report.** Verified 2026-08-26 through the real
   agent path, not by the absence of an error: `agent-heartbeat-watchdog.yml`
   posted a run and the console answered `201`.

   It was two faults stacked, which is why four single-cause theories in a row
   were wrong. The Access Service Auth policy named a service token whose
   secret nobody held, so the `POST` to `/api/agent-runs` was answered with a
   `302` to `cloudflareaccess.com/cdn-cgi/access/login/…`; a new token,
   `bba-ci`, fixed that and propagation took over four minutes rather than the
   seconds assumed. Underneath it, `DASHBOARD_TOKEN` on the Worker and
   `DASHBOARD_TOKEN` in this repository were different values. Both are
   write-only, so they could not be compared — only replaced together, which
   `ops-rotate-dashboard-token.yml` now does in one job.

   The `Only me` policy was never touched, and neither was the `CF2` token.

5. 🔴 **The fleet blocker is now a Claude credential, and it is one command.**
   With Access fixed, six agents are still silent — and every model-driven one
   of them is silent for the same reason. `claude-code-action` validates its
   environment before it does anything and exits 1 with *"Either
   ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or workload identity federation
   is required"*. Neither secret exists in this repository or in
   `network-store-2`, so `portfolio-analyst`, `spend-auditor`,
   `market-researcher`, `revenue-analyst`, `listing-copywriter` and
   `release-qa` have never once produced anything.

   ```bash
   claude setup-token
   ```

   Store the result here as `CLAUDE_CODE_OAUTH_TOKEN`, then run
   **Ops · Give the other repos the credentials they report with** with
   `apply=APPLY`; it fans that value out along with the four reporting values.
   On a Max plan these runs cost nothing, where an API key bills per token.

   Those workflows no longer die on the missing secret: they skip the agent
   step, say in one line what was lost, and report `skipped` to the console.
   A skipped agent that says why is a different thing from a red X.

6. Confirm no unprotected `workers.dev` door is still open. Access is
   per-hostname: a policy on one name does not follow the site to the other.

## growth-os-5 — ads and social

1. Create a `CLOUDFLARE_API_TOKEN` with **Zone/DNS edit** and **Zone/Workers
   Routes edit**, and deploy — so the crons (5min / hourly / 6h / daily /
   weekly) actually fire. A deployed Worker is not a running one.
2. Connect **one** ad platform and **one** social platform by OAuth. Store each
   credential as a Worker secret (`npx wrangler secret put`) and register it
   through the Accounts API at `ops.bbanetwork.org`.
3. Attach `ops.` and `go.` — both are already `custom_domain = true` in
   `wrangler.toml`, so the deploy creates the DNS record and the certificate.
4. Run one campaign to a **measurable ROAS**. Negative is a result. No number
   is not.

Keep `DRY_RUN`, `REQUIRE_HUMAN_APPROVAL` and the $25/day cap on throughout.

## web-6 — the apex hub

1. Add the missing `www.` DNS record. Either a Worker custom domain on
   `bba-network-hub`, or a proxied CNAME plus a redirect rule. The apex itself
   was attached on 2026-08-24.
2. ✅ **Done — both of Project 6's checks report.** The four reporting values
   go to two places there, because the two checks run in two places:
   Worker secrets on `bba-network-hub` for `link-warden`, and repository
   secrets for `redirect-guard`. **Not a manual step** — *Ops · Give the other
   repos the credentials they report with* writes both, from the one place the
   values exist.

   `redirect-guard` moved back to GitHub Actions on 2026-08-26. It probes the
   apex, and a Worker cannot fetch the hostname it serves — Cloudflare answers
   `522` — so it failed all nine of its probes every day from 2026-08-24 and
   no run in that repository reported anything, so nobody saw. Proved by two
   requests a second apart: a runner got `200` from the apex while the Worker's
   own probes got `522`. `link-warden` probes other people's hostnames and
   stays a Worker cron.
