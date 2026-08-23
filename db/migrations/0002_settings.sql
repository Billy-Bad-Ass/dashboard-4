-- Small key/value table for things that are configuration but change often
-- enough that editing a file and redeploying is the wrong shape: the Cloudflare
-- account id, the apportionment rule for overhead spend, the ICS URL once it is
-- set through the UI rather than as a secret.
--
-- Anything genuinely secret still belongs in `wrangler secret put`, not here —
-- D1 rows are readable by anything with a binding.
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT INTO settings (key, value) VALUES
  -- How portfolio-wide overhead (spend rows with no project_slug) is charged
  -- against projects when computing per-project ROI.
  --   even    — split equally across every non-paused project
  --   active  — split across projects past the 'idea' stage
  --   none    — left in the portfolio total, not charged to any project
  ('overhead_apportionment', 'active'),
  -- Days of metric history to keep. The daily cron prunes past this.
  ('metric_retention_days', '400'),
  -- A client with no contact in this many days shows on the "going cold" list.
  ('cold_after_days', '21');
