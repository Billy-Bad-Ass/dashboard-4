# Setting up gmail-drafter

Three actions, all in a browser, about four minutes. After this, drafts written
by the outreach agent appear in Gmail drafts, ready to read, edit and send.

## Why a human has to do any of it

Google will not let software authorise itself against a mailbox. Every route to
a draft — the Gmail API, IMAP, this — ends at a consent screen that a person
must click. That click is the only irreducible part; everything around it has
been moved off the human.

What was cut, and where it went:

| Step that used to exist | Where it went |
| --- | --- |
| Generate a shared secret | Generated here, baked into the code you paste |
| Add it as a Script Property | Deleted — it rides along in the paste |
| Add two GitHub repository secrets | Deleted — config lives in the `settings` table, written over the API |
| Name the project | Optional. Apps Script will call it Untitled and nothing cares |

## The three actions

### 1. Paste the code

Open <https://script.google.com/home/projects/create>, select everything in the
editor, and paste [`agents/gmail-drafter/Code.gs`](../agents/gmail-drafter/Code.gs)
over it — with the real secret in place of the placeholder on the
`DRAFTER_SECRET` line. Save.

### 2. Deploy and authorise

**Deploy** → **New deployment** → the gear → **Web app**.

| Setting | Value |
| --- | --- |
| Execute as | **Me** |
| Who has access | **Anyone** |

Then **Deploy**, and work through the consent screens: **Authorize access** →
"Google hasn't verified this app" → **Advanced** → **Go to … (unsafe)** →
**Allow**.

It asks to "manage drafts and send email on your behalf" because that is the
narrowest scope Google publishes for creating a draft. There is no drafts-only
scope. The script contains no send call.

### 3. Hand back the URL

Copy the **Web app URL** ending `/exec` and give it to Claude in chat. It gets
written to `settings.gmail_drafter_url` and never appears in this repository.

## Where the config lives

Two rows in `settings`:

| Key | What |
| --- | --- |
| `gmail_drafter_url` | the `/exec` URL |
| `gmail_drafter_secret` | the shared secret baked into the deployed script |

`db/migrations/0002_settings.sql` says outright that anything genuinely secret
belongs in `wrangler secret put` rather than D1, and this bends that rule. It is
a deliberate exception, for a reason worth stating plainly: both values are
created by a human in a browser at runtime, so a deploy-time secret would mean
another console and more steps — and the capability they unlock is bounded to
*put a draft in a drafts folder*. It cannot send, cannot read mail, and cannot
spend money. A Stripe key would not get this exception.

Rotating is one action: redeploy the script (new URL), give Claude the new URL.

## When something is wrong

| What you see | What it means |
| --- | --- |
| `Refused.` | The secret in the deployed script no longer matches `settings.gmail_drafter_secret`. Paste the current code again and redeploy. |
| `DRAFTER_SECRET still holds the placeholder value.` | The code was pasted straight from the repository. Use the copy with the real secret in it. |
| A Google error page instead of JSON | The deployment is stale. Deploy → Manage deployments → edit → Version: **New version** → Deploy. |
| The same draft twice | Should be impossible; the script remembers each idempotency key for 60 days. If it happens the dashboard is minting a new key per run — a bug on this side, not Google's. |
| Nothing arrives, no error | Check which account you are looking at. The script drafts as whoever authorised it. |

## Changing the script later

`agents/gmail-drafter/Code.gs` is the master copy. Editing it changes nothing on
its own — the running copy is the one pasted into Apps Script. Paste it again,
then **Deploy → Manage deployments → edit → New version → Deploy**, which keeps
the same URL. Creating a *new deployment* instead mints a second URL and leaves
the old one live.
