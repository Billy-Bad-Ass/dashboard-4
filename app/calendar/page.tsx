import type { Metadata } from 'next';
import Link from 'next/link';
import { pulse } from '@/lib/heartbeat';
import { cfEnv } from '@/lib/db';
import { PROJECTS } from '@/config/portfolio';
import { AGENTS } from '@/config/agents';
import { formatDate, formatTime, relativeTime, isoDate, addDays } from '@/lib/dates';
import { PageHead } from '@/app/components/PageHead';
import { Icon } from '@/app/components/Icon';

export const metadata: Metadata = { title: 'Calendar' };
export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const snapshot = await pulse();
  const account = cfEnv()?.CALENDAR_ACCOUNT ?? 'bbacentralworkspace@gmail.com';
  const connector = snapshot.connectors.find((c) => c.name === 'Calendar');

  // Group by day so the page reads as a diary rather than a list.
  const byDay = new Map<string, typeof snapshot.events>();
  for (const event of snapshot.events) {
    const day = event.startsAt.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(event);
    byDay.set(day, list);
  }

  const today = isoDate();
  const tomorrow = isoDate(addDays(new Date(), 1));

  return (
    <>
      <PageHead
        title="Calendar"
        sub={
          <>
            Read-only mirror of <span className="mono">{account}</span>. The dashboard never writes
            to the calendar — book things in Google, they appear here.
          </>
        }
        generatedAt={snapshot.generatedAt}
        actions={
          <a
            className="btn btn-sm"
            href="https://calendar.google.com/calendar/r"
            target="_blank"
            rel="noreferrer noopener"
          >
            <Icon name="brand-google" size={12} /> Open Google Calendar
          </a>
        }
      />

      <div className="stack">
        {connector?.status !== 'ok' ? (
          <div className="notice notice-warn">
            <Icon name="triangle-exclamation" size={16} />
            <div>
              <strong>Calendar not connected.</strong>
              <div className="small muted" style={{ marginTop: 3 }}>
                {connector?.detail}
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Icon name="calendar-days" size={13} />
                Next 30 days
              </h2>
              <span className="tiny faint">
                {snapshot.events.length} event{snapshot.events.length === 1 ? '' : 's'}
              </span>
            </div>

            {snapshot.events.length === 0 ? (
              <div className="empty">
                <strong>Nothing booked.</strong>
                {connector?.status === 'ok'
                  ? 'The feed is connected and genuinely empty for the next 30 days.'
                  : 'Connect the ICS feed to see what is coming up.'}
              </div>
            ) : (
              <div className="stack" style={{ gap: 16 }}>
                {[...byDay.entries()].map(([day, events]) => (
                  <div key={day}>
                    <div
                      className="tiny"
                      style={{
                        fontWeight: 660,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: day === today ? 'var(--accent-text)' : 'var(--text-faint)',
                        marginBottom: 7,
                      }}
                    >
                      {day === today ? 'Today' : day === tomorrow ? 'Tomorrow' : formatDate(day)}
                    </div>
                    <div className="stack" style={{ gap: 7 }}>
                      {events.map((event) => {
                        const project = PROJECTS.find((p) => p.slug === event.projectSlug);
                        return (
                          <div
                            key={event.uid}
                            style={{
                              borderLeft: `3px solid ${project?.accent ?? 'var(--border-strong)'}`,
                              paddingLeft: 11,
                            }}
                          >
                            <div className="row" style={{ justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 13.5, fontWeight: 560 }}>{event.summary}</span>
                              <span className="tiny faint">
                                {event.allDay ? 'all day' : formatTime(event.startsAt)}
                              </span>
                            </div>
                            <div className="tiny faint">
                              {project ? (
                                <Link href={`/projects/${project.slug}`}>{project.name}</Link>
                              ) : null}
                              {project && event.location ? ' · ' : ''}
                              {event.location}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="stack">
            {/* The automated schedule is a calendar too — and the one most
                likely to surprise you, because nothing puts it in Google. */}
            <div className="card">
              <div className="card-head">
                <h2 className="card-title">
                  <Icon name="robot" size={13} />
                  What runs itself
                </h2>
                <Link href="/agents" className="tiny">
                  Agents <Icon name="arrow-right" size={10} />
                </Link>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                {AGENTS.filter((a) => a.schedule).map((agent) => (
                  <div
                    key={`${agent.repo}:${agent.name}`}
                    className="row"
                    style={{ justifyContent: 'space-between' }}
                  >
                    <span className="row" style={{ gap: 7, fontSize: 13.5 }}>
                      <Icon name={agent.icon} size={12} />
                      {agent.name}
                    </span>
                    <span className="tiny faint mono">{agent.scheduleHuman}</span>
                  </div>
                ))}
                <div className="divider" />
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="row" style={{ gap: 7, fontSize: 13.5 }}>
                    <Icon name="heart-pulse" size={12} />
                    heartbeat poll
                  </span>
                  <span className="tiny faint mono">every 10 minutes</span>
                </div>
              </div>
              <div className="tiny faint" style={{ marginTop: 11 }}>
                These are cron schedules in UTC, not calendar entries. Nothing here appears in Google
                Calendar, which is exactly why it is listed on this page.
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2 className="card-title">
                  <Icon name="clock" size={13} />
                  Feed status
                </h2>
              </div>
              <div className="stack" style={{ gap: 8, fontSize: 13.5 }}>
                <Row label="Account" value={account} mono />
                <Row label="Status" value={connector?.status ?? 'unknown'} />
                <Row
                  label="Last checked"
                  value={connector ? relativeTime(connector.checkedAt) : '—'}
                />
                <Row
                  label="Latency"
                  value={connector?.latencyMs ? `${connector.latencyMs} ms` : '—'}
                />
              </div>
              <div className="tiny faint" style={{ marginTop: 11 }}>
                Connected through the calendar&rsquo;s private iCal address, which is read-only. The
                dashboard cannot create, move or delete anything — booking stays in Google.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="muted">{label}</span>
      <span className={mono ? 'mono tiny' : undefined} style={{ fontWeight: 560 }}>
        {value}
      </span>
    </div>
  );
}
