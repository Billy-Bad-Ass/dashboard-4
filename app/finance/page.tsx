import type { Metadata } from 'next';
import { pulse } from '@/lib/heartbeat';
import { expandSpend, revenueSeries, type SpendRow } from '@/lib/finance';
import { query } from '@/lib/db';
import { formatMoney, formatPercent } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import { PROJECTS } from '@/config/portfolio';
import { PageHead } from '@/app/components/PageHead';
import { Tile } from '@/app/components/Tile';
import { Icon } from '@/app/components/Icon';
import { Sparkline, StackedBar } from '@/app/components/Sparkline';
import { SpendForm } from '@/app/components/SpendForm';
import { DeleteButton } from '@/app/components/DeleteButton';

export const metadata: Metadata = { title: 'Money' };
export const dynamic = 'force-dynamic';

const CATEGORY_COLOR: Record<string, string> = {
  infra: '#2B5CE6',
  tooling: '#7C5CE6',
  ai: '#12A150',
  marketing: '#E6842B',
  contractor: '#C2410C',
  fees: '#8B93A3',
  other: '#5C6472',
};

export default async function FinancePage() {
  const snapshot = await pulse();
  const { finance } = snapshot;

  const [spendRows, series] = await Promise.all([
    query<SpendRow>('SELECT * FROM spend ORDER BY incurred_on DESC LIMIT 200'),
    revenueSeries(60),
  ]);

  // Category totals use expanded occurrences, so a £5/month subscription that
  // has run four months counts as £20 here rather than £5.
  const now = new Date();
  const epoch = new Date('2000-01-01T00:00:00Z');
  const occurrences = spendRows.flatMap((row) => expandSpend(row, epoch, now));

  const byCategory = new Map<string, number>();
  for (const occ of occurrences) {
    byCategory.set(occ.category, (byCategory.get(occ.category) ?? 0) + occ.amountPence);
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);

  // Runway only means something when money is going out. With no revenue it is
  // "until you stop paying", which is not a number — so it is stated in words.
  const monthlyNet = finance.monthToDateNetPence - finance.monthToDateSpendPence;

  return (
    <>
      <PageHead
        title="Money"
        sub="Every pound in and out of the portfolio, and what each project has to show for it."
        generatedAt={snapshot.generatedAt}
        actions={<SpendForm />}
      />

      <div className="stack">
        <div className="grid grid-4">
          <Tile
            label="Net revenue"
            value={formatMoney(finance.netPence)}
            icon="money-bill-trend-up"
            foot={`${formatMoney(finance.grossPence)} gross · ${formatMoney(finance.refundedPence)} refunded · ${formatMoney(finance.feesPence)} fees`}
          />
          <Tile
            label="Total invested"
            value={formatMoney(finance.spentPence)}
            icon="wallet"
            foot={`${occurrences.length} charge${occurrences.length === 1 ? '' : 's'} across ${spendRows.length} ledger row${spendRows.length === 1 ? '' : 's'}`}
          />
          <Tile
            label="Monthly burn"
            value={formatMoney(finance.monthlyBurnPence)}
            icon="chart-line"
            foot="Trailing 90-day average, normalised to a 30.44-day month."
            higherIsBetter={false}
          />
          <Tile
            label="This month"
            value={formatMoney(monthlyNet)}
            icon="scale-balanced"
            foot={`${formatMoney(finance.monthToDateNetPence)} in, ${formatMoney(finance.monthToDateSpendPence)} out`}
            accent={monthlyNet >= 0 ? 'var(--good)' : 'var(--bad)'}
          />
        </div>

        {finance.netPence === 0 && finance.spentPence > 0 ? (
          <div className="notice notice-info">
            <Icon name="scale-balanced" size={16} />
            <div>
              <strong>
                Portfolio ROI is {formatPercent(finance.roi)} — every penny invested, none returned.
              </strong>
              <div className="small muted" style={{ marginTop: 3 }}>
                That is the correct number for a pre-revenue portfolio and it will stay at -100%
                until something sells. It is worth watching not because it moves, but because the
                denominator does: at {formatMoney(finance.monthlyBurnPence)} a month, the cost of
                being wrong grows even when nothing else does.
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Icon name="chart-line" size={13} />
                Net revenue · 60 days
              </h2>
            </div>
            <Sparkline
              values={series.map((d) => d.netPence)}
              height={70}
              label="Net revenue over 60 days"
            />
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
              <span className="tiny faint">{formatDate(series[0]?.date)}</span>
              <span className="tiny faint">today</span>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Icon name="chart-pie" size={13} />
                Where the money went
              </h2>
              <span className="tiny faint">{formatMoney(finance.spentPence)} total</span>
            </div>
            {categories.length === 0 ? (
              <div className="empty">
                <strong>No spend recorded.</strong>
                Use “Record spend” above — this is the denominator of every ROI figure on the site.
              </div>
            ) : (
              <>
                <StackedBar
                  segments={categories.map(([name, value]) => ({
                    label: name,
                    value,
                    color: CATEGORY_COLOR[name] ?? 'var(--idle)',
                  }))}
                />
                <div className="stack" style={{ gap: 6, marginTop: 12 }}>
                  {categories.map(([name, value]) => (
                    <div key={name} className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="row" style={{ gap: 7, fontSize: 13.5 }}>
                        <span
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: 2,
                            background: CATEGORY_COLOR[name] ?? 'var(--idle)',
                          }}
                        />
                        {name}
                      </span>
                      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 580 }}>
                        {formatMoney(value)}
                        <span className="tiny faint" style={{ marginLeft: 6 }}>
                          {((value / finance.spentPence) * 100).toFixed(0)}%
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ------------------------------------------------- per-project ROI -- */}
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Icon name="diagram-project" size={13} />
              Return by project
            </h2>
            <span className="tiny faint">
              Overhead split across{' '}
              {finance.overheadSharedBy.length === 0
                ? 'nobody'
                : `${finance.overheadSharedBy.length} project${finance.overheadSharedBy.length === 1 ? '' : 's'}`}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th className="num">Direct spend</th>
                  <th className="num">Overhead</th>
                  <th className="num">Total in</th>
                  <th className="num">Net out</th>
                  <th className="num">Profit</th>
                  <th className="num">ROI</th>
                </tr>
              </thead>
              <tbody>
                {finance.byProject.map((row) => {
                  const project = PROJECTS.find((p) => p.slug === row.slug)!;
                  return (
                    <tr key={row.slug}>
                      <td>
                        <a href={`/projects/${row.slug}`} style={{ fontWeight: 570 }}>
                          {project.name}
                        </a>
                      </td>
                      <td className="num">{formatMoney(row.directSpendPence)}</td>
                      <td className="num faint">{formatMoney(row.overheadPence)}</td>
                      <td className="num">{formatMoney(row.spentPence)}</td>
                      <td className="num">{formatMoney(row.netPence)}</td>
                      <td
                        className="num"
                        style={{ color: row.profitPence >= 0 ? 'var(--good)' : 'var(--bad)' }}
                      >
                        {formatMoney(row.profitPence)}
                      </td>
                      <td
                        className="num"
                        style={{
                          color:
                            row.roi === null
                              ? 'var(--text-faint)'
                              : row.roi >= 0
                                ? 'var(--good)'
                                : 'var(--bad)',
                        }}
                      >
                        {row.roi === null ? '—' : formatPercent(row.roi)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="tiny faint" style={{ marginTop: 12 }}>
            A dash in the ROI column means nothing has been spent on that project, so the ratio is
            undefined rather than zero. Overhead is portfolio-wide spend (rows with no project) split
            by the <span className="mono">overhead_apportionment</span> setting.
          </div>
        </div>

        {/* ------------------------------------------------------ the ledger -- */}
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Icon name="file-invoice-dollar" size={13} />
              Spend ledger
            </h2>
            <span className="tiny faint">{spendRows.length} rows</span>
          </div>
          {spendRows.length === 0 ? (
            <div className="empty">
              <strong>The ledger is empty.</strong>
              Every ROI number on this dashboard reads from here.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Vendor</th>
                    <th>Project</th>
                    <th>Category</th>
                    <th>Recurs</th>
                    <th className="num">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {spendRows.map((row) => (
                    <tr key={row.id}>
                      <td className="mono tiny">{formatDate(row.incurred_on)}</td>
                      <td>
                        {row.vendor}
                        {row.note ? <div className="tiny faint">{row.note}</div> : null}
                      </td>
                      <td className="tiny">
                        {row.project_slug ? (
                          <a href={`/projects/${row.project_slug}`}>
                            {PROJECTS.find((p) => p.slug === row.project_slug)?.name ??
                              row.project_slug}
                          </a>
                        ) : (
                          <span className="faint">Portfolio</span>
                        )}
                      </td>
                      <td className="tiny muted">{row.category}</td>
                      <td className="tiny">
                        {row.recurrence === 'once' ? (
                          <span className="faint">—</span>
                        ) : (
                          <span className="badge badge-neutral">{row.recurrence}</span>
                        )}
                      </td>
                      <td className="num">{formatMoney(row.amount_pence)}</td>
                      <td className="num">
                        <DeleteButton endpoint={`/api/spend?id=${row.id}`} label="spend row" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
