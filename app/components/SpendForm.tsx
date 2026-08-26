'use client';

/**
 * Add a spend row.
 *
 * Inline on both the finance page and every project page, because the moment
 * you are most likely to record a cost is the moment you are looking at the
 * project it belongs to. A form behind a modal behind a nav item does not get
 * used, and an unused spend ledger makes every ROI number on the site a lie.
 *
 * Amount is typed in major units and converted to minor units exactly once, on
 * submit — one conversion, one place it can be wrong.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PROJECTS } from '@/config/portfolio';
import { parseMoney, formatMoney, symbolFor, DEFAULT_CURRENCY } from '@/lib/money';
import { easternDate } from '@/lib/dates';
import { Icon } from './Icon';

const CATEGORIES = [
  ['infra', 'Infrastructure'],
  ['tooling', 'Tooling'],
  ['ai', 'AI / API credits'],
  ['marketing', 'Marketing'],
  ['contractor', 'Contractor'],
  ['fees', 'Fees'],
  ['other', 'Other'],
] as const;

export function SpendForm({ defaultProject }: { defaultProject?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');

  const pence = parseMoney(amount);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const typed = String(form.get('amount') ?? '');
    const parsed = parseMoney(typed);
    if (parsed === null || parsed === 0) {
      setError('Enter an amount, like 5.00');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/spend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_pence: parsed,
          vendor: form.get('vendor'),
          category: form.get('category'),
          project_slug: form.get('project_slug') || null,
          incurred_on: form.get('incurred_on'),
          recurrence: form.get('recurrence'),
          note: form.get('note') || null,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${response.status})`);
      }
      event.currentTarget.reset();
      setAmount('');
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
        <Icon name="plus" size={12} /> Record spend
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="stack" style={{ gap: 10 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
        <div className="field">
          <label htmlFor="spend-amount">Amount ({symbolFor(DEFAULT_CURRENCY)})</label>
          <input
            id="spend-amount"
            name="amount"
            inputMode="decimal"
            placeholder="5.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="spend-vendor">Vendor</label>
          <input id="spend-vendor" name="vendor" placeholder="Cloudflare" required />
        </div>
        <div className="field">
          <label htmlFor="spend-category">Category</label>
          <select id="spend-category" name="category" defaultValue="infra">
            {CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="spend-project">Project</label>
          <select id="spend-project" name="project_slug" defaultValue={defaultProject ?? ''}>
            <option value="">Portfolio-wide</option>
            {PROJECTS.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="spend-date">Date</label>
          <input id="spend-date" name="incurred_on" type="date" defaultValue={easternDate()} />
        </div>
        <div className="field">
          <label htmlFor="spend-recurrence">Recurs</label>
          <select id="spend-recurrence" name="recurrence" defaultValue="once">
            <option value="once">One-off</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="spend-note">Note</label>
        <input id="spend-note" name="note" placeholder="What this buys, and for which project." />
      </div>

      {pence !== null && pence !== 0 ? (
        <div className="tiny faint">
          Will be stored as {pence} minor units ({formatMoney(pence)}).
        </div>
      ) : null}

      {error ? (
        <div className="notice notice-warn tiny">
          <Icon name="circle-exclamation" size={13} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="row">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          <Icon name={busy ? 'rotate' : 'check'} size={12} className={busy ? 'spin' : undefined} />
          {busy ? 'Saving' : 'Save'}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
