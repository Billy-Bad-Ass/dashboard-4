---
description: Who is worth emailing about a website audit, and what is actually wrong with their site
---

Answer from the database, not from memory. The prospects live in the `clients`
table with `project_slug = 'project-1'`; the audit finding that makes each one
worth contacting is in `notes`.

```bash
curl -s "$DASHBOARD_URL/api/clients" | jq '[.[] | select(.project_slug=="project-1")]'
```

If that is unreachable, read D1 directly — a single `SELECT`, never a write:

```sql
SELECT name, website, email, heat, status, notes, next_action
  FROM clients
 WHERE project_slug = 'project-1'
 ORDER BY heat DESC;
```

## What to say

Lead with the ones that can be emailed **today** — a prospect with an address
and a finding. Then, separately, the ones blocked on something.

For each, one line: who, and the single thing the owner could check on their own
phone in ten seconds. That opener is the entire pitch; a prospect whose finding
cannot be seen by a non-technical person is not ready to contact, however high
it scores.

Say the count of prospects with **no address on file**. That number is usually
the real bottleneck, and it is invisible unless someone says it out loud.

## Rules

- **Never invent a business name, an address, or a finding.** The audit engine
  publishes URLs and findings publicly and keeps names and emails in an
  access-controlled artifact, so a row whose name is a bare domain is correct,
  not incomplete. Guessing "All Heart Dental Care" from `allheartdentalcare.com`
  is exactly the kind of plausible fiction that gets acted on.
- **Unauditable is not a finding.** Two of the first batch would not load and
  one blocks robots. They have nothing to open an email with, and saying
  otherwise wastes a send.
- **Never contact anybody.** Drafts are written by the drafting pipeline and
  sent by a human. This command reads.
- If a number here disagrees with what sitecheck-1's artifact says, trust the
  artifact and say the sync is stale — it runs once a day.

## Where they come from

`sitecheck-1` discovers and audits businesses on GitHub Actions (the live
network is blocked from most agent sandboxes), publishes audits to its
`live-data` branch, and the daily cron in `lib/cron.ts` pulls them into the CRM
through `lib/prospects.ts`.
