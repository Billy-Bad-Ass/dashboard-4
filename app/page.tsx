import Link from 'next/link';
import { pulse } from '@/lib/heartbeat';
import { revenueSeries } from '@/lib/finance';
import { formatMoney, formatMoneyCompact, formatPercent, roiPercent } from '@/lib/money';
import { relativeTime, formatDate, formatTime } from '@/lib/dates';
import { PageHead } from './components/PageHead';
import { SetupNotice } from './components/SetupNotice';
import { Tile } from './components/Tile';
import { Icon } from './components/Icon';
import { Chart } from './components/Chart';
import { HealthBadge, PulseDot, StageBadge, ConnectorBadge, healthColor } from './components/Badges';

// The whole point is live data; nothing here may be statically cached.
export const dynamic = 'force-dynamic';

export default async function HeartbeatPage() {
  const snapshot = await pulse();
  const series = await revenueSeries(30);
  const { finance, pipeline, projects, connectors } = snapshot;

  const active = projects.filter((p) => p.project.stage !== 'idea' && p.project.stage !== 'paused');
  const stalled = projects.filter((p) => p.health === 'stalled');
  // Human commits only. Adding the bots in would let one cron inflate the
  // portfolio's headline activity figure indefinitely.
  const commits30d = projects.reduce((a, p) => a + (p.repo?.commitCount ?? 0), 0);

  return (
    <>
      <PageHead
        title="Heartbeat"
        sub={
          <>
            Everything the BBA Network portfolio is doing right now — what it earns, what it
            costs, whether anything is being built, and who is in the pipeline.
          </>
        }
        generatedAt={snapshot.generatedAt}
      />

      <div className="stack">
        <SetupNotice configured={snapshot.configured} connectors={connectors} />

        {/* ---------------------------------------------------------- money -- */}
        <div className="grid grid-4">
          <Tile
            label="Net revenue"
            value={formatMoney(finance.netPence)}
            icon="money-bill-trend-up"
            foot={
              finance.netPence === 0
                ? 'Nothing has sold yet. This is measured, not missing.'
                : `${formatMoney(finance.grossPence)} gross, less refunds and fees`
            }
            accent={finance.netPence > 0 ? 'var(--good)' : undefined}
          />
          <Tile
            label="Total spent"
            value={formatMoney(finance.spentPence)}
            icon="wallet"
            foot={`${formatMoney(finance.monthlyBurnPence)}/month burn · ${formatMoney(finance.monthToDateSpendPence)} this month`}
          />
          <Tile
            label="Portfolio ROI"
            value={finance.roi === null ? null : formatPercent(finance.roi)}
            icon="scale-balanced"
            foot={
              finance.roi === null
                ? 'No spend recorded — ROI is undefined, not zero.'
                : `${formatMoney(finance.profitPence)} profit on ${formatMoney(finance.spentPence)} invested`
            }
            accent={
              finance.roi === null ? undefined : finance.roi >= 0 ? 'var(--good)' : 'var(--bad)'
            }
          />
          <Tile
            label="Weighted pipeline"
            value={formatMoneyCompact(pipeline.weightedPence)}
            icon="handshake"
            foot={
              pipeline.totalClients === 0
                ? 'No clients on file yet.'
                : `${formatMoneyCompact(pipeline.openPence)} open across ${pipeline.dealCounts.lead + pipeline.dealCounts.qualified + pipeline.dealCounts.proposal} deals`
            }
          />
        </div>

        {/* --------------------------------------------- pre-revenue reality -- */}
        {finance.netPence === 0 ? (
          <div className="notice notice-info">
            <Icon name="crosshairs" size={16} />
            <div>
              <strong>Pre-revenue. The numbers that matter are on the left of this page, not the right.</strong>
              <div className="small muted" style={{ marginTop: 3 }}>
                {formatMoney(finance.spentPence)} invested, {formatMoney(finance.monthlyBurnPence)}/month
                going out, and {commits30d} commit{commits30d === 1 ? '' : 's'} across the portfolio in
                the last 30 days. Until something sells, build velocity and the gates on each project
                page are the leading indicators — revenue is a lagging one, and right now it lags all
                the way to zero.
              </div>
            </div>
          </div>
        ) : null}

        {stalled.length > 0 ? (
          <div className="notice notice-warn">
            <Icon name="circle-exclamation" size={16} />
            <div>
              <strong>
                {stalled.length} project{stalled.length === 1 ? '' : 's'} stalled.
              </strong>
              <div className="small muted" style={{ marginTop: 3 }}>
                {stalled.map((p, i) => (
                  <span key={p.project.slug}>
                    {i > 0 ? ' · ' : ''}
                    <Link href={`/projects/${p.project.slug}`}>{p.project.name}</Link>: {p.healthReason}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* ------------------------------------------------------- projects -- */}
        <section>
          <div className="card-head">
            <h2 className="card-title">
              <Icon name="diagram-project" size={13} />
              Projects
            </h2>
            <span className="tiny faint">
              {active.length} active of {projects.length}
            </span>
          </div>

          <div className="grid grid-3">
            {projects.map((p) => (
              <Link
                key={p.project.slug}
                href={`/projects/${p.project.slug}`}
                className="card project-card"
                style={{
                  display: 'block',
                  color: 'inherit',
                  textDecoration: 'none',
                  // Identity rail. Five cards of identical zeroes are otherwise
                  // indistinguishable at a glance, which is most of what a
                  // portfolio overview is for.
                  ['--project-accent' as string]: p.project.accent,
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <Icon
                      name={p.project.icon}
                      size={14}
                      className="project-icon"
                    />
                    <strong style={{ fontSize: 14.5 }}>{p.project.name}</strong>
                    <PulseDot health={p.health} />
                  </div>
                  <StageBadge stage={p.project.stage} />
                </div>

                <div className="small muted" style={{ minHeight: 38 }}>
                  {p.project.tagline}
                </div>

                <div className="divider" style={{ margin: '12px 0 10px' }} />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <MiniStat
                    label="Net"
                    value={formatMoney(p.finance.netPence)}
                    tone={p.finance.netPence > 0 ? 'good' : undefined}
                  />
                  <MiniStat label="Spent" value={formatMoney(p.finance.spentPence)} />
                  <MiniStat
                    label="ROI"
                    value={p.finance.roi === null ? '—' : formatPercent(p.finance.roi)}
                    tone={p.finance.roi === null ? undefined : p.finance.roi >= 0 ? 'good' : 'bad'}
                  />
                  <MiniStat
                    label="Commits 30d"
                    value={p.repo ? String(p.repo.commitCount) : '—'}
                  />
                </div>

                <div
                  className="tiny"
                  style={{
                    marginTop: 11,
                    color: healthColor(p.health),
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Icon name="bolt" size={11} />
                  {p.healthReason}
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------- charts + status -- */}
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Icon name="chart-line" size={13} />
                Net revenue · 30 days
              </h2>
              <span className="tiny faint">{formatMoney(finance.monthToDateNetPence)} this month</span>
            </div>
            <Chart
              points={series.map((d) => ({ date: d.date, value: d.netPence }))}
              label="Net revenue"
              height={120}
              emptyNote="Flat at zero throughout — measured, not missing"
            />
          </div>

          <div className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Icon name="tower-broadcast" size={13} />
                Connectors
              </h2>
              <span className="tiny faint">
                {snapshot.lastCronMinutes === null
                  ? 'cron has never run'
                  : `heartbeat ${snapshot.lastCronMinutes}m ago`}
              </span>
            </div>
            <div className="stack" style={{ gap: 9 }}>
              {connectors.map((c) => (
                <div key={c.name}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="row" style={{ gap: 7, fontWeight: 570, fontSize: 13.5 }}>
                      <Icon name={connectorIcon(c.name)} size={13} />
                      {c.name}
                    </span>
                    <ConnectorBadge status={c.status} />
                  </div>
                  <div className="tiny faint" style={{ marginTop: 2 }}>
                    {c.detail}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* --------------------------------------------------- agents + cal -- */}
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Icon name="robot" size={13} />
                Agent fleet
              </h2>
              <Link href="/agents" className="tiny">
                All runs <Icon name="arrow-right" size={10} />
              </Link>
            </div>
            {snapshot.agentRuns.length === 0 ? (
              <div className="empty">
                <strong>No agent runs recorded.</strong>
                Scheduled agents report here once the workflows in .github/workflows run and post
                back to <span className="mono">/api/agent-runs</span>.
              </div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {snapshot.agentRuns.slice(0, 6).map((run) => (
                  <div key={run.id} className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="row" style={{ gap: 8 }}>
                      <span
                        className="pulse still"
                        style={{ background: runColor(run.status) }}
                        aria-hidden="true"
                      />
                      <span style={{ fontSize: 13.5, fontWeight: 560 }}>{run.agent}</span>
                      {run.summary ? (
                        <span className="tiny faint" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {run.summary}
                        </span>
                      ) : null}
                    </span>
                    <span className="tiny faint">{relativeTime(run.started_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Icon name="calendar-days" size={13} />
                Next up
              </h2>
              <Link href="/calendar" className="tiny">
                Calendar <Icon name="arrow-right" size={10} />
              </Link>
            </div>
            {snapshot.events.length === 0 ? (
              <div className="empty">
                <strong>No upcoming events.</strong>
                Either the calendar feed is not connected, or there is genuinely nothing booked.
              </div>
            ) : (
              <div className="stack" style={{ gap: 9 }}>
                {snapshot.events.slice(0, 6).map((event) => (
                  <div key={event.uid} className="row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13.5 }}>{event.summary}</span>
                    <span className="tiny faint">
                      {formatDate(event.startsAt)}
                      {event.allDay ? '' : ` · ${formatTime(event.startsAt)}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------- pipeline -- */}
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Icon name="users" size={13} />
              Client pipeline
            </h2>
            <Link href="/clients" className="tiny">
              Open CRM <Icon name="arrow-right" size={10} />
            </Link>
          </div>
          {pipeline.totalClients === 0 ? (
            <div className="empty">
              <strong>No clients or prospects on file.</strong>
              This is a real empty state, not a loading one — the database has zero rows. Add the
              first one from the <Link href="/clients">Clients</Link> page.
            </div>
          ) : (
            <div className="grid grid-4">
              <Tile
                label="Current clients"
                value={String(pipeline.counts.current)}
                icon="building"
                foot={`${pipeline.counts.prospect} prospects, ${pipeline.counts.engaged} in conversation`}
              />
              <Tile
                label="Open pipeline"
                value={formatMoney(pipeline.openPence)}
                icon="file-invoice-dollar"
                foot={`${formatMoney(pipeline.weightedPence)} probability-weighted`}
              />
              <Tile
                label="Won"
                value={formatMoney(pipeline.wonPence)}
                icon="circle-check"
                foot={`${pipeline.dealCounts.won} deals closed`}
              />
              <Tile
                label="Needs attention"
                value={String(pipeline.dueActions.length + pipeline.goingCold.length)}
                icon="clock"
                foot={`${pipeline.dueActions.length} actions due, ${pipeline.goingCold.length} going cold`}
                higherIsBetter={false}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div>
      <div className="tiny faint" style={{ letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 640,
          fontVariantNumeric: 'tabular-nums',
          color: tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function connectorIcon(name: string): string {
  return (
    {
      Stripe: 'brand-stripe',
      GitHub: 'brand-github',
      Cloudflare: 'brand-cloudflare',
      Calendar: 'brand-google',
    }[name] ?? 'circle-nodes'
  );
}

function runColor(status: string): string {
  return (
    {
      ok: 'var(--good)',
      failed: 'var(--bad)',
      running: 'var(--accent)',
      queued: 'var(--idle)',
      skipped: 'var(--idle)',
    }[status] ?? 'var(--idle)'
  );
}
