import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { projectBySlug, type VitalSpec } from '@/config/portfolio';
import { pulse, type ProjectPulse } from '@/lib/heartbeat';
import { query } from '@/lib/db';
import { formatMoney, formatPercent } from '@/lib/money';
import { formatDate, relativeTime } from '@/lib/dates';
import { PageHead } from '@/app/components/PageHead';
import { Tile } from '@/app/components/Tile';
import { Icon } from '@/app/components/Icon';
import { Chart } from '@/app/components/Chart';
import { HealthBadge, StageBadge, PulseDot, healthColor } from '@/app/components/Badges';
import { SpendForm } from '@/app/components/SpendForm';

/**
 * Rendered on demand, always.
 *
 * There is deliberately no generateStaticParams here. Adding it makes Next
 * prerender the four project pages at build time, and a prerendered page on a
 * live dashboard serves whatever the numbers were when the deploy ran — which
 * looks exactly like a working page and is the worst kind of wrong. The routes
 * are resolved from config/portfolio.ts at request time instead.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project = projectBySlug(slug);
  return { title: project ? project.name : 'Project' };
}

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = projectBySlug(slug);
  if (!project) notFound();

  const snapshot = await pulse();
  const state = snapshot.projects.find((p) => p.project.slug === slug);
  if (!state) notFound();

  const [spendRows, revenueRows, history] = await Promise.all([
    query<{
      id: number;
      incurred_on: string;
      amount_pence: number;
      category: string;
      vendor: string;
      note: string | null;
      recurrence: string;
    }>(
      'SELECT id, incurred_on, amount_pence, category, vendor, note, recurrence FROM spend WHERE project_slug = ? ORDER BY incurred_on DESC LIMIT 50',
      [slug],
    ),
    query<{
      id: number;
      received_on: string;
      gross_pence: number;
      refunded_pence: number;
      fees_pence: number;
      source: string;
      description: string | null;
    }>(
      'SELECT id, received_on, gross_pence, refunded_pence, fees_pence, source, description FROM revenue WHERE project_slug = ? ORDER BY received_on DESC LIMIT 50',
      [slug],
    ),
    query<{ metric_key: string; value_num: number; captured_at: string }>(
      'SELECT metric_key, value_num, captured_at FROM metrics WHERE project_slug = ? ORDER BY captured_at ASC LIMIT 2000',
      [slug],
    ),
  ]);

  const byMetric = new Map<string, { date: string; value: number }[]>();
  for (const row of history) {
    const list = byMetric.get(row.metric_key) ?? [];
    list.push({ date: row.captured_at, value: row.value_num });
    byMetric.set(row.metric_key, list);
  }

  return (
    <>
      <PageHead
        title={project.name}
        sub={project.tagline}
        generatedAt={snapshot.generatedAt}
        actions={
          <>
            <a
              className="btn btn-sm"
              href={`https://github.com/${project.repo}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              <Icon name="brand-github" size={13} /> Repo
            </a>
            {project.liveUrl ? (
              <a className="btn btn-sm" href={project.liveUrl} target="_blank" rel="noreferrer noopener">
                <Icon name="arrow-up-right-from-square" size={12} /> Live
              </a>
            ) : null}
          </>
        }
      />

      <div className="stack">
        <div className="row" style={{ gap: 8 }}>
          <PulseDot health={state.health} />
          <HealthBadge health={state.health} />
          <StageBadge stage={project.stage} />
          <span className="small" style={{ color: healthColor(state.health) }}>
            {state.healthReason}
          </span>
        </div>

        {/* ------------------------------------------------ honest position -- */}
        <div className="card" style={{ borderLeft: `3px solid ${project.accent}` }}>
          <div className="card-title" style={{ marginBottom: 8 }}>
            <Icon name="crosshairs" size={13} />
            Where this actually stands
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.62 }}>{project.reality}</p>
        </div>

        {/* -------------------------------------------------------- vitals -- */}
        <div className="grid grid-4">
          {project.vitals.map((vital) => (
            <VitalTile
              key={vital.key}
              spec={vital}
              value={state.vitals[vital.key] ?? null}
              accent={project.accent}
            />
          ))}
        </div>

        {/* ------------------------------------------------------- money ---- */}
        <div className="grid grid-4">
          <Tile
            label="Net revenue"
            value={formatMoney(state.finance.netPence)}
            icon="money-bill-trend-up"
            foot={
              state.finance.grossPence === 0
                ? 'Nothing has come in.'
                : `${formatMoney(state.finance.grossPence)} gross · ${formatMoney(state.finance.refundedPence)} refunded · ${formatMoney(state.finance.feesPence)} fees`
            }
          />
          <Tile
            label="Spent"
            value={formatMoney(state.finance.spentPence)}
            icon="wallet"
            foot={
              state.finance.overheadPence > 0
                ? `${formatMoney(state.finance.directSpendPence)} direct + ${formatMoney(state.finance.overheadPence)} share of portfolio overhead`
                : 'All direct — no overhead apportioned.'
            }
          />
          <Tile
            label="ROI"
            value={state.finance.roi === null ? null : formatPercent(state.finance.roi)}
            icon="scale-balanced"
            foot={
              state.finance.roi === null
                ? 'Nothing spent on this yet.'
                : `${formatMoney(state.finance.profitPence)} ${state.finance.profitPence < 0 ? 'down' : 'up'}`
            }
            accent={
              state.finance.roi === null
                ? undefined
                : state.finance.roi >= 0
                  ? 'var(--good)'
                  : 'var(--bad)'
            }
          />
          <Tile
            label="Age"
            value={`${Math.max(0, Math.floor((Date.now() - new Date(project.startedOn).getTime()) / 86_400_000))}d`}
            icon="hourglass-half"
            foot={
              state.finance.daysToFirstRevenue === null
                ? `Started ${formatDate(project.startedOn)} · no revenue yet`
                : `First revenue after ${state.finance.daysToFirstRevenue} days`
            }
          />
        </div>

        <div className="grid grid-2">
          {/* --------------------------------------------------- the gates -- */}
          <div className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Icon name="list-check" size={13} />
                What has to be true before this earns
              </h2>
            </div>
            <ul className="checklist">
              {project.gates.map((gate) => (
                <li key={gate}>
                  <Icon name="circle-check" size={13} />
                  <span>{gate}</span>
                </li>
              ))}
            </ul>
            <div className="tiny faint" style={{ marginTop: 12 }}>
              Edit these in <span className="mono">config/portfolio.ts</span>. They are deliberately
              not a database — a gate you can tick off without a commit is a gate you will tick off
              without doing the work.
            </div>
          </div>

          {/* ------------------------------------------------ repo activity -- */}
          <div className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Icon name="code-branch" size={13} />
                Repository
              </h2>
              <span className="tiny faint mono">{project.repo}</span>
            </div>
            {state.repo && state.repo.exists ? (
              <div className="stack" style={{ gap: 10 }}>
                <RepoRow label="Commits (30d)" value={String(state.repo.commitCount)} />
                <RepoRow
                  label="Last commit"
                  value={state.repo.lastCommitAt ? relativeTime(state.repo.lastCommitAt) : 'never'}
                />
                <RepoRow label="Open issues" value={String(state.repo.openIssues)} />
                <RepoRow label="Open PRs" value={String(state.repo.openPulls)} />
                <RepoRow
                  label="CI"
                  value={state.repo.ciStatus ?? 'no runs'}
                  tone={
                    state.repo.ciStatus === 'success'
                      ? 'good'
                      : state.repo.ciStatus === 'failure'
                        ? 'bad'
                        : undefined
                  }
                  href={state.repo.ciUrl}
                />
                <RepoRow label="Size" value={`${state.repo.sizeKb} KB`} />
                {state.repo.lastCommitMessage ? (
                  <div className="tiny faint" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <Icon name="code-commit" size={11} /> {state.repo.lastCommitMessage}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty">
                <strong>Repository not readable.</strong>
                Either it does not exist, or it is private and no GITHUB_TOKEN is set.
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------ metric history -- */}
        {byMetric.size > 0 ? (
          <div className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Icon name="chart-line" size={13} />
                Recorded history
              </h2>
              <span className="tiny faint">{history.length} snapshots</span>
            </div>
            <div className="grid grid-3">
              {[...byMetric.entries()].map(([key, points]) => {
                const spec = project.vitals.find((v) => v.key === key);
                return (
                  <div key={key}>
                    <div className="tiny faint" style={{ marginBottom: 4 }}>
                      {spec?.label ?? key}
                    </div>
                    <Chart
                      points={points}
                      label={spec?.label ?? key}
                      color={project.accent}
                      height={90}
                      format={(v) => formatVital(v, spec?.unit)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* ---------------------------------------------------- the ledger -- */}
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Icon name="wallet" size={13} />
                Spend on this project
              </h2>
              <Link href="/finance" className="tiny">
                All spend <Icon name="arrow-right" size={10} />
              </Link>
            </div>
            <SpendForm defaultProject={slug} />
            {spendRows.length === 0 ? (
              <div className="empty" style={{ marginTop: 12 }}>
                <strong>Nothing charged directly to this project.</strong>
                {state.finance.overheadPence > 0
                  ? `It still carries ${formatMoney(state.finance.overheadPence)} as its share of portfolio overhead.`
                  : 'And no overhead apportioned to it either.'}
              </div>
            ) : (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Vendor</th>
                      <th>Category</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spendRows.map((row) => (
                      <tr key={row.id}>
                        <td className="mono tiny">{formatDate(row.incurred_on)}</td>
                        <td>
                          {row.vendor}
                          {row.recurrence !== 'once' ? (
                            <span className="badge badge-neutral" style={{ marginLeft: 6 }}>
                              {row.recurrence}
                            </span>
                          ) : null}
                        </td>
                        <td className="tiny muted">{row.category}</td>
                        <td className="num">{formatMoney(row.amount_pence)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Icon name="money-bill-trend-up" size={13} />
                Revenue on this project
              </h2>
            </div>
            {revenueRows.length === 0 ? (
              <div className="empty">
                <strong>No revenue rows.</strong>
                {project.revenueModel === 'stripe'
                  ? 'The Stripe poller writes here as soon as a real charge succeeds.'
                  : project.revenueModel === 'affiliate'
                    ? 'Affiliate networks have no usable live API — enter payouts from the network dashboard through the API or a migration.'
                    : 'This project is not expected to earn directly.'}
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Source</th>
                      <th className="num">Gross</th>
                      <th className="num">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenueRows.map((row) => (
                      <tr key={row.id}>
                        <td className="mono tiny">{formatDate(row.received_on)}</td>
                        <td className="tiny muted">{row.source}</td>
                        <td className="num">{formatMoney(row.gross_pence)}</td>
                        <td className="num">
                          {formatMoney(row.gross_pence - row.refunded_pence - row.fees_pence)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------- events --- */}
        {state.events.length > 0 ? (
          <div className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Icon name="calendar-days" size={13} />
                Scheduled for this project
              </h2>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {state.events.map((event) => (
                <div key={event.uid} className="row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13.5 }}>{event.summary}</span>
                  <span className="tiny faint">{formatDate(event.startsAt)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** Shared by the vital tiles and the history charts so they cannot disagree. */
function formatVital(value: number, unit: VitalSpec['unit'] | undefined): string {
  if (unit === 'gbp') return formatMoney(value);
  if (unit === 'percent') return `${value.toFixed(1)}%`;
  if (unit === 'days') return `${Math.round(value)}d`;
  return Math.round(value).toLocaleString('en-GB');
}

function VitalTile({
  spec,
  value,
  accent,
}: {
  spec: VitalSpec;
  value: number | null;
  accent: string;
}) {
  const formatted = value === null ? null : formatVital(value, spec.unit);

  const onTarget =
    value === null || spec.target === null
      ? null
      : spec.lowerIsBetter
        ? value <= spec.target
        : value >= spec.target;

  return (
    <Tile
      label={spec.label}
      value={formatted}
      foot={
        <>
          {spec.target !== null && value !== null ? (
            <span className={onTarget ? 'up' : 'down'}>
              {onTarget ? 'on target' : 'off target'} ({spec.lowerIsBetter ? '≤' : '≥'}
              {spec.target}
              {spec.unit === 'percent' ? '%' : ''}) ·{' '}
            </span>
          ) : null}
          {spec.hint}
        </>
      }
      accent={value !== null && onTarget === false ? 'var(--warn)' : accent}
      higherIsBetter={!spec.lowerIsBetter}
    />
  );
}

function RepoRow({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
  href?: string | null;
}) {
  const body = (
    <span
      style={{
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        color: tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : undefined,
      }}
    >
      {value}
    </span>
  );
  return (
    <div className="row" style={{ justifyContent: 'space-between', fontSize: 13.5 }}>
      <span className="muted">{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {body}
        </a>
      ) : (
        body
      )}
    </div>
  );
}
