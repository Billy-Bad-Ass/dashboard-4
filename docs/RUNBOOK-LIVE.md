# Going live — the human-only steps

Every item on this page is blocked on a **credential, a DNS record, a payment,
or a decision**. None of it is blocked on code. An agent cannot do any of it,
because each one needs either a secret nobody should hand an agent or a
judgement nobody should delegate.

`trading-3` is deliberately absent. It is being worked separately and has no
live-money step to take.

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
2. `npm run pdf:upload` — and treat it as part of **every** deploy. A deploy
   without it takes the money and then 500s on the download.
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

1. **`DASHBOARD_TOKEN` first**, before the Worker is publicly reachable:
   ```bash
   openssl rand -hex 32
   ```
   This page shows revenue, spend and the client list. The order matters.
2. Then the read-only credentials: `STRIPE_SECRET_KEY` (restricted, read),
   `GITHUB_TOKEN` (fine-grained, read-only), `CLOUDFLARE_API_TOKEN` (Account
   Analytics: Read), `CLOUDFLARE_ACCOUNT_ID`.
3. Optional: `CALENDAR_ICS_URL` (the private iCal address), and
   `ANTHROPIC_API_KEY` for `/ask`. Unset means the tile says so honestly.
4. Confirm Cloudflare Access covers `heartbeat.bbanetwork.org` **and** that no
   unprotected `workers.dev` door is still open. Access is per-hostname: a
   policy on one name does not follow the site to the other.

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
2. Set `DASHBOARD_URL`, `DASHBOARD_TOKEN`, `CF_ACCESS_CLIENT_ID` and
   `CF_ACCESS_CLIENT_SECRET` as Worker secrets, so `link-warden` and
   `redirect-guard` can report into dashboard-4. Until they can, their runs on
   the agent console read as never having happened — which is the correct
   display, and not a useful one.
