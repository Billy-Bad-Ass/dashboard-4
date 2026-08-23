'use client';

/**
 * "Updated 4 minutes ago", plus the auto-refresh that makes this dashboard
 * live rather than a screenshot.
 *
 * `router.refresh()` re-runs the server components and streams new HTML in
 * without a full navigation, so the poll costs one request and no client-side
 * data layer. It pauses while the tab is hidden — a background tab refreshing
 * every 60 seconds burns Worker requests out of the same £5 plan the dashboard
 * is meant to be reporting on.
 */

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './Icon';
import { relativeTime } from '@/lib/dates';

export function LiveClock({
  generatedAt,
  intervalSeconds = 60,
}: {
  generatedAt: string;
  intervalSeconds?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState('just now');

  // Rendering a relative time on the server guarantees a hydration mismatch,
  // because the two clocks are never the same. It is computed after mount only.
  useEffect(() => {
    function tick() {
      setLabel(relativeTime(generatedAt));
    }
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [generatedAt]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      startTransition(() => router.refresh());
    }, intervalSeconds * 1000);
    return () => clearInterval(id);
  }, [router, intervalSeconds]);

  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      title="Refresh now"
    >
      <Icon
        name={pending ? 'rotate' : 'signal'}
        size={12}
        className={pending ? 'spin' : undefined}
      />
      <span suppressHydrationWarning>{pending ? 'Refreshing' : `Updated ${label}`}</span>
    </button>
  );
}
