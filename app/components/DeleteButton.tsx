'use client';

/**
 * Destructive action with a two-step confirm.
 *
 * The confirm is inline (the button becomes "Sure?") rather than a
 * `window.confirm` dialog: browser dialogs block the whole page, look nothing
 * like the rest of the UI, and are suppressed entirely in some embedded
 * contexts, which would turn a guarded delete into a silent no-op.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './Icon';

export function DeleteButton({ endpoint, label }: { endpoint: string; label: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await fetch(endpoint, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  if (!armed) {
    return (
      <button
        type="button"
        className="btn btn-sm btn-danger"
        onClick={() => setArmed(true)}
        aria-label={`Delete ${label}`}
        title={`Delete ${label}`}
      >
        <Icon name="trash" size={11} />
      </button>
    );
  }

  return (
    <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
      <button type="button" className="btn btn-sm btn-danger" onClick={remove} disabled={busy}>
        {busy ? '…' : 'Sure?'}
      </button>
      <button type="button" className="btn btn-sm" onClick={() => setArmed(false)} disabled={busy}>
        <Icon name="xmark" size={11} />
      </button>
    </span>
  );
}
