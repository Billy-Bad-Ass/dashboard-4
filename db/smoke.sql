-- ---------------------------------------------------------------------------
-- Fixture for the route smoke test. Not seed data — never loaded into a real
-- database. `scripts/smoke-routes.mjs` loads it into a throwaway local D1.
--
-- Its job is narrow and specific: make every conditional panel render.
--
-- On 2026-08-29 every project page and /finance answered 500 in production
-- while CI was green, and the reason was not that CI failed to run the pages.
-- It ran `next build` and `opennextjs-cloudflare build`, both of which passed,
-- because the crash was a render-time one. A smoke test alone would still have
-- missed it: against an empty database the pages return 200. Every panel that
-- crashed is behind a `rows.length > 0` guard, so with no rows the component
-- that could not be rendered is never rendered.
--
--     An empty database is not the quiet case. It is a different page.
--
-- So this fixture exists to be un-empty, and every block below names the panel
-- it unlocks. Adding a panel that only appears when there is data means adding
-- a row here, or CI goes on testing the version of the page nobody visits.
-- ---------------------------------------------------------------------------

-- Metric history → the "Recorded history" charts on every project page.
-- This is the block that would have caught the 500: the charts are the only
-- consumer of Chart's unit prop, and they render only when metrics exist.
-- One row per unit kind, so every branch of formatVital is exercised.
INSERT INTO metrics (project_slug, metric_key, value_num, captured_at, source) VALUES
  ('project-1', 'revenue',           0, '2026-08-27T00:00:00Z', 'stripe'),
  ('project-1', 'revenue',        1250, '2026-08-28T00:00:00Z', 'stripe'),
  ('project-1', 'units',              0, '2026-08-27T00:00:00Z', 'stripe'),
  ('project-1', 'units',              3, '2026-08-28T00:00:00Z', 'stripe'),
  ('project-1', 'refund_rate',      0.0, '2026-08-27T00:00:00Z', 'stripe'),
  ('project-1', 'refund_rate',      2.5, '2026-08-28T00:00:00Z', 'stripe'),
  ('project-1', 'days_since_commit',  0, '2026-08-27T00:00:00Z', 'github'),
  ('project-1', 'days_since_commit',  1, '2026-08-28T00:00:00Z', 'github'),
  -- A key the register no longer describes. `spec` is undefined for this one,
  -- which is the path that decides the chart's fallback unit.
  ('project-1', 'retired_metric',     7, '2026-08-27T00:00:00Z', 'ledger'),
  ('project-1', 'retired_metric',     9, '2026-08-28T00:00:00Z', 'ledger'),
  -- A second project, so the pages are not all rendering one project's shape.
  ('project-2', 'revenue',            0, '2026-08-27T00:00:00Z', 'stripe'),
  ('project-2', 'revenue',            0, '2026-08-28T00:00:00Z', 'stripe');

-- Direct spend → the spend table on a project page, and the category
-- StackedBar on /finance, which is where /finance was throwing.
INSERT INTO spend (project_slug, incurred_on, amount_pence, category, vendor, note, recurrence) VALUES
  ('project-1', '2026-08-20', 1200, 'ai',        'Anthropic',  'API credit',        'once'),
  ('project-1', '2026-08-21',  900, 'marketing', 'Meta',       'Test campaign',     'once'),
  ('project-2', '2026-08-22',  400, 'tooling',   'Figma',      NULL,                'monthly');

-- Portfolio-wide overhead. NULL slug is the apportioned case, which renders a
-- different empty-state sentence on a project with no direct spend.
INSERT INTO spend (project_slug, incurred_on, amount_pence, category, vendor, note, recurrence) VALUES
  (NULL, '2026-08-01', 500, 'infra', 'Cloudflare', 'Workers Paid plan', 'monthly');

-- Revenue → the revenue table on a project page and the net-revenue series.
INSERT INTO revenue (project_slug, received_on, gross_pence, fees_pence, refunded_pence, source, external_id, description) VALUES
  ('project-1', '2026-08-28', 945, 59, 0, 'stripe', 'ch_smoke_1', 'Espresso dial-in card'),
  ('project-1', '2026-08-28', 945, 59, 945, 'stripe', 'ch_smoke_2', 'Refunded order');

-- Clients → the contacts panel on a project page and the board on /clients.
-- One with an address and one without, because they render as separate lists.
INSERT INTO clients (project_slug, name, company, email, status, heat, notes) VALUES
  ('project-1', 'Smoke One', 'Example Ltd', 'one@example.com', 'lead',    3, NULL),
  ('project-1', 'Smoke Two', 'Example Ltd', NULL,              'lead',    2, 'No email on file'),
  ('project-1', 'Smoke Lost','Example Ltd', 'lost@example.com','lost',    0, NULL);

-- Deals → the pipeline StackedBar on /clients, the other caller of the
-- component that broke /finance.
INSERT INTO deals (client_id, project_slug, title, stage, value_pence, probability) VALUES
  (1, 'project-1', 'Audit', 'proposal', 10000, 50),
  (2, 'project-1', 'Audit', 'won',      10000, 100);

-- Agent runs → the fleet table on /agents.
INSERT INTO agent_runs (agent, project_slug, trigger, status, summary, started_at) VALUES
  ('smoke-agent', 'project-1', 'cron', 'ok',     'Nothing to do.', '2026-08-28T06:00:00Z'),
  ('smoke-agent', 'project-1', 'cron', 'failed', 'Something to do.', '2026-08-28T07:00:00Z');

-- Calendar → the upcoming list on /calendar and the events panel on a project.
INSERT INTO calendar_events (uid, summary, starts_at, ends_at, project_slug, synced_at) VALUES
  ('smoke-1', 'Smoke event', '2026-08-30T14:00:00Z', '2026-08-30T15:00:00Z', 'project-1', '2026-08-29T00:00:00Z');
