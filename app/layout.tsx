import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Nav, type NavProject } from './components/Nav';
import { pulse } from '@/lib/heartbeat';

export const metadata: Metadata = {
  title: {
    default: 'BBA Network — Heartbeat',
    template: '%s · BBA Heartbeat',
  },
  description:
    'Live operating dashboard for the BBA Network project portfolio: revenue, spend, ROI, ' +
    'repository health, the agent fleet and the client pipeline.',
  icons: {
    icon: '/brand/svg/bba-favicon.svg',
    apple: '/brand/png/bba-app-icon.png',
  },
  // This is an internal instrument panel, not a marketing site.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafaf8' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0f16' },
  ],
};

/**
 * The theme has to be on <html> before first paint or a dark-mode user gets a
 * white flash on every navigation. That means a blocking inline script — there
 * is no way to read localStorage from the server. It is deliberately tiny and
 * wrapped, because a throw here would block rendering entirely.
 */
const THEME_SCRIPT = `
(function(){try{var t=localStorage.getItem('bba-theme');
if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The nav needs each project's health dot. This is the same cached pulse the
  // page itself will read, so it costs nothing extra.
  const snapshot = await pulse();
  const projects: NavProject[] = snapshot.projects.map((p) => ({
    slug: p.project.slug,
    name: p.project.name,
    icon: p.project.icon,
    health: p.health,
  }));

  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </head>
      <body>
        <div className="shell">
          <Nav projects={projects} />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
