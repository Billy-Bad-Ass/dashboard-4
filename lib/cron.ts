/**
 * The scheduled heartbeat.
 *
 * Three cadences, all defined in wrangler.jsonc and dispatched here:
 *
 *   fast    every 10 minutes  — poll the connectors, record whether each answered
 *   hourly  at :17            — snapshot every project's vitals, refresh the calendar
 *   daily   at 06:23 UTC      — prune old history, roll Stripe charges into revenue
 *
 * Everything is wrapped so one failing step cannot abort the tick. A cron that
 * silently stops because Stripe had a bad minute is worse than one that records
 * a failed connector and carries on — the failure is the data.
 *
 * Worker CPU budget matters here. The fast tick does four HTTP calls and a
 * handful of D1 inserts; it does not compute anything expensive. Analysis is
 * the GitHub Actions agents' job, and they have minutes rather than
 * milliseconds.
 */

import { projectForCharge } from '@/config/portfolio';
import { pulse, recordHeartbeat, recordMetric } from './heartbeat';
import { execute, query, queryOne } from './db';
import { isoStamp, isoDate, addDays } from './dates';
import { fetchCalendar } from './connectors/calendar';
import { syncProspects } from './prospects';

export type Cadence = 'fast' | 'hourly' | 'daily';

/** Map a cron expression to what it means. Unknown patterns run the fast tick. */
export function cadenceFor(cron: string): Cadence {
  if (cron.startsWith('23 6')) return 'daily';
  if (cron.startsWith('17 ')) return 'hourly';
  return 'fast';
}

export interface TickReport {
  cadence: Cadence;
  at: string;
  steps: { step: string; ok: boolean; detail: string }[];
}

