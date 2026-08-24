import type { Metadata } from 'next';
import Link from 'next/link';
import { pulse } from '@/lib/heartbeat';
import { AGENTS } from '@/config/agents';
import { PROJECTS } from '@/config/portfolio';
import { assessFleet, isSilent, type FleetState, type FleetStatus } from '@/lib/fleet';
import { relativeTime, formatDate } from '@/lib/dates';
import { PageHead } from '@/app/components/PageHead';
import { Tile } from '@/app/components/Tile';
import { Icon } from '@/app/components/Icon';
import { AgentTrigger } from '@/app/components/AgentTrigger';

export const metadata: Metadata = { title: 'Agents' };
export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const snapshot = await pulse();
  const runs = snapshot.agentRuns;

  // The registry says what should run; the runs say what reported. Everything
  // interesting on this page is the gap between them.
  const fleet = assessFleet(runs);

  return (
    <>
      <PageHead
        title="Agents"
        sub="The automated fleet: what runs on a schedule, what it owns, and what it actually did."
        generatedAt={snapshot.generatedAt}
      />

      <div className="stack">
        <div className="grid grid-4">
          <Tile
            label="Agents registered"
            value={String(AGENTS.length)}
            icon="robot"
            foot={`${AGENTS.filter((a) => a.scope === 'portfolio').length} portfolio-wide, ${AGENTS.filter((a) => a.scope === 'project').length} inside projects`}
          />
          <Tile
            label="Reporting"
            value={`${fleet.reporting} / ${fleet.scheduled}`}
            icon="clock"
            foot="scheduled agents that have reported since they were last due"
            accent={fleet.reporting === 0 && fleet.scheduled > 0 ? 'var(--bad)' : undefined}
          />
          {/* The tile this page was missing. An agent that should have run six
              hours ago and has not is a finding, and it used to render as a
              dash in a column. */}
          <Tile
            label="Not heard from"
            value={String(fleet.silent)}
            icon="signal"
            higherIsBetter={false}
            accent={fleet.silent > 0 ? 'var(--bad)' : undefined}
            foot={
              fleet.worst
                ? `longest silent: ${fleet.worst.agent.name}${
                    fleet.worst.dueAt ? `, due ${relativeTime(fleet.worst.dueAt.toISOString())}` : ''
                  }`
                : 'Every scheduled agent has checked in.'
            }
          />
          <Tile
            label="Failures"
            value={String(fleet.failures)}
            icon="circle-exclamation"
            higherIsBetter={false}
            accent={fleet.failures > 0 ? 'var(--bad)' : undefined}
            foot={
              runs.length === 0
                ? 'No runs recorded at all — which is not the same as nothing failing.'
                : fleet.failures === 0
                  ? `None in the last ${runs.length} recorded runs.`
                  : `In the last ${runs.length} recorded runs.`
            }
          />
        </div>

        {/* The headline. Silence used to be the absence of a row; now it is a
            row of its own, because a dashboard that cannot tell "everything is
            fine" from "nobody has said anything" will say everything is fine
            right up until it matters. */}
        {fleet.silent > 0 ? (
          <div className="notice notice-warn">
            <Icon name="triangle-exclamation" size={16} />
            <div>
              <strong>
                {fleet.silent} of {fleet.scheduled} scheduled agents{' '}
                {fleet.silent === 1 ? 'has' : 'have'} not reported when they should have.
              </strong>
              <div className="small muted" style={{ marginTop: 5 }}>
                {fleet.statuses
                  .filter((s) => isSilent(s.state))
                  .map((s) => (
                    <div key={s.agent.name} style={{ marginTop: 3 }}>
                      <span className="mono">{s.agent.name}</span> — {s.detail}
                    </div>
                  ))}
              </div>
              <div className="tiny faint" style={{ marginTop: 8 }}>
                A run only lands here if it POSTs to <span className="mono">/api/agent-runs</span>,
                so check <span className="mono">DASHBOARD_URL</span> and{' '}
                <span className="mono">DASHBOARD_TOKEN</span> are set as repository secrets before
                concluding the agent itself is broken — see <Link href="/setup">setup</Link>. That
                the workflow ran is not evidence it reported, and a failed run reports nothing at
                all.
              </div>
            </div>
          </div>
        ) : null}

        {/* ---------------------------------------------------- the fleet --- */}
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Icon name="circle-nodes" size={13} />
              The fleet
            </h2>
            <span className="tiny faint">worst first</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Owns</th>
                  <th>Schedule</th>
                  <th>State</th>
                  <th>Last run</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {fleet.statuses.map((status) => (
                  <FleetRow key={`${status.agent.repo}:${status.agent.name}`} status={status} />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* --------------------------------------------------- the history -- */}
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Icon name="list-check" size={13} />
              Run history
            </h2>
            <span className="tiny faint">last {runs.length}</span>
          </div>
          {runs.length === 0 ? (
            <div className="empty">
              <strong>No runs recorded.</strong>
              Nothing has ever POSTed to <span className="mono">/api/agent-runs</span>. The state
              column above says which agents that is true of and how long it has been true.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Trigger</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Took</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td style={{ fontWeight: 560 }}>{run.agent}</td>
                      <td className="tiny muted">{run.trigger}</td>
                      <td>
                        <span className={`badge badge-${runTone(run.status)}`}>{run.status}</span>
                      </td>
                      <td className="tiny" title={run.started_at}>
                        {formatDate(run.started_at)}
                        <div className="faint">{relativeTime(run.started_at)}</div>
                      </td>
                      <td className="tiny num">
                        {run.duration_ms === null ? '—' : `${Math.round(run.duration_ms / 1000)}s`}
                      </td>
                      <td className="small muted" style={{ maxWidth: 380 }}>
                        {run.summary ?? <span className="faint">—</span>}
                        {run.artifact_url ? (
                          <>
                            {' '}
                            <a href={run.artifact_url} target="_blank" rel="noreferrer noopener">
                              <Icon name="link" size={10} />
                            </a>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>
            <Icon name="diagram-project" size={13} />
            How the orchestration is layered
          </div>
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: 14,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              overflowX: 'auto',
              fontSize: 12,
              lineHeight: 1.7,
            }}
          >{`Cloudflare cron            wrangler.jsonc triggers
  every 10 min             polls Stripe/GitHub/Cloudflare, writes heartbeats + metrics
        │
        ▼
GitHub Actions             .github/workflows/agent-*.yml
  on a schedule            runs Claude Code headless, opens issues and PRs
        │
        ▼
Deterministic workflows    .claude/workflows/*.mjs
  fan out, verify          adversarial checks before anything is reported
        │
        ▼
Specialist subagents       .claude/agents/*.md
  one job each             house rules baked in`}</pre>
          <div className="tiny faint" style={{ marginTop: 10 }}>
            The Worker cron keeps the numbers fresh; the Actions agents do the thinking. They are
            separate on purpose — a Worker has a CPU budget measured in milliseconds, and an agent
            run takes minutes. Project 6&rsquo;s two checks are the exception: pure fetch-and-compare
            with no model in the loop, so they run as Worker cron triggers and have no Actions page.
          </div>
        </div>
      </div>
    </>
  );
}

function FleetRow({ status }: { status: FleetStatus }) {
  const { agent, last } = status;
  const project = PROJECTS.find((p) => p.slug === agent.projectSlug);

  return (
    <tr>
      <td>
        <div className="row" style={{ gap: 7 }}>
          <Icon name={agent.icon} size={13} />
          <strong style={{ fontSize: 13.5 }}>{agent.name}</strong>
        </div>
        <div className="tiny faint" style={{ marginTop: 2 }}>
          {project ? <Link href={`/projects/${project.slug}`}>{project.name}</Link> : 'Portfolio'}
          {' · '}
          <span className="mono">{agent.workflow}</span>
        </div>
      </td>
      <td className="small muted" style={{ maxWidth: 320 }}>
        {agent.owns}
      </td>
      <td className="tiny">
        <span className={`badge badge-${agent.schedule ? 'info' : 'neutral'}`}>
          {agent.scheduleHuman}
        </span>
        {status.nextAt ? (
          <div className="faint" style={{ marginTop: 2 }}>
            next {relativeTime(status.nextAt.toISOString())}
          </div>
        ) : null}
      </td>
      <td className="tiny" style={{ maxWidth: 220 }}>
        <span className={`badge badge-${STATE_TONE[status.state]}`}>
          {STATE_LABEL[status.state]}
        </span>
        <div className="faint" style={{ marginTop: 2 }}>
          {status.detail}
        </div>
      </td>
      <td className="tiny">
        {last ? (
          <>
            <span className={`badge badge-${runTone(last.status)}`}>{last.status}</span>
            <div className="faint" style={{ marginTop: 2 }}>
              {relativeTime(last.started_at)}
            </div>
          </>
        ) : (
          <span className="faint">never</span>
        )}
      </td>
      <td>
        {agent.platform === 'cloudflare-cron' ? (
          // A Worker cron trigger has no Actions page to open, and a link to
          // one that does not exist is worse than no link at all.
          <span className="tiny faint" title="Runs as a Cloudflare Cron Trigger, not a workflow">
            Worker cron
          </span>
        ) : agent.scope === 'portfolio' && agent.trigger === 'cron' ? (
          <AgentTrigger agent={agent.name} workflow={agent.workflow} />
        ) : (
          <a
            className="btn btn-sm"
            href={`https://github.com/${agent.repo}/actions/workflows/${agent.workflow}`}
            target="_blank"
            rel="noreferrer noopener"
            title="Open in GitHub Actions"
          >
            <Icon name="arrow-up-right-from-square" size={11} />
          </a>
        )}
      </td>
    </tr>
  );
}

/**
 * Silence is red, not grey.
 *
 * `never` and `overdue` deliberately share a tone with a failed run. They are
 * the same size of problem and the old page rendered them as absence.
 */
const STATE_TONE: Record<FleetState, string> = {
  never: 'bad',
  overdue: 'bad',
  stalled: 'warn',
  unreadable: 'warn',
  ok: 'good',
  unscheduled: 'neutral',
};

const STATE_LABEL: Record<FleetState, string> = {
  never: 'never reported',
  overdue: 'overdue',
  stalled: 'stalled',
  unreadable: 'unreadable schedule',
  ok: 'reporting',
  unscheduled: 'on demand',
};

function runTone(status: string): string {
  return (
    { ok: 'good', failed: 'bad', running: 'info', queued: 'neutral', skipped: 'idle' }[status] ??
    'neutral'
  );
}
