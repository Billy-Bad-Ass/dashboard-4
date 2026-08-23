'use client';

/**
 * Light/dark toggle.
 *
 * Three states, not two: light, dark, and "follow the system". The stored
 * choice is written to <html data-theme> and to localStorage. Reading
 * localStorage is wrapped because it throws outright in some privacy modes and
 * inside thumbnail capture, and a theme button is not worth a broken page.
 *
 * The initial paint is handled by the inline script in layout.tsx, so this
 * component only has to keep up after hydration.
 */

import { useEffect, useState } from 'react';
import { Icon } from './Icon';

type Mode = 'light' | 'dark' | 'system';
const ORDER: Mode[] = ['system', 'light', 'dark'];
const KEY = 'bba-theme';

function read(): Mode {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* private mode, blocked storage — fall through to system */
  }
  return 'system';
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('system');
  // Rendered value is only correct after hydration; before that the server has
  // no idea what the viewer chose.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMode(read());
    setReady(true);
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!;
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* not fatal — the choice just will not persist */
    }
    const root = document.documentElement;
    if (next === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', next);
  }

  const meta: Record<Mode, { icon: string; label: string }> = {
    system: { icon: 'circle-nodes', label: 'System theme' },
    light: { icon: 'sun', label: 'Light theme' },
    dark: { icon: 'moon', label: 'Dark theme' },
  };
  const current = meta[mode];

  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={cycle}
      title={`${current.label} — click to change`}
      aria-label={`${current.label}. Click to change.`}
      suppressHydrationWarning
    >
      <Icon name={ready ? current.icon : 'circle-nodes'} size={13} />
    </button>
  );
}
