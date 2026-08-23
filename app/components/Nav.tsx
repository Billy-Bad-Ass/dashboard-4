'use client';

/**
 * Sidebar navigation.
 *
 * Client-side only because it needs `usePathname` to mark the current page.
 * The health dots beside each project come from the server as props — the nav
 * does not fetch anything itself, so it cannot be the thing that makes a page
 * load slowly.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import type { Health } from '@/lib/heartbeat';

export interface NavProject {
  slug: string;
  name: string;
  icon: string;
  health: Health;
}

const HEALTH_DOT: Record<Health, string> = {
  good: 'var(--good)',
  watch: 'var(--warn)',
  stalled: 'var(--bad)',
  idle: 'var(--idle)',
};

const SECTIONS = [
  { href: '/', icon: 'gauge-high', label: 'Heartbeat' },
  { href: '/ask', icon: 'crosshairs', label: 'Ask' },
  { href: '/finance', icon: 'sterling-sign', label: 'Money' },
  { href: '/clients', icon: 'users', label: 'Clients' },
  { href: '/agents', icon: 'robot', label: 'Agents' },
  { href: '/calendar', icon: 'calendar-days', label: 'Calendar' },
];

export function Nav({ projects }: { projects: NavProject[] }) {
  const pathname = usePathname();

  function current(href: string): boolean {
    return href === '/' ? pathname === '/' : pathname.startsWith(href);
  }

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">
        <Logo height={24} />
        <div>
          <div className="brand-name">BBA Network</div>
          <div className="brand-sub">Heartbeat</div>
        </div>
      </div>

      <div className="nav-group">
        <div className="nav-label">Overview</div>
        {SECTIONS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="nav-item"
            aria-current={current(item.href) ? 'page' : undefined}
          >
            <Icon name={item.icon} size={14} />
            {item.label}
          </Link>
        ))}
      </div>

      <div className="nav-group">
        <div className="nav-label">Projects</div>
        {projects.map((project) => (
          <Link
            key={project.slug}
            href={`/projects/${project.slug}`}
            className="nav-item"
            aria-current={pathname === `/projects/${project.slug}` ? 'page' : undefined}
          >
            <Icon name={project.icon} size={14} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {project.name}
            </span>
            <span
              className="dot"
              style={{ background: HEALTH_DOT[project.health] }}
              title={project.health}
            />
          </Link>
        ))}
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', gap: 8, alignItems: 'center', padding: '0 8px' }}>
        <ThemeToggle />
        <a
          className="btn btn-sm"
          href="https://github.com/Billy-Bad-Ass"
          target="_blank"
          rel="noreferrer noopener"
          title="GitHub"
          aria-label="GitHub profile"
        >
          <Icon name="brand-github" size={13} />
        </a>
        <Link className="btn btn-sm" href="/setup" title="Setup and connectors" aria-label="Setup">
          <Icon name="gear" size={13} />
        </Link>
      </div>
    </nav>
  );
}
