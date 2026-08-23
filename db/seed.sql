-- Seed data.
--
-- Only things that are actually true go in here. There are no example clients,
-- no sample revenue and no placeholder deals: an empty CRM that says "empty" is
-- more useful than one full of invented people you then have to remember are
-- fake. The one seeded row is the Cloudflare subscription, because that bill is
-- real and it is the portfolio's only known running cost. 500 = $5.00: the
-- Workers Paid plan is billed in USD, which is why the dashboard reports USD.
--
-- Safe to re-run: every insert is guarded on its natural key.

INSERT INTO spend (project_slug, incurred_on, amount_pence, currency, category, vendor, note, recurrence)
SELECT NULL, '2026-08-01', 500, 'usd', 'infra', 'Cloudflare',
       'Workers Paid plan — covers Workers, D1, KV, R2 and cron triggers for the whole portfolio.',
       'monthly'
WHERE NOT EXISTS (
  SELECT 1 FROM spend WHERE vendor = 'Cloudflare' AND recurrence = 'monthly'
);