/** Run a step, recording success or failure rather than propagating a throw. */
async function step(
  report: TickReport,
  name: string,
  fn: () => Promise<string>,
): Promise<void> {
  try {
    report.steps.push({ step: name, ok: true, detail: await fn() });
  } catch (error) {
    report.steps.push({
      step: name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function runTick(cadence: Cadence): Promise<TickReport> {
  const report: TickReport = { cadence, at: isoStamp(), steps: [] };

  // Every tick reads a fresh pulse: that is what refreshes the KV cache the UI
  // reads, so a page load costs nothing and never touches an API key.
  const snapshot = await pulse({ fresh: true });

  await step(report, 'heartbeats', async () => {
    for (const connector of snapshot.connectors) {
      await recordHeartbeat(connector);
    }
    const live = snapshot.connectors.filter((c) => c.status === 'ok').length;
    return `${live}/${snapshot.connectors.length} connectors live`;
  });

  if (cadence === 'hourly' || cadence === 'daily') {
    await step(report, 'metrics', async () => {
      let written = 0;
      for (const project of snapshot.projects) {
        for (const [key, value] of Object.entries(project.vitals)) {
          // Null means nothing reported it. Storing a null as zero would draw a
          // sparkline that says the metric crashed, which it did not.
          if (value === null || !Number.isFinite(value)) continue;
          await recordMetric(
            project.project.slug,
            key,
            value,
            project.project.vitals.find((v) => v.key === key)?.source ?? 'derived',
          );
          written += 1;
        }
      }
      return `${written} metric snapshots`;
    });

    await step(report, 'calendar', async () => {
      const result = await fetchCalendar();
      if (result.status !== 'ok' || !result.data) return `skipped: ${result.detail}`;

      for (const event of result.data) {
        await execute(
          `INSERT INTO calendar_events (uid, summary, starts_at, ends_at, all_day, location, description, project_slug, synced_at)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(uid) DO UPDATE SET
             summary = excluded.summary, starts_at = excluded.starts_at,
             ends_at = excluded.ends_at, all_day = excluded.all_day,
             location = excluded.location, description = excluded.description,
             project_slug = excluded.project_slug, synced_at = excluded.synced_at`,
          [
            event.uid,
            event.summary,
            event.startsAt,
            event.endsAt,
            event.allDay ? 1 : 0,
            event.location,
            event.description,
            event.projectSlug,
            isoStamp(),
          ],
        );
      }
      return `${result.data.length} events cached`;
    });
  }

  if (cadence === 'daily') {
    await step(report, 'stripe-reconcile', () => reconcileStripe(snapshot));

    // Prospects published by sitecheck-1's audit engine. It runs on GitHub
    // Actions because discovery needs the live network; this end just collects
    // what it left. Before this step existed, a sweep's results sat unread in a
    // branch for two days, which is indistinguishable from never having run it.
    await step(report, 'prospects', async () => {
      const result = await syncProspects();
      if (result.problem) return `skipped: ${result.problem}`;
      return `${result.added} new, ${result.skipped} already known, of ${result.fetched} audited`;
    });

    await step(report, 'prune', pruneHistory);
  }

  return report;
}

/**
 * Fold Stripe charges into the revenue table.
 *
 * The unique index on (source, external_id) makes this idempotent: re-running
 * it updates the existing row rather than double-counting a charge. That is why
 * a partially-failed tick is safe to simply run again.
 *
 * Only projects whose revenue model is `stripe` get rows. Attributing Stripe
 * income to an affiliate project would be a lie that compounds every day.
 */
async function reconcileStripe(snapshot: Awaited<ReturnType<typeof pulse>>): Promise<string> {
  const charges = snapshot.stripe?.charges ?? [];
  if (charges.length === 0) return 'no charges to reconcile';

  let written = 0;
  const unattributed: string[] = [];

  for (const charge of charges) {
    const project = projectForCharge({
      statementDescriptor: charge.statementDescriptor,
      description: charge.description,
    });

    // No guess. A charge whose business cannot be identified is logged and left
    // out rather than improving some project's ROI by accident — the number
    // would be wrong permanently and nothing would ever flag it.
    if (!project) {
      unattributed.push(charge.id);
      continue;
    }

    await execute(
      `INSERT INTO revenue (project_slug, received_on, gross_pence, fees_pence, refunded_pence, currency, source, external_id, description)
       VALUES (?,?,?,?,?,?,'stripe',?,?)
       ON CONFLICT(source, external_id) DO UPDATE SET
         gross_pence = excluded.gross_pence,
         fees_pence = excluded.fees_pence,
         refunded_pence = excluded.refunded_pence,
         received_on = excluded.received_on,
         project_slug = excluded.project_slug`,
      [
        project.slug,
        charge.createdOn,
        charge.amountPence,
        charge.feePence,
        charge.refundedPence,
        charge.currency,
        charge.id,
        charge.description,
      ],
    );
    written += 1;
  }

  if (unattributed.length > 0) {
    // Surfaced as a failed connector check so it reaches the overview rather
    // than dying in a log nobody reads.
    await execute(
      'INSERT INTO heartbeats (connector, status, latency_ms, detail, checked_at) VALUES (?,?,?,?,?)',
      [
        'stripe',
        'degraded',
        0,
        `${unattributed.length} charge(s) matched no project — add a stripeMatch in ` +
          `config/portfolio.ts: ${unattributed.slice(0, 5).join(', ')}`,
        isoStamp(),
      ],
    );
  }

  return (
    `${written} charge(s) attributed` +
    (unattributed.length ? `, ${unattributed.length} UNATTRIBUTED` : '')
  );
}

/**
 * Keep the tables from growing without bound.
 *
 * Metrics are pruned to the retention setting. Heartbeats are pruned harder —
 * six polls an hour forever is a lot of rows to answer one question ("when did
 * it last tick"), and nobody has ever needed last March's connector latency.
 */
async function pruneHistory(): Promise<string> {
  const retention = Number(
    (await queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
      'metric_retention_days',
    ]))?.value ?? 400,
  );

  const metricCutoff = isoDate(addDays(new Date(), -retention));
  const heartbeatCutoff = isoStamp(addDays(new Date(), -14));

  const metrics = await execute('DELETE FROM metrics WHERE captured_at < ?', [metricCutoff]);
  const beats = await execute('DELETE FROM heartbeats WHERE checked_at < ?', [heartbeatCutoff]);
  // Agent runs are the audit trail for automated work; a year is cheap.
  const runs = await execute('DELETE FROM agent_runs WHERE started_at < ?', [
    isoStamp(addDays(new Date(), -365)),
  ]);

  return `pruned ${metrics.meta.changes} metrics, ${beats.meta.changes} heartbeats, ${runs.meta.changes} runs`;
}

/** Recent tick outcomes, for the setup page and the watchdog agent. */
export async function recentTicks(limit = 20) {
  return query<{ connector: string; status: string; checked_at: string; detail: string }>(
    'SELECT connector, status, checked_at, detail FROM heartbeats ORDER BY checked_at DESC LIMIT ?',
    [limit],
  );
}
