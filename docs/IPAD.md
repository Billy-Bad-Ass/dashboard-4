# Setting this up from an iPad

No terminal, no commands. Everything here is tapping in Safari.

The whole build runs on a GitHub Actions runner, which is a computer GitHub
gives you for free. You press a button; it does the command-line work.

---

## What it costs

Worth knowing before you start, because one of these is not what people expect.

| Thing | Cost |
| --- | --- |
| Cloudflare Workers, D1, KV, R2, cron | **$0 extra** — the $5/month plan you already pay covers all of it |
| GitHub Actions | **$0** — public repositories get unlimited minutes |
| The scheduled agents | **$0** — they can run on your Claude Max plan, see below |
| The Ask page (`/ask`) | **Not free.** Needs Claude API credits, billed separately from Max |

### Max does not include API credits

This one catches everybody. A Claude Pro or Max subscription covers the Claude
app and Claude Code. It does **not** include access to the Claude API, which is
billed separately through prepaid credits at
[platform.claude.com](https://platform.claude.com).

They are genuinely two different products with two different bills, and there is
no way to point a deployed web app at your Max subscription.

**So:**

- The **scheduled agents** run through Claude Code in GitHub Actions, so they
  *can* use your Max plan. Free. See step 6.
- The **Ask page** is a web app calling the API directly. It needs credits.
  Minimum top-up is $5.

### What Ask actually costs per question

A question involves the reasoning, a lookup or two, and a short answer.

| Model | Roughly per question | 10 questions a day |
| --- | --- | --- |
| `claude-opus-5` (default) | ~$0.09 | ~$27/month |
| `claude-haiku-4-5` | ~$0.02 | ~$6/month |

To switch: Cloudflare → Workers & Pages → `bba-heartbeat` → Settings → Variables
and Secrets → add a **plain variable** (not a secret) called `ASK_MODEL` with the
value `claude-haiku-4-5`.

Opus is the default because a wrong answer about money costs more than the token
price saves. But you are pre-revenue and paying for this yourself, so it is one
setting away.

**You can skip Ask entirely.** Leave `ANTHROPIC_API_KEY` unset and everything
else works — the page just says the key is missing. Add it later.

---

## Setup

Nine steps. About 30 minutes, mostly copying values between browser tabs.

### 1. Get a Cloudflare API token

This is the one that lets GitHub build things in your Cloudflare account.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → your icon, top right → **API Tokens**
2. **Create Token**
3. Find **Edit Cloudflare Workers** → **Use template**
4. Scroll to **Permissions** and add one more row: **Account** → **D1** → **Edit**
5. **Continue to summary** → **Create Token**
6. **Copy it now.** Cloudflare shows it once and never again.

### 2. Get your Cloudflare account ID

Still in the Cloudflare dashboard → **Workers & Pages**. The **Account ID** is in
the right-hand panel — a long string of letters and numbers. Copy it.

> On a narrow iPad window the panel can be below the main content. Scroll down.

### 3. Put both into GitHub

[github.com/Billy-Bad-Ass/Project-4](https://github.com/Billy-Bad-Ass/Project-4)
→ **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

Add two:

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | from step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | from step 2 |

Names must match exactly — they are case sensitive.

### 4. Press the button

Same repo → **Actions** tab → in the left sidebar, **Set up the dashboard** →
**Run workflow** → **Run workflow**.

Takes about three minutes. It creates the database, the cache and the storage
bucket, writes their ids back into the repo, sets up the tables, and deploys.

When it finishes, tap the run and read the summary at the top. **Your dashboard
URL is there.** It looks like:

```
https://bba-heartbeat.<something>.workers.dev
```

Open it. It works, and almost everything says "not connected" — that is correct,
you have not added the keys yet.

> **If it fails:** the summary says what was missing. The usual cause is the
> token lacking **D1: Edit** — redo step 1 and make sure that row is there. Then
> run the workflow again; it is safe to re-run.

### 5. Lock it down ⚠️

**Do this now, before you add any keys.** Right now anyone who guesses the URL
can read your finances and edit your client list.

1. Cloudflare → **Zero Trust** (left sidebar)
2. **Access** → **Applications** → **Add an application**
3. **Self-hosted**
4. Application name: `BBA Heartbeat`
5. Under **Public hostname**, enter your worker URL from step 4
6. **Next** → policy name `Only me` → Action **Allow**
7. Under **Include**: selector **Emails**, value your email address
8. **Next** → **Add application**

Now opening the dashboard asks you to confirm your email first. Free for up to 50
people, on the plan you already pay for.

### 6. Turn the agents on — free

The scheduled agents (weekly review, monthly spend audit, pipeline nudge,
heartbeat watchdog) run Claude Code inside GitHub Actions, which means they can
use your **Max plan** instead of API credits.

Getting the token needs one command, which you cannot run on an iPad. Two ways
round it:

**Easiest — ask Claude Code to do it.** In a Claude Code session on this
repository, type:

```
/install-github-app
```

It installs the GitHub App, creates a subscription token, saves it as a
repository secret, and opens a pull request with the workflow. Merge that and
you are done. This may not work from a web session — if it says the GitHub CLI
is missing, use the other way.

**Or borrow a computer once.** On any Mac or PC with Claude Code installed, run
`claude setup-token`, copy what it prints, then add it as a repository secret
called `CLAUDE_CODE_OAUTH_TOKEN` (GitHub → Settings → Secrets and variables →
Actions).

The workflows already prefer that token over an API key, so once it is there the
agents cost you nothing.

> Their usage comes out of your Max plan's limits, shared with your own Claude
> use. Four scheduled jobs is light, but a heavy week could eat into it.

**Skip this and nothing breaks.** The agents just never run, and the Agents page
honestly says so.

### 7. Add your keys

Cloudflare → **Workers & Pages** → **bba-heartbeat** → **Settings** →
**Variables and Secrets** → **Add**. Type: **Secret**. One at a time.

| Name | Where to get it | Turns on |
| --- | --- | --- |
| `DASHBOARD_TOKEN` | Make one up — long and random, like a password | Guards the write endpoints |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → **Create restricted key**. Tick *read* on Charges, Balance, Products, Disputes. Nothing else. **Live mode, not test.** | Revenue, refunds, balance |
| `CALENDAR_ICS_URL` | Google Calendar → gear → Settings → tap your calendar on the left → **Secret address in iCal format** | Your calendar |
| `CLOUDFLARE_API_TOKEN` | The same token from step 1 | Traffic stats |
| `CLOUDFLARE_ACCOUNT_ID` | The same id from step 2 | Traffic stats |
| `ANTHROPIC_API_KEY` | [platform.claude.com](https://platform.claude.com) → API keys. **Needs credits — see the top of this page** | The Ask page |

All optional. Add what you want, skip the rest, come back later. `/setup` on the
dashboard always shows what is still missing.

> Treat `CALENDAR_ICS_URL` like a password. Anyone holding it can read your
> calendar. If it leaks, regenerate it in Google and the old one dies.

### 8. Redeploy so the keys take effect

Adding a secret does not restart the Worker.

GitHub → **Actions** → **Deploy** → **Run workflow** → **Run workflow**.

Two minutes. Then open `/setup` on your dashboard — the connectors you added
should be green.

### 9. Put it on your own domain

You own `bbanetwork.org`, so the dashboard does not have to live at a
`workers.dev` address.

1. Cloudflare → **Workers & Pages** → **bba-heartbeat**
2. **Settings** → **Domains & Routes** → **Add** → **Custom domain**
3. Enter `heartbeat.bbanetwork.org`
4. **Add domain**

Cloudflare creates the DNS record and the certificate itself. A minute or two.

> ⚠️ **Then go back to Access.** An Access policy protects a *hostname*, not a
> Worker. The new address is an unprotected door to the same dashboard until you
> add it: Zero Trust → Access → Applications → your app → add the hostname.

Full plan for the domain — including which project should **not** go on it, and
a live bug in Project 2's support address — is in [DOMAINS.md](DOMAINS.md).

### 10. Let the agents report in

So their runs show on the Agents page.

GitHub → **Settings** → **Secrets and variables** → **Actions** → two more:

| Name | Value |
| --- | --- |
| `DASHBOARD_URL` | your worker URL from step 4 |
| `DASHBOARD_TOKEN` | the same value you set in step 7 |

---

## Afterwards

### Making changes

You do not need a terminal for these either.

- **Ask me.** Describe what you want; I open a pull request. You tap **Merge**,
  and the Deploy workflow ships it automatically.
- **Edit a file yourself.** On GitHub, open the file → pencil icon → edit →
  **Commit changes**. Deploy runs on its own. `config/portfolio.ts` is the file
  worth knowing: projects, their gates and their metrics all live there.

### Recording spend

On the dashboard: **Money** → **Record spend**. Works on a phone.

Do it as costs happen. Every ROI number on the site divides by this figure, so a
ledger that drifts makes the whole dashboard flattering.

### If something looks wrong

- `/setup` lists every connector and what it is complaining about.
- **Actions** tab shows every deploy and agent run, with logs.
- Cloudflare → Workers & Pages → `bba-heartbeat` → **Logs** for live errors.

### Common problems

**"The dashboard shows all zeroes."** Check `/setup`. Either there is no
database (the setup workflow did not finish) or no connectors are configured.
The banner on the front page says which.

**"I added a key but nothing changed."** Run the Deploy workflow (step 8).
Secrets need a restart.

**"Ask says the key is missing but I set it."** Same thing — redeploy. If it
persists, check the key has credits at platform.claude.com; a key with a zero
balance authenticates fine and then fails on the first request.

**"The setup workflow failed."** Read the summary at the top of the run. Nearly
always a token permission. Safe to re-run once fixed.

---

## The one thing to remember

Everything on this dashboard distinguishes **"nothing reported this"** from
**"we measured it and it is zero"**.

- `—` means unknown. A connector is not set up.
- `$0.00` means measured, and genuinely zero.

You are pre-revenue, so a lot of real zeroes are correct. Do not read them as
broken — and do not read a `—` as a zero.
