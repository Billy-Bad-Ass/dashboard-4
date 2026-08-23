# BBA Network heartbeat — working notes

The operating dashboard for the four-project portfolio. Read `docs/AGENTS.md`
before doing agent work and `docs/DECISIONS.md` before changing architecture.

## The one thing to understand first

Unknown and zero are different, and the whole dashboard depends on keeping them
apart.

```
value === null   →  renders "—"     nothing reported this
value === 0      →  renders "£0.00"  measured, and genuinely zero
roi   === null   →  renders "—"     nothing spent, so the ratio is undefined
roi   === -100   →  renders "-100%"  money out, none back — a real number
```

This portfolio earns nothing today. A dashboard that collapsed those two states
would show a screen of zeroes and be indistinguishable from a broken one, so
`lib/heartbeat.ts` returns `null` for anything unreported and `app/components/Tile.tsx`
renders the difference. Do not "helpfully" default a null to zero anywhere.

## Money

**Integer pence, everywhere, always.** `500` is £5.00. This matches Project-2.

- One formatter: `formatMoney()` in `lib/money.ts`, and it takes pence.
- `parseMoney()` is the only place a typed string becomes a number.
- Never store a float. SQLite will happily keep 5.00 as 4.999999.
- The classic failure in this codebase is a 100x error. Every money test in
  `tests/money.test.mts` exists because of it.

## After changing things

```bash
npm run typecheck      # strict, with noUncheckedIndexedAccess
npm test               # no build step; Node strips the types
npm run workflows:check # if you touched .claude/workflows/
npm run build          # catches server/client component mistakes
```

## Rules that are load-bearing

- **Never invent a number.** If a connector is unconfigured the metric is
  unknown. Say unknown. An invented plausible number on a business dashboard is
  worse than a blank, because it gets acted on.
- **Never write to Stripe.** Read operations only. Refunds and price changes are
  human decisions. The key should be a restricted read-only key; if the code
  ever needs a write scope, that is a design error.
- **Never write to the calendar.** It is connected through the private iCal
  address, which is read-only by construction. Keep it that way.
- **Every connector must survive being unconfigured.** Return
  `unconfigured(...)` with a message that says exactly what to do. A dashboard
  that white-screens on a missing token fails precisely when you need it.
- **`pulse()` must never throw.** It is wrapped at three levels for this reason.
  A half-configured deployment renders honest "not connected" states.
- **Gates live in `config/portfolio.ts`, not the database.** A gate you can tick
  off in a web form without a commit is a gate you will tick off without doing
  the work.
- **Overhead is apportioned, never hidden.** Portfolio-wide spend is split by
  the `overhead_apportionment` setting, and the UI says when a figure includes
  an apportioned share.
- **The spend ledger is a financial record.** Agents propose changes to it; they
  never apply them.
- **`/ask` is read-only.** Its SQL tool accepts a single `SELECT` against an
  allow-listed set of tables and nothing else. If a question would need a write,
  the answer is which page of the dashboard does it — never a write tool.

## Adding a project

Edit `config/portfolio.ts` — that is the whole change. The nav entry, the route,
the pollers and the ROI row all derive from it. Give it honest `vitals` for its
revenue model (a revenue tile on a project with no product is theatre) and write
`reality` as what is true today, not what you hope.

## Where things are

| Need to change | File |
| --- | --- |
| A project's identity, gates, or metrics | `config/portfolio.ts` |
| The agent fleet | `config/agents.ts` and `.claude/agents/` |
| ROI, burn, overhead maths | `lib/finance.ts` |
| What the heartbeat polls | `lib/heartbeat.ts`, `lib/connectors/` |
| What the cron does | `lib/cron.ts` |
| The Ask page's tools or system prompt | `lib/ask.ts` |
| Schema | a new file in `db/migrations/` — never edit an applied one |
| Colours, spacing, themes | `app/globals.css` (tokens on `:root`) |
