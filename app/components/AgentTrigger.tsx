'use client';

/**
 * Fire a portfolio agent by hand.
 *
 * This records a `queued` run and opens the workflow's GitHub Actions page,
 * rather than dispatching the workflow directly. Dispatching would need a
 * GitHub token with `actions: write` held by the Worker, and a
 * write-scoped token sitting in a dashboard is a much larger blast radius than
 * one button is worth. The run row means the console shows the request even
 * though a human presses the final button.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './Icon';

export function AgentTrigger({ agent, workflow }: { agent: string; workflow: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function trigger() {
    setBusy(true);
    try {
      await fetch('/api/agent-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent,
          trigger: 'manual',
          status: 'queued',
          summary: 'Queued from the dashboard — dispatch the workflow in GitHub to run it.',
          artifact_url: `https://github.com/Billy-Bad-Ass/dashboard-4/actions/workflows/${workflow}`,
        }),
      });
      window.open(
        `https://github.com/Billy-Bad-Ass/dashboard-4/actions/workflows/${workflow}`,
        '_blank',
        'noopener',
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={trigger}
      disabled={busy}
      title={`Queue ${agent} and open its workflow`}
    >
      <Icon name={busy ? 'rotate' : 'play'} size={11} className={busy ? 'spin' : undefined} />
    </button>
  );
}
