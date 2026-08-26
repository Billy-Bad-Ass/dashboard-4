import Link from 'next/link';
import type { Draft, DraftCounts } from '@/lib/drafts';
import { relativeTime } from '@/lib/dates';
import { Icon } from './Icon';

/**
 * The draft queue, on the Clients page.
 *
 * Three states and no fourth. Nothing here can send an email, so the trail
 * honestly goes cold at "it is in your drafts folder" — showing a `sent` column
 * would be showing a state this system cannot observe.
 *
 * The empty state is doing real work. An empty queue has two very different
 * causes — nothing has been written yet, or the drafter was never wired up —
 * and a panel that showed the same blank for both would hide a broken
 * deployment behind a plausible one.
 */
export function DraftQueue({
  counts,
  recent,
  drafterConfigured,
}: {
  counts: DraftCounts;
  recent: Draft[];
  drafterConfigured: boolean;
}) {
  const total = counts.queued + counts.delivered + counts.failed;

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">
          <Icon name="envelope" size={13} />
          Outreach drafts
        </h2>
        <span className="tiny faint">written here, sent by you in Gmail</span>
      </div>

      {!drafterConfigured ? (
        <div className="notice notice-warn tiny" style={{ marginBottom: 12 }}>
          <Icon name="circle-exclamation" size={13} />
          <span>
            No drafter is connected, so nothing can reach your mailbox. Deploy the Apps Script in{' '}
            <span className="mono">docs/GMAIL-DRAFTER.md</span> and store its URL.
          </span>
        </div>
      ) : null}

      {total === 0 ? (
        <div className="empty">
          <strong>No drafts yet.</strong>
          {drafterConfigured
            ? 'The drafter is connected and waiting. Drafts appear here the moment one is written, and land in your Gmail on the next tick.'
            : 'And nowhere for them to go until the drafter is connected.'}
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <StateCount label="Queued" value={counts.queued} hint="written, not yet in Gmail" />
            <StateCount
              label="In your drafts"
              value={counts.delivered}
              hint="waiting for you to press send"
              tone="good"
            />
            <StateCount
              label="Failed"
              value={counts.failed}
              hint="the push was refused"
              tone={counts.failed > 0 ? 'bad' : undefined}
            />
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>To</th>
                  <th>Subject</th>
                  <th>State</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((draft) => (
                  <tr key={draft.id}>
                    <td className="mono tiny">
                      <Link href={`/clients/${draft.client_id}`}>{draft.to_address}</Link>
                    </td>
                    <td className="tiny">{draft.subject}</td>
                    <td>
                      <span
                        className={`badge badge-${
                          draft.state === 'delivered'
                            ? 'good'
                            : draft.state === 'failed'
                              ? 'bad'
                              : 'neutral'
                        }`}
                      >
                        {draft.state === 'delivered' ? 'in your drafts' : draft.state}
                      </span>
                      {draft.error ? (
                        <div className="tiny muted" style={{ marginTop: 3 }}>
                          {draft.error}
                        </div>
                      ) : null}
                    </td>
                    <td className="tiny muted">
                      {relativeTime(draft.delivered_at ?? draft.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StateCount({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 21,
          fontWeight: 650,
          fontVariantNumeric: 'tabular-nums',
          color: tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : undefined,
        }}
      >
        {value}
      </div>
      <div className="tiny" style={{ fontWeight: 600 }}>
        {label}
      </div>
      <div className="tiny faint">{hint}</div>
    </div>
  );
}
