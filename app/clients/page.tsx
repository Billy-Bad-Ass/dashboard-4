import type { Metadata } from 'next';
import Link from 'next/link';
import { listClients, loadPipeline, STATUS_META } from '@/lib/crm';
import { draftCounts, listDrafts } from '@/lib/drafts';
import { queryOne } from '@/lib/db';
import { pulse } from '@/lib/heartbeat';
import { formatMoney } from '@/lib/money';
import { CATEGORICAL, TAIL } from '@/lib/palette';
import { formatDate, relativeTime } from '@/lib/dates';
import { PageHead } from '@/app/components/PageHead';
import { Tile } from '@/app/components/Tile';
import { Icon } from '@/app/components/Icon';
import { StackedBar } from '@/app/components/Chart';
import { ClientBoard } from '@/app/components/ClientBoard';
import { DraftQueue } from '@/app/components/DraftQueue';

export const metadata: Metadata = { title: 'Clients' };
export const dynamic = 'force-dynamic';

/**
 * Deal stages are ordered, not nominal — lead through won is a progression — so
 * they take the categorical slots in that order and the two terminal states
 * take status colours, which is what they actually mean.
 */
const STAGE_COLOR: Record<string, string> = {
  lead: TAIL,
  qualified: CATEGORICAL[0],
  proposal: CATEGORICAL[3],
  won: 'var(--good)',
  lost: 'var(--bad)',
};

export default async function ClientsPage() {
  const [clients, pipeline, snapshot, counts, recentDrafts, drafterRow] = await Promise.all([
    listClients(),
    loadPipeline(),
    pulse(),
    draftCounts(),
    listDrafts(undefined, 12),
    queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['gmail_drafter_url']),
  ]);

  return (
    <>
      <PageHead
        title="Clients"
        sub="Current and prospective, in one list. A prospect that signs changes status and keeps every interaction that got it there."
        generatedAt={snapshot.generatedAt}
      />

      <div className="stack">
        <div className="grid grid-4">
          <Tile
            label="Current clients"
            value={String(pipeline.counts.current)}
            icon="building"
            foot={`${pipeline.totalClients} contacts on file`}
          />
          <Tile
            label="Open pipeline"
            value={formatMoney(pipeline.openPence)}
            icon="handshake"
            foot={`${pipeline.dealCounts.lead + pipeline.dealCounts.qualified + pipeline.dealCounts.proposal} open deals`}
          />
          <Tile
            label="Weighted"
            value={formatMoney(pipeline.weightedPence)}
            icon="scale-balanced"
            foot="Each deal multiplied by its probability. The number to plan against."
          />
          <Tile
            label="Won to date"
            value={formatMoney(pipeline.wonPence)}
            icon="circle-check"
            foot={`${pipeline.dealCounts.won} won, ${pipeline.dealCounts.lost} lost`}
            accent={pipeline.wonPence > 0 ? 'var(--good)' : undefined}
          />
        </div>

        {pipeline.dueActions.length > 0 || pipeline.goingCold.length > 0 ? (
          <div className="grid grid-2">
            {pipeline.dueActions.length > 0 ? (
              <div className="card">
                <div className="card-head">
                  <h2 className="card-title">
                    <Icon name="bullseye" size={13} />
                    Actions due
                  </h2>
                </div>
                <div className="stack" style={{ gap: 8 }}>
                  {pipeline.dueActions.map((c) => (
                    <div key={c.id} className="row" style={{ justifyContent: 'space-between' }}>
                      <Link href={`/clients/${c.id}`} style={{ fontSize: 13.5 }}>
                        {c.name}
                      </Link>
                      <span className="tiny muted">
                        {c.next_action} · {formatDate(c.next_action_on)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {pipeline.goingCold.length > 0 ? (
              <div className="card">
                <div className="card-head">
                  <h2 className="card-title">
                    <Icon name="clock" size={13} />
                    Going cold
                  </h2>
                  <span className="tiny faint">no contact recently</span>
                </div>
                <div className="stack" style={{ gap: 8 }}>
                  {pipeline.goingCold.map((c) => (
                    <div key={c.id} className="row" style={{ justifyContent: 'space-between' }}>
                      <Link href={`/clients/${c.id}`} style={{ fontSize: 13.5 }}>
                        {c.name}
                      </Link>
                      <span className="tiny muted">
                        {c.last_contact_on ? relativeTime(c.last_contact_on) : 'never contacted'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {pipeline.totalClients > 0 ? (
          <div className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Icon name="chart-pie" size={13} />
                Pipeline by stage
              </h2>
            </div>
            <StackedBar
              segments={Object.entries(pipeline.dealCounts).map(([stage, count]) => ({
                label: stage,
                value: count,
                color: STAGE_COLOR[stage] ?? 'var(--idle)',
              }))}
            />
            <div className="row" style={{ marginTop: 10, gap: 14 }}>
              {Object.entries(pipeline.dealCounts).map(([stage, count]) => (
                <span key={stage} className="row" style={{ gap: 6, fontSize: 12.5 }}>
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 2,
                      background: STAGE_COLOR[stage] ?? 'var(--idle)',
                    }}
                  />
                  {stage} · {count}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <DraftQueue
          counts={counts}
          recent={recentDrafts}
          drafterConfigured={Boolean(drafterRow?.value)}
        />

        <ClientBoard clients={clients} />

        <div className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>
            <Icon name="circle-nodes" size={13} />
            What the statuses mean
          </div>
          <div className="grid grid-3">
            {Object.entries(STATUS_META).map(([key, meta]) => (
              <div key={key}>
                <span className={`badge badge-${meta.tone}`}>{meta.label}</span>
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  {meta.hint}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
