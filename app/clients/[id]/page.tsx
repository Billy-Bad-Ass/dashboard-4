import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getClient, clientInteractions, STATUS_META } from '@/lib/crm';
import { PROJECTS } from '@/config/portfolio';
import { formatMoney } from '@/lib/money';
import { formatDate, relativeTime } from '@/lib/dates';
import { PageHead } from '@/app/components/PageHead';
import { Icon } from '@/app/components/Icon';
import { ClientDetail } from '@/app/components/ClientDetail';
import { toId } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const id = toId((await params).id);
  const client = id === null ? null : await getClient(id);
  return { title: client?.name ?? 'Client' };
}

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const id = toId((await params).id);
  if (id === null) notFound();

  const client = await getClient(id);
  if (!client) notFound();

  const interactions = await clientInteractions(id);
  const meta = STATUS_META[client.status];
  const project = PROJECTS.find((p) => p.slug === client.project_slug);

  return (
    <>
      <PageHead
        title={client.name}
        sub={
          <>
            {client.company ? `${client.company} · ` : ''}
            <span className={`badge badge-${meta.tone}`}>{meta.label}</span>
            {project ? (
              <>
                {' · '}
                <Link href={`/projects/${project.slug}`}>{project.name}</Link>
              </>
            ) : null}
          </>
        }
        actions={
          <Link href="/clients" className="btn btn-sm">
            <Icon name="arrow-right" size={12} className="flip" /> All clients
          </Link>
        }
      />

      <div className="grid grid-2">
        <ClientDetail client={client} />

        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Icon name="handshake" size={13} />
                Deals
              </h2>
              <span className="tiny faint">{formatMoney(client.openValuePence)} open</span>
            </div>
            {client.deals.length === 0 ? (
              <div className="empty">
                <strong>No deals recorded.</strong>
                Add one below to bring this contact into the pipeline total.
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Deal</th>
                      <th>Stage</th>
                      <th className="num">Value</th>
                      <th className="num">Weighted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {client.deals.map((deal) => (
                      <tr key={deal.id}>
                        <td>
                          {deal.title}
                          {deal.expected_on ? (
                            <div className="tiny faint">expected {formatDate(deal.expected_on)}</div>
                          ) : null}
                        </td>
                        <td className="tiny">
                          <span className="badge badge-neutral">{deal.stage}</span>
                          <div className="tiny faint" style={{ marginTop: 2 }}>
                            {deal.probability}%
                          </div>
                        </td>
                        <td className="num">{formatMoney(deal.value_pence)}</td>
                        <td className="num faint">
                          {formatMoney(Math.round((deal.value_pence * deal.probability) / 100))}
                        </td>
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
                <Icon name="list-check" size={13} />
                History
              </h2>
              <span className="tiny faint">{interactions.length} logged</span>
            </div>
            {interactions.length === 0 ? (
              <div className="empty">
                <strong>Nothing logged yet.</strong>
                Interactions are append-only — they are never edited, so the record of what actually
                happened stays honest.
              </div>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                {interactions.map((entry) => (
                  <div
                    key={entry.id}
                    style={{ borderLeft: '2px solid var(--border)', paddingLeft: 11 }}
                  >
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="badge badge-neutral">{entry.kind}</span>
                      <span className="tiny faint" title={entry.occurred_on}>
                        {relativeTime(entry.occurred_on)}
                      </span>
                    </div>
                    <div style={{ fontSize: 13.5, marginTop: 4 }}>{entry.summary}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
