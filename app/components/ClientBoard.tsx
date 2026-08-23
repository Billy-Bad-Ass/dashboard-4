'use client';

/**
 * The CRM board.
 *
 * Interactive because a client database that needs a deploy to update is a
 * client database nobody updates. Everything here writes through /api/clients
 * and then calls router.refresh(), so the server stays the single source of
 * truth and there is no client-side cache to go stale.
 *
 * Status is a <select> rather than drag-and-drop columns: dragging is nice on a
 * desktop and impossible on a phone, and moving a prospect to "engaged" while
 * standing in a queue is exactly when this gets used.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PROJECTS } from '@/config/portfolio';
import { CLIENT_STATUSES, STATUS_META, type ClientStatus, type ClientWithDeals } from '@/lib/crm';
import { formatMoney, parseMoney, symbolFor, DEFAULT_CURRENCY } from '@/lib/money';
import { formatDate, relativeTime } from '@/lib/dates';
import { Icon } from './Icon';

export function ClientBoard({ clients }: { clients: ClientWithDeals[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<ClientStatus | 'all'>('all');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = filter === 'all' ? clients : clients.filter((c) => c.status === filter);

  async function patch(id: number, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/clients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Update failed (${response.status})`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const dealValue = String(form.get('deal_value') ?? '').trim();

    try {
      const response = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          company: form.get('company'),
          email: form.get('email'),
          status: form.get('status'),
          project_slug: form.get('project_slug') || null,
          source: form.get('source'),
          heat: Number(form.get('heat') ?? 1),
          notes: form.get('notes'),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Create failed (${response.status})`);
      }
      const { id } = (await response.json()) as { id: number };

      // An opening deal value is optional, but capturing it at the same moment
      // as the contact is the only time it reliably gets recorded.
      const pence = dealValue ? parseMoney(dealValue) : null;
      if (pence) {
        await fetch('/api/deals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: id,
            title: `${form.get('name')} — opening opportunity`,
            value_pence: pence,
            project_slug: form.get('project_slug') || null,
            stage: 'lead',
            probability: 10,
          }),
        });
      }

      event.currentTarget.reset();
      setAdding(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 6 }}>
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            All ({clients.length})
          </FilterChip>
          {CLIENT_STATUSES.map((status) => {
            const count = clients.filter((c) => c.status === status).length;
            return (
              <FilterChip
                key={status}
                active={filter === status}
                onClick={() => setFilter(status)}
                dim={count === 0}
              >
                {STATUS_META[status].label} ({count})
              </FilterChip>
            );
          })}
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding((v) => !v)}>
          <Icon name={adding ? 'xmark' : 'user-plus'} size={12} />
          {adding ? 'Cancel' : 'Add contact'}
        </button>
      </div>

      {error ? (
        <div className="notice notice-warn tiny">
          <Icon name="circle-exclamation" size={13} />
          <span>{error}</span>
        </div>
      ) : null}

      {adding ? (
        <form onSubmit={create} className="card stack" style={{ gap: 10 }}>
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}
          >
            <Field id="c-name" label="Name" name="name" required autoFocus />
            <Field id="c-company" label="Company" name="company" />
            <Field id="c-email" label="Email" name="email" type="email" />
            <div className="field">
              <label htmlFor="c-status">Status</label>
              <select id="c-status" name="status" defaultValue="prospect">
                {CLIENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="c-project">For project</label>
              <select id="c-project" name="project_slug" defaultValue="">
                <option value="">Unassigned</option>
                {PROJECTS.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <Field id="c-source" label="Found via" name="source" placeholder="Referral, LinkedIn…" />
            <div className="field">
              <label htmlFor="c-heat">Heat (1–5)</label>
              <input id="c-heat" name="heat" type="number" min={1} max={5} defaultValue={1} />
            </div>
            <Field id="c-deal" label={`Opening value (${symbolFor(DEFAULT_CURRENCY)})`} name="deal_value" placeholder="Optional" />
          </div>
          <div className="field">
            <label htmlFor="c-notes">Notes</label>
            <textarea id="c-notes" name="notes" placeholder="What they need, and what you said." />
          </div>
          <div>
            <button type="submit" className="btn btn-primary btn-sm">
              <Icon name="check" size={12} /> Save contact
            </button>
          </div>
        </form>
      ) : null}

      {visible.length === 0 ? (
        <div className="empty">
          <strong>
            {clients.length === 0 ? 'No clients or prospects yet.' : 'Nothing in this status.'}
          </strong>
          {clients.length === 0
            ? 'Add the first contact above. Prospects and clients live in one list — a prospect that signs keeps its history.'
            : 'Try another filter.'}
        </div>
      ) : (
        <div className="grid grid-3">
          {visible.map((client) => (
            <div key={client.id} className="card">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <div>
                  <Link href={`/clients/${client.id}`} style={{ fontWeight: 620, fontSize: 14.5 }}>
                    {client.name}
                  </Link>
                  {client.company ? (
                    <div className="tiny faint">{client.company}</div>
                  ) : null}
                </div>
                <Heat value={client.heat} />
              </div>

              <div className="field" style={{ marginBottom: 8 }}>
                <select
                  value={client.status}
                  disabled={busyId === client.id}
                  onChange={(e) => patch(client.id, { status: e.target.value })}
                  aria-label={`Status for ${client.name}`}
                >
                  {CLIENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_META[s].label}
                    </option>
                  ))}
                </select>
              </div>

              {client.openValuePence > 0 ? (
                <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
                  <span className="muted">Open value</span>
                  <strong>{formatMoney(client.openValuePence)}</strong>
                </div>
              ) : null}

              {client.project_slug ? (
                <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
                  <span className="muted">Project</span>
                  <Link href={`/projects/${client.project_slug}`} className="tiny">
                    {PROJECTS.find((p) => p.slug === client.project_slug)?.name ?? client.project_slug}
                  </Link>
                </div>
              ) : null}

              <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
                <span className="muted">Last contact</span>
                <span className="tiny">
                  {client.last_contact_on ? relativeTime(client.last_contact_on) : 'never'}
                </span>
              </div>

              {client.next_action ? (
                <div
                  className="tiny"
                  style={{
                    marginTop: 8,
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <Icon name="bullseye" size={11} /> {client.next_action}
                  {client.next_action_on ? (
                    <span className="faint"> · {formatDate(client.next_action_on)}</span>
                  ) : null}
                </div>
              ) : null}

              <div className="row" style={{ marginTop: 10, gap: 6 }}>
                <Link href={`/clients/${client.id}`} className="btn btn-sm">
                  <Icon name="pen" size={11} /> Open
                </Link>
                {client.email ? (
                  <a href={`mailto:${client.email}`} className="btn btn-sm">
                    <Icon name="envelope" size={11} />
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  dim,
  onClick,
  children,
}: {
  active: boolean;
  dim?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`badge ${active ? 'badge-info' : 'badge-neutral'}`}
      style={{ cursor: 'pointer', border: 'none', opacity: dim && !active ? 0.55 : 1 }}
    >
      {children}
    </button>
  );
}

/** Coarse 1–5 warmth. Five bars, because a percentage would imply precision. */
function Heat({ value }: { value: number }) {
  return (
    <span className="row" style={{ gap: 2 }} title={`Heat ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          style={{
            width: 4,
            height: 12,
            borderRadius: 1,
            background: n <= value ? 'var(--accent)' : 'var(--border)',
          }}
        />
      ))}
    </span>
  );
}

function Field({
  id,
  label,
  name,
  ...rest
}: { id: string; label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={name} {...rest} />
    </div>
  );
}
