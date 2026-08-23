-- Core schema for the BBA Network heartbeat dashboard.
--
-- Two rules that shape everything below:
--
--  1. Money is INTEGER pence. Never REAL, never pounds. SQLite will happily
--     store 5.00 as 4.999999 and you will find out during a tax return.
--  2. Timestamps are ISO-8601 UTC strings ('2026-08-23T14:00:00Z'). SQLite has
--     no date type; strings sort correctly and survive the D1 HTTP layer,
--     which integer epochs do not do as legibly in the query console.

-- ---------------------------------------------------------------------------
-- Spend ledger. The denominator of every ROI number on the site.
-- ---------------------------------------------------------------------------
CREATE TABLE spend (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Project slug from config/portfolio.ts, or NULL for portfolio-wide overhead
  -- (a domain registrar bill that covers everything). Overhead is apportioned
  -- at read time; do not fake it into one project.
  project_slug    TEXT,
  incurred_on     TEXT NOT NULL,
  amount_pence    INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'gbp',
  category        TEXT NOT NULL,      -- infra | tooling | ai | marketing | contractor | fees | other
  vendor          TEXT NOT NULL,
  note            TEXT,
  -- 'once' for one-off, or the cadence for a subscription. Recurring rows are
  -- expanded into occurrences at read time rather than duplicated monthly.
  recurrence      TEXT NOT NULL DEFAULT 'once',  -- once | monthly | yearly
  -- When a subscription stopped. NULL means still running.
  ended_on        TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_spend_project ON spend(project_slug);
CREATE INDEX idx_spend_date ON spend(incurred_on);

-- ---------------------------------------------------------------------------
-- Revenue. Stripe is the order record for stripe-model projects, so those rows
-- are a cache keyed on the Stripe object id and are safe to delete and rebuild.
-- Affiliate and services revenue has no live API, so those rows are the record
-- and must never be wiped by a poller. `source` is what tells them apart.
-- ---------------------------------------------------------------------------
CREATE TABLE revenue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_slug    TEXT NOT NULL,
  received_on     TEXT NOT NULL,
  gross_pence     INTEGER NOT NULL,
  fees_pence      INTEGER NOT NULL DEFAULT 0,
  refunded_pence  INTEGER NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'gbp',
  source          TEXT NOT NULL,      -- stripe | affiliate | services | other
  -- Stripe object id, affiliate network reference, or invoice number.
  external_id     TEXT,
  description     TEXT,
  client_id       INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
-- Makes the Stripe poller idempotent: re-polling the same charge updates it.
CREATE UNIQUE INDEX idx_revenue_external ON revenue(source, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX idx_revenue_project ON revenue(project_slug, received_on);

-- ---------------------------------------------------------------------------
-- Clients: current and prospective, in one table. A prospect that converts
-- changes its status; it does not move tables and lose its history.
-- ---------------------------------------------------------------------------
CREATE TABLE clients (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  company         TEXT,
  email           TEXT,
  phone           TEXT,
  website         TEXT,
  -- prospect  — identified, not yet approached
  -- contacted — outreach sent, no reply yet
  -- engaged   — in conversation
  -- current   — has paid or signed
  -- dormant   — was current, nothing recent
  -- lost      — said no, or went silent past the point of pretending
  status          TEXT NOT NULL DEFAULT 'prospect',
  -- Which project they are a client of, or a prospect for.
  project_slug    TEXT,
  source          TEXT,               -- how they were found
  -- 1 (cold) to 5 (about to sign). Deliberately coarse.
  heat            INTEGER NOT NULL DEFAULT 1,
  notes           TEXT,
  -- Set by the CRM when you log an interaction; drives the "going cold" list.
  last_contact_on TEXT,
  next_action     TEXT,
  next_action_on  TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_next_action ON clients(next_action_on);

-- ---------------------------------------------------------------------------
-- Deals. A client can have several over time; the pipeline value on the
-- dashboard is the sum of open deals weighted by probability.
-- ---------------------------------------------------------------------------
CREATE TABLE deals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_slug    TEXT,
  title           TEXT NOT NULL,
  value_pence     INTEGER NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'gbp',
  stage           TEXT NOT NULL DEFAULT 'lead',  -- lead | qualified | proposal | won | lost
  -- 0-100. Weighted pipeline = value * probability. Won deals are 100 and are
  -- excluded from pipeline (they are revenue by then), lost are excluded too.
  probability     INTEGER NOT NULL DEFAULT 10,
  expected_on     TEXT,
  closed_on       TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_deals_client ON deals(client_id);
CREATE INDEX idx_deals_stage ON deals(stage);

-- ---------------------------------------------------------------------------
-- Interactions. An append-only log against a client. Never edited, so the
-- history of a relationship stays honest.
-- ---------------------------------------------------------------------------
CREATE TABLE interactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  occurred_on     TEXT NOT NULL,
  kind            TEXT NOT NULL,      -- email | call | meeting | note | proposal
  summary         TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_interactions_client ON interactions(client_id, occurred_on);

-- ---------------------------------------------------------------------------
-- Metric history. One row per project per metric per poll. This is what makes
-- the sparklines real rather than decorative, and it is the only place the
-- dashboard can answer "is this better than last week".
-- ---------------------------------------------------------------------------
CREATE TABLE metrics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_slug    TEXT NOT NULL,
  metric_key      TEXT NOT NULL,
  value_num       REAL NOT NULL,
  captured_at     TEXT NOT NULL,
  source          TEXT NOT NULL
);
CREATE INDEX idx_metrics_lookup ON metrics(project_slug, metric_key, captured_at);

-- ---------------------------------------------------------------------------
-- Agent runs. Every scheduled or manual agent job writes one row here, so the
-- orchestration console shows what the fleet actually did rather than what the
-- workflow files claim it would do.
-- ---------------------------------------------------------------------------
CREATE TABLE agent_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent           TEXT NOT NULL,
  project_slug    TEXT,
  trigger         TEXT NOT NULL,      -- cron | manual | github | webhook
  status          TEXT NOT NULL,      -- queued | running | ok | failed | skipped
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  duration_ms     INTEGER,
  summary         TEXT,
  -- Link to the Actions run, PR or issue the agent produced.
  artifact_url    TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_agent_runs_time ON agent_runs(started_at);
CREATE INDEX idx_agent_runs_agent ON agent_runs(agent, started_at);

-- ---------------------------------------------------------------------------
-- Calendar cache. Read-only mirror of the Google Calendar ICS feed, so the
-- dashboard renders instantly and still works when Google is slow.
-- ---------------------------------------------------------------------------
CREATE TABLE calendar_events (
  uid             TEXT PRIMARY KEY,
  summary         TEXT NOT NULL,
  starts_at       TEXT NOT NULL,
  ends_at         TEXT,
  all_day         INTEGER NOT NULL DEFAULT 0,
  location        TEXT,
  description     TEXT,
  -- Guessed from the event title, so a "Project 2 launch" entry lands on the
  -- project page. Nullable and always overridable.
  project_slug    TEXT,
  synced_at       TEXT NOT NULL
);
CREATE INDEX idx_calendar_start ON calendar_events(starts_at);

-- ---------------------------------------------------------------------------
-- Heartbeat log. One row per connector per poll: the raw material for the
-- "is anything actually running" answer on the overview.
-- ---------------------------------------------------------------------------
CREATE TABLE heartbeats (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  connector       TEXT NOT NULL,      -- stripe | github | cloudflare | calendar
  status          TEXT NOT NULL,      -- ok | degraded | failed | unconfigured
  latency_ms      INTEGER,
  detail          TEXT,
  checked_at      TEXT NOT NULL
);
CREATE INDEX idx_heartbeats_time ON heartbeats(connector, checked_at);
