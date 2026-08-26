# gmail-drafter

The half of the outreach pipeline that runs inside Google, so that no
credential capable of reading or sending Billy's mail ever leaves his account.

`Code.gs` here is the **master copy**. The copy that runs is pasted into Apps
Script at [script.google.com](https://script.google.com). They can drift — when
you change this file, paste it again and redeploy.

## Why not something in this repo

Putting a draft into a consumer `@gmail.com` mailbox has three routes and two of
them are unusable:

| Route | Blocked by |
| --- | --- |
| Gmail API + OAuth refresh token | Drafts need a *restricted* scope. On a consumer account an unverified app's refresh token expires **every 7 days**; escaping that needs Google's full verification with a security assessment. |
| IMAP `APPEND` + app password | Works, but an app password is **total mailbox access** — read everything, send as anyone — sitting in a CI secret. Strictly worse than the Gmail connector it was meant to avoid. |
| **Apps Script (this)** | Nothing. Runs as Billy, inside his account, and `createDraft` is the entire Gmail surface it touches. |

## Why the agent pushes instead of the script pulling

The dashboard is behind Cloudflare Access at *Worker* scope. A script polling
`/api/drafts` would need an Access service token (id + secret) **and** the
dashboard bearer — three secrets living in Google. Pushing the other way, the
script holds one secret and knows nothing about Cloudflare.

The cost of that choice: the Web App URL is unauthenticated by Google, so the
shared secret is the only guard. It is checked on every request, the script can
only ever create a draft, and the URL is treated as a secret itself. The same
posture as `web-6`'s `__run/*` endpoints.

## Setup

Done once, by a human, in a browser. Full step-by-step with the code to copy:
`docs/GMAIL-DRAFTER.md`.

Short version:

1. `openssl rand -hex 32` — the shared secret.
2. New Apps Script project, paste `Code.gs`.
3. Project Settings → Script Properties → `DRAFTER_SECRET` = that value.
4. Deploy → New deployment → **Web app**, execute as **Me**, access **Anyone**.
5. Authorise, clicking through the unverified-app warning.
6. Copy the `/exec` URL.
7. Add `GMAIL_DRAFTER_URL` and `GMAIL_DRAFTER_SECRET` as repository secrets.

## The contract

```
POST <web app url>
{
  "secret": "…",
  "drafts": [
    { "key": "client-12-2026-08-26T14:00:00Z", "to": "…", "subject": "…", "body": "…" }
  ]
}

→ { "ok": true, "results": [ { "key": "…", "status": "created", "draftId": "r-123…" } ] }
```

`status` is one of `created`, `duplicate`, `error`.

`key` is an idempotency key. A key the script has already seen is answered
`duplicate` and no second draft is made — the honest failure mode of a retrying
agent is two identical drafts in the mailbox and no way to tell which one you
already edited. Keys are remembered for 60 days, then pruned so the property
store cannot silently fill up.

## What it will never do

- **Send.** There is no `send()` call in `Code.gs`, by design. A human presses
  send, in Gmail, every time.
- **Read the mailbox.** `createDraft` is the whole surface.
- **Act without the secret.**
