'use client';

/**
 * The editable side of a client record: the fields, the next action, logging an
 * interaction, and adding a deal.
 *
 * Logging an interaction goes through the API rather than being written here as
 * two separate calls, because the server pairs it with a last-contact update in
 * one place. A CRM where you can log a call and still look cold is a CRM you
 * stop believing.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PROJECTS } from '@/config/portfolio';
import {
  CLIENT_STATUSES,
  DEAL_STAGES,
  STATUS_META,
  type ClientWithDeals,
} from '@/lib/crm';
import { parseMoney, symbolFor, DEFAULT_CURRENCY } from '@/lib/money';
import { easternDate } from '@/lib/dates';
import { Icon } from './Icon';

const KINDS = ['email', 'call', 'meeting', 'proposal', 'note'] as const;

export function ClientDetail({ client }: { client: ClientWithDeals }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function send(
    label: string,
    url: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    setBusy(label);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `${label} failed (${response.status})`);
      }
      router.refresh();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await send('Save', `/api/clients/${client.id}`, 'PATCH', {
      name: form.get('name'),
      company: form.get('company'),
      email: form.get('email'),
      phone: form.get('phone'),
      website: form.get('website'),
      status: form.get('status'),
      project_slug: form.get('project_slug') || null,
      source: form.get('source'),
      heat: Number(form.get('heat') ?? 1),
      notes: form.get('notes'),
      next_action: form.get('next_action') || null,
      next_action_on: form.get('next_action_on') || null,
    });
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  async function logInteraction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const summary = String(data.get('summary') ?? '').trim();
    if (!summary) return;
    const ok = await send('Log', '/api/interactions', 'POST', {
      client_id: client.id,
      kind: data.get('kind'),
      summary,
      occurred_on: data.get('occurred_on'),
    });
    if (ok) form.reset();
  }

  async function addDeal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const pence = parseMoney(String(data.get('value') ?? ''));
    if (pence === null) {
      setError('Enter a deal value, like 1200');
      return;
    }
    const ok = await send('Deal', '/api/deals', 'POST', {
      client_id: client.id,
      title: data.get('title'),
      value_pence: pence,
      stage: data.get('stage'),
      probability: Number(data.get('probability') ?? 10),
      expected_on: data.get('expected_on') || null,
      project_slug: client.project_slug,
    });
    if (ok) form.reset();
  }

  return (
    <div className="stack">
      {error ? (
        <div className="notice notice-warn tiny">
          <Icon name="circle-exclamation" size={13} />
          <span>{error}</span>
        </div>
      ) : null}

      <form onSubmit={saveDetails} className="card stack" style={{ gap: 10 }}>
        <div className="card-head" style={{ marginBottom: 0 }}>
          <h2 className="card-title">
            <Icon name="pen" size={13} />
            Details
          </h2>
          {saved ? (
            <span className="badge badge-good">
              <Icon name="check" size={11} /> Saved
            </span>
          ) : null}
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
          <Field id="d-name" label="Name" name="name" defaultValue={client.name} required />
          <Field id="d-company" label="Company" name="company" defaultValue={client.company ?? ''} />
          <Field id="d-email" label="Email" name="email" type="email" defaultValue={client.email ?? ''} />
          <Field id="d-phone" label="Phone" name="phone" defaultValue={client.phone ?? ''} />
          <Field id="d-website" label="Website" name="website" defaultValue={client.website ?? ''} />
          <Field id="d-source" label="Found via" name="source" defaultValue={client.source ?? ''} />

          <div className="field">
            <label htmlFor="d-status">Status</label>
            <select id="d-status" name="status" defaultValue={client.status}>
              {CLIENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="d-project">Project</label>
            <select id="d-project" name="project_slug" defaultValue={client.project_slug ?? ''}>
              <option value="">Unassigned</option>
              {PROJECTS.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="d-heat">Heat (1–5)</label>
            <input id="d-heat" name="heat" type="number" min={1} max={5} defaultValue={client.heat} />
          </div>
          <Field
            id="d-action"
            label="Next action"
            name="next_action"
            defaultValue={client.next_action ?? ''}
            placeholder="Send the proposal"
          />
          <div className="field">
            <label htmlFor="d-action-on">Action due</label>
            <input
              id="d-action-on"
              name="next_action_on"
              type="date"
              defaultValue={client.next_action_on ?? ''}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="d-notes">Notes</label>
          <textarea id="d-notes" name="notes" defaultValue={client.notes ?? ''} />
        </div>

        <div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy !== null}>
            <Icon
              name={busy === 'Save' ? 'rotate' : 'check'}
              size={12}
              className={busy === 'Save' ? 'spin' : undefined}
            />
            Save
          </button>
        </div>
      </form>

      <form onSubmit={logInteraction} className="card stack" style={{ gap: 10 }}>
        <div className="card-title">
          <Icon name="envelope" size={13} />
          Log an interaction
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="field" style={{ maxWidth: 120 }}>
            <label htmlFor="i-kind">Kind</label>
            <select id="i-kind" name="kind" defaultValue="email">
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ maxWidth: 150 }}>
            <label htmlFor="i-date">When</label>
            <input id="i-date" name="occurred_on" type="date" defaultValue={easternDate()} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="i-summary">What happened</label>
          <input id="i-summary" name="summary" placeholder="Sent scoping questions." required />
        </div>
        <div>
          <button type="submit" className="btn btn-sm" disabled={busy !== null}>
            <Icon name="plus" size={12} /> Log it
          </button>
        </div>
        <div className="tiny faint">
          Logging also moves this contact&rsquo;s last-contact date, so it stops showing as going cold.
        </div>
      </form>

      <form onSubmit={addDeal} className="card stack" style={{ gap: 10 }}>
        <div className="card-title">
          <Icon name="handshake" size={13} />
          Add a deal
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
          <Field id="dl-title" label="Title" name="title" placeholder="Website rebuild" required />
          <Field id="dl-value" label={`Value (${symbolFor(DEFAULT_CURRENCY)})`} name="value" placeholder="1200" required />
          <div className="field">
            <label htmlFor="dl-stage">Stage</label>
            <select id="dl-stage" name="stage" defaultValue="lead">
              {DEAL_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="dl-prob">Probability %</label>
            <input id="dl-prob" name="probability" type="number" min={0} max={100} defaultValue={10} />
          </div>
          <div className="field">
            <label htmlFor="dl-expected">Expected</label>
            <input id="dl-expected" name="expected_on" type="date" />
          </div>
        </div>
        <div>
          <button type="submit" className="btn btn-sm" disabled={busy !== null}>
            <Icon name="plus" size={12} /> Add deal
          </button>
        </div>
      </form>
    </div>
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
