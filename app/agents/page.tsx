import type { Metadata } from 'next';
import Link from 'next/link';
import { pulse } from '@/lib/heartbeat';
import { AGENTS } from '@/config/agents';
import { PROJECTS } from '@/config/portfolio';
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

  const lastByAgent = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (!lastByAgent.has(run.agent)) lastByAgent.set(run.agent, run);
  }

  const scheduled = AGENTS.filter((a) => a.schedule !== null);
  const failures = runs.filter((r) => r.status === 'failed').length;

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
            label="On a schedule"
            value={String(scheduled.length)}
            icon="clock"
            foot={`${AGENTS.length - scheduled.length} event-triggered`}
          />
          <Tile
            label="Runs recorded"
            value={String(runs.length)}
            icon="list-check"
            foot={
              runs.length === 0
                ? 'Nothing has reported in yet.'
                : `most recent ${relativeTime(runs[0]?.started_at)}`
            }
          />
          <Tile
            label="Failures"
            value={String(failures)}
            icon="circle-exclamation"
            foot={failures === 0 ? 'Nothing failing.' : 'In the last 25 recorded runs.'}
            higherIsBetter={false}
            accent={failures > 0 ? 'var(--bad)' : undefined}
          />
        </div>

        {runs.length === 0 ? (
          <div className="notice notice-info">
            <Icon name="circle-nodes" size={16} />
            <div>
              <strong>No agent has reported in yet.</strong>
              <div className="small muted" style={{ marginTop: 3 }}>
                The workflows below exist and are scheduled, but this console only shows runs that
                POST to <span className="mono">/api/agent-runs</span>. Set{' '}
                <span className="mono">DASHBOARD_URL</span> and{' '}
                <span className="mono">DASHBOARD_TOKEN</span> as repository secrets and the reporting
                step in each workflow starts landing here. See{' '}
                <Link href="/setup">setup</Link>.
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
            <span className="tiny faint">portfolio agents run from this repository</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Owns</th>
                  <th>Runs</th>
                  <th>Last run</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {AGENTS.map((agent) => {
                  const last = lastByAgent.get(agent.name);
                  const project = PROJECTS.find((p) => p.slug === agent.projectSlug);
                  return (
                    <tr key={`${agent.repo}:${agent.name}`}>
                      <td>
                        <div className="row" style={{ gap: 7 }}>
                          <Icon name={agent.icon} size={13} />
                          <strong style={{ fontSize: 13.5 }}>{agent.name}</strong>
                        </div>
                        <div className="tiny faint" style={{ marginTop: 2 }}>
                          {project ? (
                            <Link href={`/projects/${project.slug}`}>{project.name}</Link>
                          ) : (
                            'Portfolio'
                          )}
                          {' · '}
                          <span className="mono">{agent.workflow}</span>
                        </div>
                      </td>
                      <td className="small muted" style={{ maxWidth: 340 }}>
                        {agent.owns}
                      </td>
                      <td className="tiny">
                        <span className={`badge badge-${agent.schedule ? 'info' : 'neutral'}`}>
                          {agent.scheduleHuman}
                        </span>
                      </td>
                      <td className="tiny">
                        {last ? (
                          <>
                            <span className={`badge badge-${runTone(last.status)}`}>
                              {last.status}
                            </span>
                            <div className="faint" style={{ marginTop: 2 }}>
                              {relativeTime(last.started_at)}
                            </div>
                          </>
                        ) : (
                          <span className="faint">never</span>
                        )}
                      </td>
                      <td>
                        {agent.scope === 'portfolio' && agent.trigger === 'cron' ? (
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
                })}
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
              This table fills in as scheduled agents report to the API.
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
            run takes minutes.
          </div>
        </div>
      </div>
    </>
  );
}

function runTone(status: string): string {
  return (
    { ok: 'good', failed: 'bad', running: 'info', queued: 'neutral', skipped: 'idle' }[status] ??
    'neutral'
  );
}
